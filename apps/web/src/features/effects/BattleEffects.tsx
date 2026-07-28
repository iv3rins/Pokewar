import type { BattleNotice, GameProjection } from '@pokewar/protocol';
import { History, Shield, X } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { useEffectQueue } from './useEffectQueue.js';
import { nullCanvasAdapter } from './types.js';

const SUIT_SYMBOL = { spade: '♠', heart: '♥', diamond: '♦', club: '♣' } as const;
const SUIT_LABEL = { spade: '黑桃', heart: '红桃', diamond: '方块', club: '梅花' } as const;
const MAX_HP = { J: 30, Q: 40, K: 50 } as const;
type Player = GameProjection['players'][number];
function playerName(game: GameProjection, id: string | null): string {
  return game.players.find((player) => player.id === id)?.displayName ?? '牌桌';
}

export function noticeDescription(game: GameProjection, notice: BattleNotice): string {
  const actor = playerName(game, notice.actorPlayerId);
  const target = playerName(game, notice.targetPlayerId);
  switch (notice.kind) {
    case 'play': {
      const cards =
        notice.cards
          ?.map(
            (card) =>
              `${String(card.value)}${SUIT_SYMBOL[card.suit]}${card.fused ? '（万化）' : ''}`,
          )
          .join('、') ?? '牌组';
      return `${actor} 打出 ${cards}${notice.targetPlayerId ? `，攻击 ${target}` : '，获得护盾'}；总点数 ${String(notice.value ?? 0)}`;
    }
    case 'combat': {
      const parts = [
        notice.shieldLost ? `护盾损失 ${String(notice.shieldLost)}` : '',
        notice.hpLost ? `HP 损失 ${String(notice.hpLost)}` : '',
        notice.healing ? `治疗 ${String(notice.healing)}` : '',
        notice.shieldGained ? `获得护盾 ${String(notice.shieldGained)}` : '',
      ].filter(Boolean);
      return notice.targetPlayerId
        ? `${target}：${parts.join('，') || '攻击未造成数值变化'}`
        : `${actor}：${parts.join('，') || '防御完成'}`;
    }
    case 'fusion':
      return `${actor} 生成点数 ${String(notice.value ?? 0)} 的万化牌`;
    case 'rescue':
      return `${actor} 使用 Joker 救援 ${target}`;
    case 'elimination':
      return `${target} 被淘汰`;
    case 'replacement':
      return `${actor} 选择了替补角色`;
    case 'timeout':
      return `${actor} 回合超时并损失 ${String(notice.value ?? 0)} HP`;
    case 'turn':
      return `轮到 ${actor} 行动`;
    case 'game-over':
      return `${actor} 赢得本局对战`;
  }
}

function CombatMeter({
  label,
  value,
  max,
  previous,
  kind,
}: {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly previous: number;
  readonly kind: 'hp' | 'shield';
}) {
  const percent = Math.min(100, (value / max) * 100);
  const previousPercent = Math.min(100, (previous / max) * 100);
  return (
    <div className="combat-meter-row">
      <span>{label}</span>
      <div className={`combat-meter combat-meter-${kind}`}>
        <i
          style={
            {
              '--meter-from': `${String(previousPercent)}%`,
              '--meter-to': `${String(percent)}%`,
            } as CSSProperties
          }
        />
      </div>
      <b>{value}</b>
    </div>
  );
}

function CombatantCard({
  player,
  role,
  hpLost = 0,
  shieldLost = 0,
  healing = 0,
  shieldGained = 0,
  impact = false,
}: {
  readonly player: Player;
  readonly role: 'actor' | 'target' | 'current';
  readonly hpLost?: number;
  readonly shieldLost?: number;
  readonly healing?: number;
  readonly shieldGained?: number;
  readonly impact?: boolean;
}) {
  const character = player.activeCharacter;
  if (!character) return null;
  const maxHp = MAX_HP[character.rank];
  const previousHp = Math.min(maxHp, Math.max(0, character.hp + hpLost - healing));
  const previousShield = Math.max(0, character.shield + shieldLost - shieldGained);
  const delta = hpLost || shieldLost || healing || shieldGained;
  const positive = healing > 0 || shieldGained > 0;
  return (
    <article
      className={`combatant-card combatant-${role}${impact ? ' is-impacted' : ''}`}
      data-player-id={player.id}
    >
      <header>
        <span>{role === 'actor' ? '攻击者' : role === 'target' ? '受击者' : '当前行动'}</span>
        <small>{player.handCount} 张手牌</small>
      </header>
      <div className="combatant-rank">
        <strong>{character.rank}</strong>
      </div>
      <span className={`suit-badge combat-suit-badge suit-${character.suit}`}>
        <b aria-hidden="true">{SUIT_SYMBOL[character.suit]}</b>
        <span>{SUIT_LABEL[character.suit]}</span>
      </span>
      <h3>{player.displayName}</h3>
      <p>{character.rank}</p>
      <div className="combatant-status">
        <CombatMeter label="HP" value={character.hp} max={maxHp} previous={previousHp} kind="hp" />
        <CombatMeter
          label="盾"
          value={character.shield}
          max={maxHp}
          previous={previousShield}
          kind="shield"
        />
      </div>
      {delta > 0 ? (
        <strong className={`combatant-delta${positive ? ' is-positive' : ''}`}>
          {positive ? '+' : '-'}
          {delta}
        </strong>
      ) : null}
    </article>
  );
}

