import type { GameMode, RoomProjection } from '@pokewar/protocol';
import {
  Bot,
  Check,
  Copy,
  LogIn,
  LogOut,
  Play,
  Plus,
  ShieldCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ModeSelector } from '../lobby/ModeSelector.js';

export function RoomRail({
  room,
  mode,
  roomCode,
  disabled,
  onMode,
  onRoomCode,
  onCreate,
  onJoin,
  onLeave,
  onReady,
  onKick,
  onStart,
  onStartPve,
}: {
  readonly room: RoomProjection | null;
  readonly mode: GameMode;
  readonly roomCode: string;
  readonly disabled: boolean;
  readonly onMode: (mode: GameMode) => void;
  readonly onRoomCode: (value: string) => void;
  readonly onCreate: () => void;
  readonly onJoin: () => void;
  readonly onLeave: () => void;
  readonly onReady: (ready: boolean) => void;
  readonly onKick: (identityId: string) => void;
  readonly onStart: () => void;
  readonly onStartPve: (mode: GameMode, targetSize: 4 | 8 | 12) => void;
}) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [pveSize, setPveSize] = useState<4 | 8 | 12>(4);
  useEffect(() => {
    setConfirmLeave(false);
    setCopyState('idle');
  }, [room?.id]);
  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = setTimeout(() => setCopyState('idle'), 2_000);
    return () => clearTimeout(timer);
  }, [copyState]);
  useEffect(() => {
    if (!confirmLeave) return;
    const timer = setTimeout(() => setConfirmLeave(false), 5_000);
    return () => clearTimeout(timer);
  }, [confirmLeave]);

  if (!room) {
    return (
      <aside className="room-rail" aria-label="房间与人机">
        <section className="room-tool pve-tool">
          <header>
            <Bot size={21} />
            <div>
              <span>PVE MODE</span>
              <h2>人机对战</h2>
            </div>
          </header>
          <p className="pve-description">与新手 AI 立即开始对局，不计入天梯排位。</p>
          <ModeSelector value={mode} onChange={onMode} disabled={disabled} />
          <div className="pve-size-selector" aria-label="对局规模">
            {([4, 8, 12] as const).map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={pveSize === size}
                disabled={disabled}
                onClick={() => setPveSize(size)}
              >
                <strong>{size}</strong>
                <span>人</span>
              </button>
            ))}
          </div>
          <button
            className="primary-button wide pve-start-button"
            type="button"
            disabled={disabled}
            onClick={() => onStartPve(mode, pveSize)}
          >
            <Bot size={19} />
            开始人机对战
          </button>
        </section>
        <header className="private-room-header">
          <Users size={21} />
          <div>
            <span>PRIVATE TABLE</span>
            <h2>私人房间</h2>
          </div>
        </header>
        <section className="room-tool">
          <h3>创建房间</h3>
          <ModeSelector value={mode} onChange={onMode} disabled={disabled} />
          <button
            className="primary-button wide"
            type="button"
            disabled={disabled}
            onClick={onCreate}
          >
            <Plus size={19} />
            创建房间
          </button>
        </section>
        <section className="room-tool join-tool">
          <label htmlFor="room-code">加入房间</label>
          <input
            id="room-code"
            className="room-code-input"
            value={roomCode}
            maxLength={5}
            autoCapitalize="characters"
            placeholder="A2BCD"
            onChange={(event) => onRoomCode(event.target.value)}
          />
          <button
            className="secondary-button wide"
            type="button"
            disabled={disabled || roomCode.length !== 5}
            onClick={onJoin}
          >
            <LogIn size={19} />
            加入房间
          </button>
        </section>
      </aside>
    );
  }

  const copyRoomCode = async () => {
    try {
      const clipboard = Reflect.get(navigator, 'clipboard') as
        { writeText(value: string): Promise<void> } | undefined;
      if (clipboard) await clipboard.writeText(room.id);
      else {
        const input = document.createElement('textarea');
        input.value = room.id;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.append(input);
        input.select();
        const legacyCopy = Reflect.get(document, 'execCommand') as
          ((command: string) => boolean) | undefined;
        const copied = legacyCopy?.call(document, 'copy') ?? false;
        input.remove();
        if (!copied) throw new Error('COPY_FAILED');
      }
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const self = room.members.find((member) => member.isSelf);
  const isHost = self?.identityId === room.hostIdentityId;
  const canStart = room.members.length >= 2 && room.members.every((member) => member.ready);
  return (
    <aside className="room-rail active-room" aria-label="当前私人房间">
      <header className="active-room-header">
        <div>
          <span>ROOM</span>
          <h2>{room.id}</h2>
        </div>
        <button
          className="copy-icon"
          type="button"
          aria-label={copyState === 'copied' ? '房间码已复制' : '复制房间码'}
          title={copyState === 'copied' ? '已复制' : '复制房间码'}
          onClick={() => void copyRoomCode()}
        >
          {copyState === 'copied' ? <Check size={18} /> : <Copy size={18} />}
        </button>
      </header>
      <span
        className={`copy-feedback copy-${copyState}`}
        role={copyState === 'failed' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {copyState === 'copied'
          ? '房间码已复制'
          : copyState === 'failed'
            ? `复制失败，请手动复制 ${room.id}`
            : ''}
      </span>
      {room.game ? (
        <section className="game-started">
          <strong>对局已开始</strong>
          <span>
            {room.game.mode === 'normal' ? '标准战' : '快速战'} · {room.game.phase}
          </span>
        </section>
      ) : (
        <>
          <section className="compact-members">
            <div className="rail-section-title">
              <h3>玩家</h3>
              <span>{room.members.length} / 12</span>
            </div>
            <ol>
              {room.members.map((member, index) => (
                <li key={member.identityId}>
                  <span className="seat-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="mini-avatar" aria-hidden="true">
                    {member.displayName.slice(0, 1)}
                  </span>
                  <span className="compact-name">
                    <strong>
                      {member.displayName}
                      {member.isSelf ? '（你）' : ''}
                    </strong>
                    <small>
                      {member.identityId === room.hostIdentityId
                        ? '房主'
                        : member.ready
                          ? '已准备'
                          : '未准备'}
                    </small>
                  </span>
                  <i className={member.connected ? 'online' : 'offline'} />
                  {isHost && !member.isSelf ? (
                    <button
                      className="kick-button"
                      type="button"
                      disabled={disabled}
                      aria-label={`移出 ${member.displayName}`}
                      onClick={() => onKick(member.identityId)}
                    >
                      <UserMinus size={17} />
                    </button>
                  ) : (
                    <span className="member-spacer" />
                  )}
                </li>
              ))}
            </ol>
          </section>
          <section className="compact-controls">
            <ModeSelector value={room.mode} onChange={onMode} disabled={disabled || !isHost} />
            {isHost ? (
              <div className="host-ready">
                <ShieldCheck size={19} />
                <span>
                  <strong>房主已准备</strong>
                  <small>等待所有玩家确认</small>
                </span>
              </div>
            ) : (
              <label className="ready-toggle">
                <input
                  type="checkbox"
                  checked={self?.ready ?? false}
                  disabled={disabled}
                  onChange={(event) => onReady(event.target.checked)}
                />
                <span>
                  <strong>{self?.ready ? '已准备' : '准备对局'}</strong>
                  <small>勾选后等待房主开局</small>
                </span>
              </label>
            )}
            <button
              className="leave-room-button wide"
              type="button"
              disabled={disabled}
              onClick={() => {
                if (confirmLeave) onLeave();
                else setConfirmLeave(true);
              }}
            >
              <LogOut size={17} />
              {confirmLeave ? '再次点击确认离开' : '离开私人房间'}
            </button>
            {isHost ? (
              <button
                className="primary-button wide"
                type="button"
                disabled={disabled || !canStart}
                onClick={onStart}
              >
                <Play size={19} />
                开始对局
              </button>
            ) : null}
          </section>
        </>
      )}
    </aside>
  );
}
