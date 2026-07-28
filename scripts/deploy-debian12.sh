#!/usr/bin/env bash
set -Eeuo pipefail

# PokeWar single-server installer for a clean Debian 12 host.
# Run from the repository root as root. Override defaults with environment variables.
DOMAIN="${DOMAIN:-game.n1komajor.top}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-iverins.user@gmail.com}"
APP_USER="${APP_USER:-pokewar}"
APP_DIR="${APP_DIR:-/opt/pokewar}"
APP_PORT="${APP_PORT:-3000}"
DB_NAME="${DB_NAME:-pokewar}"
DB_USER="${DB_USER:-pokewar}"
ENABLE_TLS="${ENABLE_TLS:-1}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="/etc/pokewar/pokewar.env"
SERVICE_FILE="/etc/systemd/system/pokewar.service"
NGINX_FILE="/etc/nginx/sites-available/pokewar"

log() { printf '\n\033[1;32m[PokeWar]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[PokeWar] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "请使用 root 运行：sudo bash scripts/deploy-debian12.sh"
[[ -f "$SOURCE_DIR/pnpm-lock.yaml" && -f "$SOURCE_DIR/apps/server/package.json" ]] || fail "请在完整项目目录中运行脚本"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || fail "DOMAIN 格式不合法"
case "$APP_DIR" in
  /root|/root/*) fail "APP_DIR 不能位于 /root 下。请使用默认路径 /opt/pokewar，或设置 APP_DIR=/opt/pokewar" ;;
  /*) ;;
  *) fail "APP_DIR 必须是绝对路径" ;;
esac

export DEBIAN_FRONTEND=noninteractive
log "安装 Debian 系统依赖"
apt-get update
apt-get install -y acl ca-certificates curl gnupg nginx postgresql redis-server rsync certbot python3-certbot-nginx

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 22 ]]; then
  log "安装 Node.js 22"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi
corepack enable
corepack prepare pnpm@11.17.0 --activate
PNPM_BIN="$(command -v pnpm)"
[[ -x "$PNPM_BIN" ]] || fail "pnpm 安装失败"

log "创建服务用户与应用目录"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --create-home --shell /usr/sbin/nologin "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_DIR"
install -d -o root -g "$APP_USER" -m 0750 /etc/pokewar
rsync -a --delete \
  --exclude '.git/' --exclude 'node_modules/' --exclude '**/dist/' --exclude '.env' \
  --exclude '.tmp/' --exclude '.pi-subagents/' --exclude 'test-results/' \
  "$SOURCE_DIR/" "$APP_DIR/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "配置 PostgreSQL 与 Redis"
systemctl enable --now postgresql redis-server
if [[ -f "$ENV_FILE" ]]; then
  # Reuse credentials during repeat deployments so sessions and database access remain valid.
  DB_PASSWORD="$(sed -n 's|^DATABASE_URL=postgresql://[^:]*:\([^@]*\)@.*|\1|p' "$ENV_FILE" | head -n1)"
  EXISTING_GUEST_SECRET="$(sed -n 's/^GUEST_SECRET=//p' "$ENV_FILE" | head -n1)"
fi
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
GUEST_SECRET="${GUEST_SECRET:-${EXISTING_GUEST_SECRET:-$(openssl rand -hex 48)}}"
runuser -u postgres -- psql -v ON_ERROR_STOP=1 --set=db_user="$DB_USER" --set=db_name="$DB_NAME" --set=db_password="$DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'db_user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'db_user', :'db_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db_name') \gexec
SQL

cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$APP_PORT
HOST=127.0.0.1
GUEST_SECRET=$GUEST_SECRET
CORS_ORIGINS=https://$DOMAIN
REDIS_URL=redis://127.0.0.1:6379
REDIS_PREFIX=pokewar:
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME
EOF
chown root:"$APP_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"

log "安装依赖、执行数据库迁移并构建"
runuser -u "$APP_USER" -- env HOME="$APP_DIR" bash -c "cd '$APP_DIR' && '$PNPM_BIN' install --frozen-lockfile"
runuser -u "$APP_USER" -- env HOME="$APP_DIR" bash -c "set -a; source '$ENV_FILE'; set +a; cd '$APP_DIR'; '$PNPM_BIN' --filter @pokewar/server migrate"
runuser -u "$APP_USER" -- env HOME="$APP_DIR" bash -c "cd '$APP_DIR' && '$PNPM_BIN' build"
# Nginx may traverse the private source path but can read only the built web output.
setfacl -m u:www-data:x "$APP_DIR" "$APP_DIR/apps" "$APP_DIR/apps/web"
setfacl -R -m u:www-data:rX "$APP_DIR/apps/web/dist"

log "配置 systemd 服务"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=PokeWar authoritative game server
After=network-online.target redis-server.service postgresql.service
Wants=network-online.target
Requires=redis-server.service postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$PNPM_BIN --filter @pokewar/server start
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR
UMask=0027

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable pokewar
systemctl restart pokewar

log "配置 Nginx 静态站点、API 与 WebSocket 代理"
cat > "$NGINX_FILE" <<EOF
map \$http_upgrade \$connection_upgrade {
  default upgrade;
  '' close;
}

server {
  listen 80;
  listen [::]:80;
  server_name $DOMAIN;
  root $APP_DIR/apps/web/dist;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:$APP_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /socket.io/ {
    proxy_pass http://127.0.0.1:$APP_PORT;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$connection_upgrade;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 75s;
  }

  location = /healthz {
    proxy_pass http://127.0.0.1:$APP_PORT/api/health;
    proxy_set_header Host \$host;
  }

  location / {
    try_files \$uri \$uri/ /index.html;
  }

  location ~ /\\. { deny all; }
}
EOF
ln -sfn "$NGINX_FILE" /etc/nginx/sites-enabled/pokewar
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if [[ "$ENABLE_TLS" == "1" ]]; then
  log "申请并配置 Let's Encrypt HTTPS 证书"
  certbot --nginx --non-interactive --agree-tos --redirect \
    --email "$LETSENCRYPT_EMAIL" -d "$DOMAIN"
  systemctl reload nginx
fi

log "执行上线自检"
systemctl is-active --quiet pokewar || { journalctl -u pokewar -n 80 --no-pager; fail "PokeWar 服务启动失败"; }
curl --fail --silent --show-error "http://127.0.0.1:$APP_PORT/api/health" >/dev/null
if [[ "$ENABLE_TLS" == "1" ]]; then
  curl --fail --silent --show-error "https://$DOMAIN/healthz" >/dev/null
  curl --fail --silent --show-error "https://$DOMAIN/" | grep -q '<div id="root"></div>'
  PUBLIC_URL="https://$DOMAIN"
else
  curl --fail --silent --show-error -H "Host: $DOMAIN" "http://127.0.0.1/healthz" >/dev/null
  curl --fail --silent --show-error -H "Host: $DOMAIN" "http://127.0.0.1/" | grep -q '<div id="root"></div>'
  PUBLIC_URL="http://$DOMAIN"
fi

log "部署完成：$PUBLIC_URL"
printf '服务状态：systemctl status pokewar\n实时日志：journalctl -u pokewar -f\n环境文件：%s\n' "$ENV_FILE"