function ShieldResultCard({
  actor,
  combat,
}: {
  readonly actor: Player;
  readonly combat: BattleNotice | null;
}) {
  const character = actor.activeCharacter;
  if (!character) return null;
  return (
    <article className="shield-result-card">
      <span>防御结果</span>
      <Shield size={54} aria-hidden="true" />
      <strong>+{combat?.shieldGained ?? combat?.value ?? 0}</strong>
      <p>{actor.displayName} 获得护盾</p>
    </article>
  );
}

function PlayedGroup({ play }: { readonly play: BattleNotice }) {
  const cards = play.cards ?? [];
  return (
    <div className="combat-play-group">
      <span>打出的牌</span>
      <div className="combat-play-cards">
        {cards.map((card, index) => (
          <article
            className={`combat-play-card suit-${card.suit}${card.fused ? ' is-fused' : ''}`}
            style={
              {
                '--combat-card-index': index,
                '--combat-card-count': cards.length,
              } as CSSProperties
            }
            key={`${play.id}:${String(index)}`}
          >
            <b>{card.value}</b>
            <i>{SUIT_SYMBOL[card.suit]}</i>
            {card.fused ? <small>万化</small> : null}
          </article>
        ))}
      </div>
      <strong>总点数 {play.value ?? 0}</strong>
    </div>
  );
}

function latestAction(game: GameProjection): {
  readonly play: BattleNotice | null;
  readonly combat: BattleNotice | null;
} {
  let playIndex = -1;
  for (let index = game.notices.length - 1; index >= 0; index -= 1) {
    if (game.notices[index]?.kind === 'play') {
      playIndex = index;
      break;
    }
  }
  if (playIndex < 0) return { play: null, combat: null };
  const play = game.notices[playIndex] ?? null;
  const combat =
    game.notices
      .slice(playIndex + 1)
      .find((notice) => notice.kind === 'combat' && notice.actorPlayerId === play?.actorPlayerId) ??
    null;
  return { play, combat };
}

export function CombatPresentation({ game }: { readonly game: GameProjection }) {
  const { cue } = useEffectQueue(game, nullCanvasAdapter);
  const { play, combat } = latestAction(game);
  const actor = game.players.find((player) => player.id === play?.actorPlayerId) ?? null;
  const target = game.players.find((player) => player.id === play?.targetPlayerId) ?? null;
  const current = game.players.find((player) => player.id === game.currentPlayerId) ?? null;

  if (!play || !actor) {
    return (
      <section className="combat-presentation is-idle" aria-label="当前战斗展示">
        {current ? <CombatantCard player={current} role="current" /> : null}
        <p>等待当前玩家出牌</p>
      </section>
    );
  }

  const effectKind = cue?.kind ?? play.cards?.[0]?.suit ?? 'text';
  return (
    <section
      className={`combat-presentation effect-${effectKind}${cue?.shake ? ' effect-shake' : ''}`}
      aria-label="最近一次战斗"
    >
      <CombatantCard
        player={actor}
        role="actor"
        healing={combat?.healing ?? 0}
        shieldGained={!target ? (combat?.shieldGained ?? 0) : 0}
      />
      <div className="combat-center-action">
        <PlayedGroup play={play} />
        <i className="combat-effect-burst" aria-hidden="true" />
      </div>
      {target ? (
        <CombatantCard
          player={target}
          role="target"
          hpLost={combat?.hpLost ?? 0}
          shieldLost={combat?.shieldLost ?? 0}
          impact={cue?.targetPlayerId === target.id}
        />
      ) : (
        <ShieldResultCard actor={actor} combat={combat} />
      )}
    </section>
  );
}

export function BattleHistory({ game }: { readonly game: GameProjection }) {
  const [open, setOpen] = useState(false);
  const notices = game.notices.slice(-10).reverse();
  return (
    <>
      <button
        className="game-button icon-command"
        type="button"
        aria-label="打开战斗历史"
        title="战斗历史"
        onClick={() => setOpen(true)}
      >
        <History size={18} />
      </button>
      {open ? (
        <aside
          className="battle-history"
          role="dialog"
          aria-modal="false"
          aria-labelledby="battle-history-title"
        >
          <header>
            <h2 id="battle-history-title">战斗历史</h2>
            <button type="button" aria-label="关闭战斗历史" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
          </header>
          <ol>
            {notices.length === 0 ? (
              <li>尚无公开战斗事件</li>
            ) : (
              notices.map((notice) => (
                <li key={notice.id}>
                  <span>{notice.kind}</span>
                  <p>{noticeDescription(game, notice)}</p>
                </li>
              ))
            )}
          </ol>
        </aside>
      ) : null}
    </>
  );
}
