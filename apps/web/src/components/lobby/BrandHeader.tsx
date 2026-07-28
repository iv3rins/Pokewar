import { BookOpen } from 'lucide-react';
import type { ConnectionState } from '../../services/roomSocket.js';
import { AudioControl } from './AudioControl.js';

const STATUS: Record<ConnectionState, string> = {
  connecting: '正在连接',
  connected: '服务在线',
  disconnected: '连接中断',
  'read-only': '只读标签页',
};

export function BrandHeader({
  connection,
  account,
  onAuth,
  onRules,
}: {
  readonly connection: ConnectionState;
  readonly account: boolean;
  readonly onAuth: () => void;
  readonly onRules: () => void;
}) {
  return (
    <header className="lobby-header">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          PW
        </span>
        <div>
          <strong>POKEWAR</strong>
          <span>在线竞技牌桌</span>
        </div>
      </div>
      <div className="header-actions">
        <button
          className="header-icon-button"
          type="button"
          aria-label="打开游戏规则"
          title="游戏规则"
          onClick={onRules}
        >
          <BookOpen size={18} />
        </button>
        <AudioControl />
        {!account ? (
          <button
            className="header-auth"
            type="button"
            aria-label="打开注册或登录"
            onClick={onAuth}
          >
            注册 / 登录
          </button>
        ) : null}
        <span
          className={`service-state state-${connection}`}
          aria-label={`连接状态：${STATUS[connection]}`}
        >
          <i />
          <span>{STATUS[connection]}</span>
        </span>
      </div>
    </header>
  );
}
