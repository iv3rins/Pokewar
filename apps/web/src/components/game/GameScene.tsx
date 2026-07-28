import type { GameProjection, RoomProjection } from '@pokewar/protocol';
import { Bot, Clock3, Heart, LogOut, Shield, Spade, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { GameAction } from '../../services/roomSocket.js';
import { audioEngine } from '../../services/audio.js';
import { hasFinishedPveTutorial, TutorialGuide } from './TutorialGuide.js';
import {
  BattleHistory,
  CombatPresentation,
  noticeDescription,
} from '../../features/effects/BattleEffects.js';

const SUIT_LABEL = {
  spade: '♠ 黑桃',
  heart: '♥ 红桃',
  diamond: '♦ 方块',
  club: '♣ 梅花',
} as const;
const MAX_HP = { J: 30, Q: 40, K: 50 } as const;
type Player = GameProjection['players'][number];
type Character = NonNullable<Player['activeCharacter']>;
type HandCard = NonNullable<Player['hand']>[number];

function nameOf(game: GameProjection, id: string | null): string {
  return game.players.find((player) => player.id === id)?.displayName ?? '牌桌';
}

function CharacterCard({
  character,
  selected = false,
  onSelect,
}: {
  readonly character: Character;
  readonly selected?: boolean;
  readonly onSelect?: () => void;
}) {
  return (
    <button
      className="character-card"
      type="button"
      aria-pressed={onSelect ? selected : undefined}
      disabled={!onSelect || character.eliminated}
      onClick={onSelect}
    >
      <span className={`character-suit suit-${character.suit}`}>{SUIT_LABEL[character.suit]}</span>
      <strong>{character.rank}</strong>
      <span className="character-health">
        <Heart size={16} aria-hidden="true" />
        {character.hp}
      </span>
      <span className="character-shield">
        <Shield size={16} aria-hidden="true" />
        {character.shield}
      </span>
    </button>
  );
}

function CharacterChoice({
  title,
  description,
  characters,
  disabled,
  onConfirm,
}: {
  readonly title: string;
  readonly description: string;
  readonly characters: readonly Character[];
  readonly disabled: boolean;
  readonly onConfirm: (id: string) => void;
}) {
  const available = characters.filter((character) => !character.eliminated);
  const [selectedId, setSelectedId] = useState(available[0]?.id ?? '');
  useEffect(() => {
    if (!available.some((character) => character.id === selectedId))
      setSelectedId(available[0]?.id ?? '');
  }, [available, selectedId]);
  return (
    <section
      className="starter-stage"
      aria-labelledby="character-choice-title"
      data-tutorial="starter"
    >
      <div className="starter-heading">
        <Spade size={24} aria-hidden="true" />
        <h2 id="character-choice-title">{title}</h2>
        <p>{description}</p>
      </div>
      <div className="character-selection-list">
        {available.map((character) => (
          <CharacterCard
            key={character.id}
            character={character}
            selected={selectedId === character.id}
            onSelect={() => setSelectedId(character.id)}
          />
        ))}
      </div>
      <button
        className="game-button primary starter-confirm"
        type="button"
        disabled={disabled || !selectedId}
        onClick={() => onConfirm(selectedId)}
      >
        确认角色
      </button>
    </section>
  );
}

function StarterSelection({
  room,
  selfId,
  disabled,
  onSelectStarter,
  onLeave,
}: {
  readonly room: RoomProjection;
  readonly selfId: string;
  readonly disabled: boolean;
  readonly onSelectStarter: (id: string) => void;
  readonly onLeave: () => void;
}) {
  const self = room.game?.players.find((player) => player.id === selfId);
  const alreadySelected = self?.activeCharacter !== null;
  return (
    <main className="game-shell starter-scene">
      <header className="game-scene-header">
        <div>
          <span>NORMAL MODE · ROOM {room.id}</span>
          <h1>选择首发角色</h1>
        </div>
        <div className="table-header-actions">
          <div className="scene-phase">
            <Clock3 size={18} aria-hidden="true" />
            服务器正在等待所有玩家
          </div>
          <button
            className="game-button icon-command"
            type="button"
            aria-label="退出对局"
            onClick={onLeave}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      {alreadySelected ? (
        <section className="starter-stage">
          <p className="starter-waiting" role="status">
            已锁定首发角色，正在等待其他玩家完成选择…
          </p>
        </section>
      ) : (
        <CharacterChoice
          title="从 J、Q、K 中选择本局首发"
          description="每个角色拥有独立花色与生命值。所有玩家完成选择后同时揭示。"
          characters={self.characters ?? []}
          disabled={disabled}
          onConfirm={onSelectStarter}
        />
      )}
    </main>
  );
}

function StatusBars({ character }: { readonly character: Character }) {
  const maxHp = MAX_HP[character.rank];
  const hpPercent = Math.max(0, Math.min(100, (character.hp / maxHp) * 100));
  const shieldPercent = Math.max(0, Math.min(100, (character.shield / maxHp) * 100));
  return (
    <div className="status-bars">
      <div className="status-line">
        <span>HP</span>
        <div className="meter hp-meter">
          <i style={{ width: `${String(hpPercent)}%` }} />
        </div>
        <b>
          {character.hp}/{maxHp}
        </b>
      </div>
      <div className="status-line">
        <span>盾</span>
        <div className="meter shield-meter">
          <i style={{ width: `${String(shieldPercent)}%` }} />
        </div>
        <b>
          {character.shield}
          {character.shield > maxHp ? ` (+${String(character.shield - maxHp)})` : ''}
        </b>
      </div>
    </div>
  );
}

function PlayerEmblem({
  character,
  bot = false,
}: {
  readonly character: Character | null;
  readonly bot?: boolean;
}) {
  return (
    <span
      className={`player-emblem ${character ? `emblem-${character.suit}` : ''}`}
      aria-hidden="true"
    >
      {bot ? <Bot size={22} /> : (character?.rank ?? '?')}
    </span>
  );
}

function OpponentHud({
  player,
  current,
  selected,
  selectable,
  onSelect,
}: {
  readonly player: Player;
  readonly current: boolean;
  readonly selected: boolean;
  readonly selectable: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      className={`opponent-player${current ? ' is-current' : ''}${selected ? ' is-target' : ''}`}
      type="button"
      disabled={!selectable}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <PlayerEmblem character={player.activeCharacter} bot />
      <div className="opponent-summary">
        <strong>{player.displayName}</strong>
        <span>
          {player.handCount} 张手牌{selected ? ' · 目标' : ''}
        </span>
      </div>
      {player.activeCharacter ? (
        <>
          <span className={`opponent-rank suit-${player.activeCharacter.suit}`}>
            {player.activeCharacter.rank} · {SUIT_LABEL[player.activeCharacter.suit]}
          </span>
          <StatusBars character={player.activeCharacter} />
        </>
      ) : null}
    </button>
  );
}

function cardLabel(card: HandCard): string {
  if (card.kind === 'joker') return 'JOKER';
  if (card.kind === 'fused') return `${String(card.value)} ${SUIT_LABEL[card.suit].slice(0, 1)}`;
  return `${String(card.rank)} ${SUIT_LABEL[card.suit].slice(0, 1)}`;
}
function cardSuit(card: HandCard): keyof typeof SUIT_LABEL | null {
  return card.kind === 'joker' ? null : card.suit;
}

function selectionState(cards: readonly HandCard[]): {
  valid: boolean;
  attack: boolean;
  execution: boolean;
  message: string;
} {
  if (cards.length === 0)
    return {
      valid: false,
      attack: false,
      execution: false,
      message: '请选择 1、3 或 5 张同花色牌。',
    };
  if (cards.length === 2 && cards.every((card) => card.kind === 'joker'))
    return {
      valid: true,
      attack: true,
      execution: true,
      message: '双 Joker 处决：请选择一名对手。',
    };
  if (cards.some((card) => card.kind === 'joker'))
    return { valid: false, attack: false, execution: false, message: 'Joker 不能加入普通组合。' };
  if (![1, 3, 5].includes(cards.length))
    return {
      valid: false,
      attack: false,
      execution: false,
      message: '普通出牌只能选择 1、3 或 5 张。',
    };
  const firstCard = cards[0];
  if (!firstCard)
    return { valid: false, attack: false, execution: false, message: '请选择要出的牌。' };
  const suit = cardSuit(firstCard);
  if (cards.some((card) => cardSuit(card) !== suit))
    return { valid: false, attack: false, execution: false, message: '多张牌必须具有相同花色。' };
  const attack = suit !== 'club';
  return {
    valid: true,
    attack,
    execution: false,
    message: attack ? '组合合法，请选择攻击目标。' : '梅花防御无需选择目标。',
  };
}

function noticeText(game: GameProjection): string {
  const notice = game.notices.at(-1);
  return notice
    ? noticeDescription(game, notice)
    : game.currentPlayerId
      ? `轮到 ${nameOf(game, game.currentPlayerId)} 行动`
      : '牌桌准备中';
}

function FusionModal({
  cards,
  onClose,
  onConfirm,
}: {
  readonly cards: readonly HandCard[];
  readonly onClose: () => void;
  readonly onConfirm: (suit: 'spade' | 'heart' | 'diamond' | 'club') => void;
}) {
  const suits = [
    ...new Set(cards.flatMap((card) => (card.kind === 'physical' ? [card.suit] : []))),
  ];
  return (
    <div className="overlay auth-overlay">
      <section
        className="combat-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fusion-title"
      >
        <button className="close-button" type="button" aria-label="关闭万化窗口" onClick={onClose}>
          <X />
        </button>
        <h2 id="fusion-title">选择万化花色</h2>
        <p>融合牌点数为非 A 牌点数加一。融合不会结束当前回合。</p>
        <div className="fusion-suits">
          {suits.map((suit) => (
            <button
              className="game-button primary"
              type="button"
              key={suit}
              onClick={() => onConfirm(suit)}
            >
              {SUIT_LABEL[suit]}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ConfirmModal({
  title,
  description,
  confirmText,
  onClose,
  onConfirm,
}: {
  readonly title: string;
  readonly description: string;
  readonly confirmText: string;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div className="overlay auth-overlay">
      <section
        className="combat-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-action-title"
      >
        <h2 id="confirm-action-title">{title}</h2>
        <p>{description}</p>
        <div className="modal-actions">
          <button className="game-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="game-button danger" type="button" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </section>
    </div>
  );
}

function TableScene({
  room,
  selfId,
  now,
  disabled,
  onCommand,
  onLeave,
  onReturnLobby,
}: {
  readonly room: RoomProjection;
  readonly selfId: string;
  readonly now: number;
  readonly disabled: boolean;
  readonly onCommand: (command: GameAction) => void;
  readonly onLeave: () => void;
  readonly onReturnLobby: () => void;
}) {
  const game = room.game;
  const isPve = room.kind === 'pve';
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [fusionOpen, setFusionOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [dealing, setDealing] = useState(false);
  useEffect(() => {
    setSelectedIds([]);
    setTargetId(null);
  }, [game?.version]);
  useEffect(() => {
    if (!game) return;
    const dealKey = `pokewar:dealt:${room.id}`;
    if (!sessionStorage.getItem(dealKey) && game.players.some((player) => player.handCount > 0)) {
      sessionStorage.setItem(dealKey, '1');
      setDealing(true);
      const selfHandCount = game.players.find((player) => player.id === selfId)?.handCount ?? 0;
      for (let index = 0; index < Math.min(7, selfHandCount); index += 1) {
        window.setTimeout(() => audioEngine.play('deal'), index * 100);
      }
      window.setTimeout(() => setDealing(false), Math.max(700, selfHandCount * 110));
    }
    const notice = game.notices.at(-1);
    if (!notice) return;
    const sound =
      notice.kind === 'play'
        ? 'play'
        : notice.kind === 'combat'
          ? 'damage'
          : notice.kind === 'rescue'
            ? 'joker'
            : notice.kind === 'turn'
              ? 'turn'
              : notice.kind === 'game-over'
                ? notice.actorPlayerId === selfId
                  ? 'win'
                  : 'lose'
                : null;
    if (sound) audioEngine.play(sound);
  }, [game, room.id, selfId]);
  if (!game) return null;
  const self = game.players.find((player) => player.id === selfId);
  const opponents = game.players.filter((player) => player.id !== selfId && !player.eliminated);
  const current = game.players.find((player) => player.id === game.currentPlayerId);
  const selectedCards = self?.hand?.filter((card) => selectedIds.includes(card.id)) ?? [];
  const selection = selectionState(selectedCards);
  const isTurn = game.phase === 'PLAYING' && game.currentPlayerId === selfId;
  const needsTarget = selection.valid && selection.attack;
  const canSubmit = isTurn && selection.valid && (!needsTarget || targetId !== null) && !disabled;
  const fusionCards =
    selectedCards.length === 2 &&
    selectedCards.every((card) => card.kind === 'physical') &&
    selectedCards.some((card) => card.rank === 'A') &&
    selectedCards.some((card) => card.rank !== 'A');
  const seconds = game.turnDeadline
    ? Math.max(0, Math.ceil((game.turnDeadline - now) / 1_000))
    : null;
  const pendingForSelf = game.pendingAction?.offeredPlayerId === selfId;
  const replacementForSelf =
    game.phase === 'SELECTING_REPLACEMENT' && game.pendingAction?.victimPlayerId === selfId;
  const joker = self?.hand?.find((card) => card.kind === 'joker');
  const winner =
    game.phase === 'GAME_OVER' ? game.players.find((player) => !player.eliminated) : null;

  if (replacementForSelf)
    return (
      <main className="game-shell starter-scene">
        <header className="game-scene-header">
          <div>
            <span>REPLACEMENT · ROOM {room.id}</span>
            <h1>选择替补角色</h1>
          </div>
        </header>
        <CharacterChoice
          title="选择下一名角色"
          description="确认后将弃掉当前手牌并摸取至五张。"
          characters={self?.characters ?? []}
          disabled={disabled}
          onConfirm={(characterId) => onCommand({ kind: 'game:select-replacement', characterId })}
        />
      </main>
    );
  if (game.phase === 'GAME_OVER')
    return (
      <main className="game-shell result-scene">
        <section>
          <span>{isPve ? 'PVE RESULT' : 'MATCH RESULT'}</span>
          <h1>
            {winner?.id === selfId ? '你赢得了对局' : `${winner?.displayName ?? '对手'} 获胜`}
          </h1>
          <p>
            {game.mode === 'normal' ? '标准战' : '快速战'} · {game.players.length} 人局 ·{' '}
            {isPve ? 'PVE 不计入天梯' : room.kind === 'matchmade' ? '公开匹配' : '私人房'}
          </p>
          <button className="game-button primary" type="button" onClick={onReturnLobby}>
            返回大厅
          </button>
        </section>
      </main>
    );

  const submit = () => {
    if (!canSubmit) return;
    if (selection.execution) {
      if (!targetId) return;
      onCommand({
        kind: 'game:execute-character',
        jokerCardIds: selectedIds as [string, string],
        targetPlayerId: targetId,
      });
    } else
      onCommand({
        kind: 'game:play-cards',
        cardIds: selectedIds as
          [string] | [string, string, string] | [string, string, string, string, string],
        ...(targetId ? { targetPlayerId: targetId } : {}),
      });
  };

  return (
    <main className="game-shell table-scene">
      <header className="game-scene-header">
        <div>
          <span>
            {game.mode === 'quick' ? 'QUICK MODE' : 'NORMAL MODE'} · ROOM {room.id}
          </span>
          <h1>{isPve ? 'PVE 牌桌' : room.kind === 'matchmade' ? '公开匹配牌桌' : '私人牌桌'}</h1>
        </div>
        <div className="table-header-actions">
          <div className="scene-phase current-turn-signal">
            <Clock3 size={18} aria-hidden="true" />
            {current?.id === selfId ? '你的回合' : `${current?.displayName ?? '牌桌'}的回合`}
            {seconds === null ? '' : ` · ${String(seconds)}s`}
          </div>
          <BattleHistory game={game} />
          <button
            className="game-button icon-command"
            type="button"
            aria-label="退出对局"
            title="退出对局"
            onClick={() => setLeaveOpen(true)}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <section
        className="opponent-strip"
        aria-label={isPve ? '机器人对手' : '其他玩家'}
        data-tutorial="targets"
      >
        {opponents.map((player) => (
          <OpponentHud
            key={player.id}
            player={player}
            current={player.id === game.currentPlayerId}
            selected={player.id === targetId}
            selectable={isTurn && selection.valid && selection.attack}
            onSelect={() => setTargetId(player.id)}
          />
        ))}
      </section>
      <section className="battle-stage" aria-label="中央战斗舞台" data-tutorial="battle">
        <Users size={28} aria-hidden="true" />
        <h2>
          {current?.id === selfId ? '轮到你行动' : isPve ? '等待机器人行动' : '等待其他玩家行动'}
        </h2>
        <p>{noticeText(game)}</p>
        <CombatPresentation game={game} />
        <div className="event-ribbon" role="status" aria-live="polite" data-tutorial="combination">
          {selection.message}
        </div>
      </section>
      {pendingForSelf ? (
        <section className="rescue-ribbon" aria-label="Joker 救援选择">
          <strong>
            是否使用 Joker 救援 {nameOf(game, game.pendingAction?.victimPlayerId ?? null)}？
          </strong>
          <div>
            {joker ? (
              <button
                className="game-button primary"
                type="button"
                disabled={disabled}
                onClick={() => onCommand({ kind: 'game:rescue-with-joker', jokerCardId: joker.id })}
              >
                使用 Joker 救援
              </button>
            ) : null}
            <button
              className="game-button danger"
              type="button"
              disabled={disabled}
              onClick={() => onCommand({ kind: 'game:decline-rescue' })}
            >
              拒绝救援
            </button>
          </div>
        </section>
      ) : null}
      {dealing ? (
        <div className="deal-deck" aria-hidden="true">
          <span>牌堆</span>
        </div>
      ) : null}
      <section className="self-tray" aria-label="你的角色与手牌">
        {self?.activeCharacter ? (
          <div className={`self-player-hud${isTurn ? ' is-current' : ''}`}>
            <PlayerEmblem character={self.activeCharacter} />
            <div className="self-player-copy">
              <span>你的角色 · {self.handCount} 张手牌</span>
              <strong>{self.displayName}</strong>
              <small>
                {self.activeCharacter.rank} · {SUIT_LABEL[self.activeCharacter.suit]}
                {isTurn ? ' · 当前回合' : ''}
              </small>
            </div>
            <StatusBars character={self.activeCharacter} />
          </div>
        ) : null}
        <div
          className="hand-tray"
          aria-label={`你的手牌，共 ${String(self?.handCount ?? 0)} 张`}
          data-tutorial="hand"
        >
          {self?.hand?.map((card, cardIndex) => {
            const selected = selectedIds.includes(card.id);
            return (
              <button
                className={`hand-card suit-${cardSuit(card) ?? 'joker'}${card.kind === 'fused' ? ' is-fused' : ''}${cardSuit(card) === 'heart' || cardSuit(card) === 'diamond' ? ' is-red' : ''}${selected ? ' is-selected' : ''}${dealing ? ' is-dealing' : ''}`}
                style={dealing ? { animationDelay: `${String(cardIndex * 90)}ms` } : undefined}
                type="button"
                aria-pressed={selected}
                disabled={!isTurn || disabled}
                key={card.id}
                onClick={() => {
                  audioEngine.play(selected ? 'button' : 'select');
                  setSelectedIds(
                    selected
                      ? selectedIds.filter((id) => id !== card.id)
                      : [...selectedIds, card.id],
                  );
                }}
              >
                {cardLabel(card)}
              </button>
            );
          })}
        </div>
        <div className="play-actions" data-tutorial="actions">
          {fusionCards ? (
            <button
              className="game-button"
              type="button"
              disabled={!isTurn || disabled}
              onClick={() => setFusionOpen(true)}
            >
              万化融合
            </button>
          ) : null}
          <button
            className="game-button primary"
            type="button"
            disabled={!canSubmit}
            onClick={submit}
          >
            {selection.execution ? '执行处决' : '确认出牌'}
          </button>
        </div>
      </section>
      {fusionOpen ? (
        <FusionModal
          cards={selectedCards}
          onClose={() => setFusionOpen(false)}
          onConfirm={(selectedSuit) => {
            onCommand({
              kind: 'game:create-fusion',
              cardIds: selectedIds as [string, string],
              selectedSuit,
            });
            setFusionOpen(false);
          }}
        />
      ) : null}
      {leaveOpen ? (
        <ConfirmModal
          title="退出当前对局？"
          description="主动退出会立即淘汰你的所有角色，并按普通失败结算。"
          confirmText="确认退出"
          onClose={() => setLeaveOpen(false)}
          onConfirm={() => {
            onLeave();
            setLeaveOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}

export function GameScene({
  room,
  now,
  disabled,
  onSelectStarter,
  onCommand,
  onLeave,
  onReturnLobby,
  tutorialRequest,
}: {
  readonly room: RoomProjection;
  readonly now: number;
  readonly disabled: boolean;
  readonly onSelectStarter: (characterId: string) => void;
  readonly onCommand: (command: GameAction) => void;
  readonly onLeave: () => void;
  readonly onReturnLobby: () => void;
  readonly tutorialRequest: number;
}) {
  const [tutorialOpen, setTutorialOpen] = useState(() => !hasFinishedPveTutorial());
  useEffect(() => {
    if (tutorialRequest > 0) setTutorialOpen(true);
  }, [tutorialRequest]);
  const selfId = useMemo(
    () => room.members.find((member) => member.isSelf)?.identityId ?? '',
    [room.members],
  );
  if (!room.game || !selfId) return null;
  return (
    <>
      {room.game.phase === 'SELECTING_STARTER' ? (
        <StarterSelection
          room={room}
          selfId={selfId}
          disabled={disabled}
          onSelectStarter={onSelectStarter}
          onLeave={onLeave}
        />
      ) : (
        <TableScene
          room={room}
          selfId={selfId}
          now={now}
          disabled={disabled}
          onCommand={onCommand}
          onLeave={onLeave}
          onReturnLobby={onReturnLobby}
        />
      )}
      <TutorialGuide
        open={room.kind === 'pve' && tutorialOpen}
        mode={room.game.mode}
        phase={room.game.phase}
        onClose={() => setTutorialOpen(false)}
      />
    </>
  );
}
