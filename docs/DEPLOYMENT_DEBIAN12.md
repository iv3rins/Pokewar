# Debian 12 单机一键部署指南

本指南面向一台**全新 Debian 12** 服务器，部署拓扑为：

```text
Internet -> Nginx (HTTPS / 静态网页 / WebSocket)
                 -> Node.js PokeWar (127.0.0.1:3000)
                 -> Redis (127.0.0.1:6379)
                 -> PostgreSQL (127.0.0.1:5432)
```

适合首发小规模（少于 100 人同时在线）。脚本会安装 Node.js 22、pnpm、Nginx、Redis、PostgreSQL 和 Certbot，创建数据库和 systemd 服务，执行迁移与构建，并申请 Let's Encrypt 证书。

## 1. 部署前准备

1. 将域名 `game.n1komajor.top` 的 A/AAAA 记录解析到服务器公网地址。
2. 云厂商安全组和服务器防火墙允许 TCP `22`、`80`、`443`。
3. Redis、PostgreSQL 和 Node 的 `3000` 端口**不要向公网开放**。
4. 将完整项目上传或克隆到服务器，例如 `/root/pokewar-final`。
5. 确保 80/443 没有被其他服务占用。

验证 DNS：

```bash
getent ahosts game.n1komajor.top
```

## 2. 一键部署

在项目根目录运行：

```bash
cd /root/pokewar-final
sudo DOMAIN=game.n1komajor.top \
  LETSENCRYPT_EMAIL=iverins.user@gmail.com \
  bash scripts/deploy-debian12.sh
```

脚本默认值已经是上述域名和邮箱，因此也可直接运行：

```bash
sudo bash scripts/deploy-debian12.sh
```

完成后访问：<https://game.n1komajor.top>

> 脚本可重复执行用于更新发布。数据库密码和 `GUEST_SECRET` 会从现有 `/etc/pokewar/pokewar.env` 自动复用，避免更新后数据库连接失败或访客 Cookie 失效。

## 3. 日常检查

```bash
# 应用状态
systemctl status pokewar --no-pager

# 应用实时日志
journalctl -u pokewar -f

# Nginx 状态与配置
systemctl status nginx --no-pager
nginx -t

# Redis / PostgreSQL
systemctl status redis-server postgresql --no-pager

# 本机应用健康检查
curl --fail http://127.0.0.1:3000/api/health

# 外部 HTTPS 健康检查
curl --fail https://game.n1komajor.top/healthz
```

环境变量保存在 `/etc/pokewar/pokewar.env`，权限为 root 与 `pokewar` 服务组可读。不要提交或公开此文件。

## 4. 更新版本

将新代码覆盖到原项目目录，然后再次执行脚本；现有数据库密码和访客密钥会自动复用：

```bash
cd /root/pokewar-final
sudo bash scripts/deploy-debian12.sh
```

脚本将重新同步代码、安装锁文件依赖、执行幂等迁移、构建并重启服务。更新后检查：

```bash
curl --fail https://game.n1komajor.top/healthz
journalctl -u pokewar -n 100 --no-pager
```

## 5. 回滚

发布前保留上一版代码压缩包或 Git 提交。出现问题时：

```bash
sudo systemctl stop pokewar
# 将上一版代码恢复到部署源目录，再运行部署脚本
sudo bash scripts/deploy-debian12.sh
```

数据库迁移当前只使用 `CREATE TABLE/INDEX IF NOT EXISTS`，但未来任何破坏性迁移都必须先备份并编写独立回滚计划。

## 6. 备份

至少每天备份 PostgreSQL；Redis 只承载活跃房间，仍建议保留 RDB/AOF 和服务器级快照。

```bash
sudo install -d -m 0700 /var/backups/pokewar
sudo -u postgres pg_dump --format=custom pokewar \
  > /var/backups/pokewar/pokewar-$(date +%F-%H%M).dump
```

示例恢复（会覆盖目标库前必须确认）：

```bash
sudo -u postgres pg_restore --clean --if-exists --dbname=pokewar BACKUP.dump
```

建议在异机或对象存储中保留加密副本，并定期实际演练恢复。仅有本机备份不算灾难恢复。

## 7. TLS 与证书续期

Debian 的 Certbot 包会安装 systemd 定时任务。检查：

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

证书申请失败时，优先检查 DNS、80/443 入站规则、IPv6 AAAA 是否指向正确服务器，以及 Nginx 是否正常监听 80。

## 8. 防火墙建议

如果使用 UFW：

```bash
sudo apt-get install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

执行 `ufw enable` 前必须确认 SSH 规则已允许，否则可能锁死远程连接。

## 9. 当前健康检查的边界

`/api/health` 会证明 Node 进程可响应并显示当前存储模式，但当前版本不会主动执行 Redis/PostgreSQL读写探测。因此上线监控还应分别检查：

```bash
redis-cli ping
sudo -u postgres pg_isready
```

## 10. 上线前必须完成的人工验收

1. 两个独立浏览器/隐身窗口完成私人房：创建、加入、准备、开始、出牌。
2. 测试普通战和快速战；测试 4 人 PVE。
3. 断网后 30 秒内恢复，以及超过 30 秒淘汰。
4. 注册、登录、注销、重启服务后重新登录。
5. 公开匹配确认流程以及天梯数据。
6. 360×800、1366×768、1920×1080 检查对战区和手牌无需页面滚动且无重叠。
7. 验证 WebSocket：浏览器开发者工具中 `/socket.io/` 状态保持连接。
8. 执行一次 PostgreSQL 备份并在临时数据库恢复。

未经真实 Redis/PostgreSQL 环境集成测试与上述多人验收，不建议直接开放公网流量。
