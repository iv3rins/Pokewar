import type { MatchmakingState } from '@pokewar/protocol';
import { Check, X } from 'lucide-react';

export function ConfirmationOverlay({
  state,
  now,
  onAccept,
  onDecline,
}: {
  readonly state: Extract<MatchmakingState, { status: 'confirming' }>;
  readonly now: number;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}) {
  const remaining = Math.max(0, Math.ceil((state.expiresAt - now) / 1_000));
  return (
    <div className="confirmation-overlay" role="dialog" aria-labelledby="confirm-title">
      <div className="confirmation-card">
        <header>
          <h2 id="confirm-title">匹配成功</h2>
          <span className="countdown">{String(remaining)} 秒</span>
        </header>
        <div className="match-info">
          <div className="info-row">
            <span>对局规模</span>
            <strong>
              {state.mode === 'normal' ? '标准战' : '快速战'} · {String(state.finalSize)} 人局
            </strong>
          </div>
          <div className="info-row">
            <span>排位状态</span>
            <strong>{state.ranked ? '排位对局' : '非排位（含访客）'}</strong>
          </div>
        </div>
        {state.accepted ? (
          <div className="accepted-notice">
            <Check size={20} />
            <span>已接受，等待其他玩家确认</span>
          </div>
        ) : (
          <div className="confirmation-actions">
            <button className="accept-button" type="button" onClick={onAccept}>
              <Check size={21} />
              接受对局
            </button>
            <button className="decline-button" type="button" onClick={onDecline}>
              <X size={21} />
              拒绝
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
