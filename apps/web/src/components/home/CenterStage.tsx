import type { GameMode, MatchSize, MatchmakingState } from '@pokewar/protocol';
import { Search, Spade, X } from 'lucide-react';
import { ModeSelector } from '../lobby/ModeSelector.js';

const ORBIT_CARDS = [
  { suit: '♠', rank: 'K', className: 'orbit-card card-one' },
  { suit: '♥', rank: 'A', className: 'orbit-card card-two' },
  { suit: '♦', rank: '7', className: 'orbit-card card-three' },
  { suit: '♣', rank: 'Q', className: 'orbit-card card-four' },
];

export function CenterStage({
  mode,
  targetSize,
  allowFallback,
  matchmaking,
  now,
  disabled,
  onMode,
  onSize,
  onFallback,
  onEnqueue,
  onCancel,
}: {
  readonly mode: GameMode;
  readonly targetSize: MatchSize;
  readonly allowFallback: boolean;
  readonly matchmaking: MatchmakingState;
  readonly now: number;
  readonly disabled: boolean;
  readonly onMode: (mode: GameMode) => void;
  readonly onSize: (size: MatchSize) => void;
  readonly onFallback: (allowed: boolean) => void;
  readonly onEnqueue: () => void;
  readonly onCancel: () => void;
}) {
  const queuedSeconds =
    matchmaking.status === 'queued'
      ? Math.max(0, Math.floor((now - matchmaking.enqueuedAt) / 1_000))
      : 0;
  const queuedDescription =
    matchmaking.status === 'queued' && matchmaking.groupedPlayers > 1
      ? `已保留 ${String(matchmaking.groupedPlayers)} / ${String(matchmaking.targetSize)} 名确认玩家，正在优先补位`
      : '正在扩大评分范围并寻找同规模玩家';
  return (
    <section className="center-stage" aria-labelledby="home-title">
      <div className="suit-orbit orbit-outer" aria-hidden="true">
        <span>♠</span>
        <span>♥</span>
        <span>♦</span>
        <span>♣</span>
      </div>
      <div className="suit-orbit orbit-inner" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      {ORBIT_CARDS.map((card) => (
        <span key={card.className} className={card.className} aria-hidden="true">
          <b>{card.rank}</b>
          <i>{card.suit}</i>
        </span>
      ))}
      <div className="center-title">
        <Spade size={22} aria-hidden="true" />
        <h1 id="home-title">POKEWAR</h1>
        <p>牌局由服务器裁决，胜负只在桌上决定</p>
      </div>
      <div className="match-controls">
        <ModeSelector
          value={mode}
          onChange={onMode}
          disabled={disabled || matchmaking.status !== 'idle'}
        />
        <div className="match-size-selector" aria-label="匹配人数">
          {([4, 8, 12] as const).map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={targetSize === size}
              disabled={disabled || matchmaking.status !== 'idle'}
              onClick={() => onSize(size)}
            >
              <strong>{size}</strong>
              <span>人局</span>
            </button>
          ))}
        </div>
        <label className="fallback-toggle">
          <input
            type="checkbox"
            checked={allowFallback}
            disabled={disabled || matchmaking.status !== 'idle' || targetSize === 4}
            onChange={(event) => onFallback(event.target.checked)}
          />
          <span>等待 60 秒后允许降级到更小规模</span>
        </label>
        {matchmaking.status === 'queued' ? (
          <button className="match-button cancel-match" type="button" onClick={onCancel}>
            <X size={21} />
            取消匹配 · {String(queuedSeconds)}s
          </button>
        ) : (
          <button
            className="match-button"
            type="button"
            disabled={disabled || matchmaking.status === 'confirming'}
            onClick={onEnqueue}
          >
            <Search size={21} />
            开始匹配
          </button>
        )}
        <span id="match-status">
          {matchmaking.status === 'queued'
            ? queuedDescription
            : matchmaking.status === 'confirming'
              ? '已找到对手，请完成确认'
              : '访客可匹配；仅双方账号时计入天梯'}
        </span>
      </div>
    </section>
  );
}
