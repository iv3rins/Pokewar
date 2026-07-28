import type { GameMode, MatchSize, MatchmakingState } from '@pokewar/protocol';
import { Compass, Crown, Flag, Search, Shield, Swords, X } from 'lucide-react';
import { ModeSelector } from '../lobby/ModeSelector.js';

const FACTION_MARKS = [
  { label: '先锋', icon: Swords, className: 'faction-mark faction-vanguard' },
  { label: '守卫', icon: Shield, className: 'faction-mark faction-guard' },
  { label: '统帅', icon: Crown, className: 'faction-mark faction-command' },
  { label: '军旗', icon: Flag, className: 'faction-mark faction-banner' },
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
      <div className="tactical-orbit orbit-outer" aria-hidden="true">
        <i className="orbit-axis axis-north" />
        <i className="orbit-axis axis-east" />
        <i className="orbit-axis axis-south" />
        <i className="orbit-axis axis-west" />
      </div>
      <div className="tactical-orbit orbit-inner" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      {FACTION_MARKS.map(({ label, icon: Icon, className }) => (
        <span key={label} className={className} aria-hidden="true">
          <Icon size={24} />
          <b>{label}</b>
        </span>
      ))}
      <div className="center-title">
        <Compass size={22} aria-hidden="true" />
        <span className="center-kicker">TACTICAL CARD TABLE</span>
        <h1 id="home-title">FateDeck</h1>
        <p>选择阵型，集结将士，决定牌桌命运</p>
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
              : '访客可匹配；对手都是账号登录时计入天梯'}
        </span>
      </div>
    </section>
  );
}
