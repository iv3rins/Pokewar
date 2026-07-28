import type {
  ChatMessage,
  GameMode,
  LeaderboardEntry,
  MatchSize,
  MatchmakingState,
  RatingView,
  RoomProjection,
} from '@pokewar/protocol';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthModal } from './components/home/AuthModal.js';
import { GameScene } from './components/game/GameScene.js';
import { CenterStage } from './components/home/CenterStage.js';
import { ConfirmationOverlay } from './components/home/ConfirmationOverlay.js';
import { ProfileRail } from './components/home/ProfileRail.js';
import { RoomRail } from './components/home/RoomRail.js';
import { RulesDrawer } from './components/home/RulesDrawer.js';
import { BrandHeader } from './components/lobby/BrandHeader.js';
import { loginAccount, registerAccount } from './services/auth.js';
import { errorMessage } from './services/errors.js';
import { ensureGuestSession } from './services/guest.js';
import { getLeaderboard, getProfile } from './services/profile.js';
import {
  createRoomSocket,
  type ConnectionState,
  type GameAction,
  type RoomSocketClient,
} from './services/roomSocket.js';

interface IdentityState {
  readonly id: string;
  readonly displayName: string;
  readonly kind: 'guest' | 'account';
  readonly avatarId?: string;
}

function normalizeRoomCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, '')
    .slice(0, 5);
}

export function App() {
  const [identity, setIdentity] = useState<IdentityState | null>(null);
  const [identityFailed, setIdentityFailed] = useState(false);
  const [mode, setMode] = useState<GameMode>('normal');
  const [targetSize, setTargetSize] = useState<MatchSize>(4);
  const [allowFallback, setAllowFallback] = useState(false);
  const [matchmaking, setMatchmaking] = useState<MatchmakingState>({ status: 'idle' });
  const [now, setNow] = useState(Date.now());
  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState<RoomProjection | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [message, setMessage] = useState('正在生成访客身份…');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<readonly ChatMessage[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [tutorialRequest, setTutorialRequest] = useState(0);
  const [authOpen, setAuthOpen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<readonly RatingView[]>([]);
  const [leaderboard, setLeaderboard] = useState<readonly LeaderboardEntry[]>([]);
  const [selfRank, setSelfRank] = useState<LeaderboardEntry | null>(null);
  const socketRef = useRef<RoomSocketClient | null>(null);
  const roomRef = useRef<RoomProjection | null>(null);
  const ignoredRoomIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (targetSize === 4) setAllowFallback(false);
  }, [targetSize]);

  const loadIdentity = useCallback(async () => {
    setIdentityFailed(false);
    setError(null);
    setMessage('正在生成访客身份…');
    try {
      const session = await ensureGuestSession();
      setIdentity({ ...session.identity, avatarId: session.identity.avatarId ?? 'court-01' });
      setMessage(`欢迎，${session.identity.displayName}`);
    } catch (reason) {
      setIdentityFailed(true);
      setConnection('disconnected');
      setError(errorMessage(reason instanceof Error ? reason.message : 'SESSION_FAILED'));
    }
  }, []);

  useEffect(() => {
    void loadIdentity();
  }, [loadIdentity]);

  useEffect(() => {
    if (!identity) return;
    let active = true;
    void Promise.all([getProfile(), getLeaderboard(mode)]).then(
      ([profile, board]) => {
        if (!active) return;
        setRatings(profile.ratings);
        setLeaderboard(board.entries);
        setSelfRank(board.self);
      },
      () => {
        if (active) setError('天梯信息暂时无法载入。');
      },
    );
    return () => {
      active = false;
    };
  }, [identity, mode]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    if (!identity) return;
    const socket = createRoomSocket({
      onConnection: (state) => {
        setConnection(state);
        if (state === 'disconnected' && roomRef.current?.kind === 'pve') {
          setRoom(null);
          setMessage('连接中断，人机对局已结束。');
        }
      },
      onRoom: (nextRoom) => {
        if (ignoredRoomIdsRef.current.has(nextRoom.id)) {
          return;
        }
        setRoom(nextRoom);
        setMode(nextRoom.mode);
        setError(null);
        setMessage(nextRoom.game ? '对局已由服务器启动' : `已进入房间 ${nextRoom.id}`);
      },
      onError: (code) => setError(errorMessage(code)),
      onKicked: () => {
        setRoom(null);
        setError('你已被房主移出房间，30 秒后可重新加入。');
      },
      onLeft: () => {
        setRoom(null);
        setMessage('对局或房间已结束，已返回大厅。');
      },
      onChat(message) {
        setChatMessages((messages) => [...messages, message].slice(-50));
      },
      onMatchmaking(state) {
        setMatchmaking(state);
        document.title = state.status === 'confirming' ? '【匹配成功】FateDeck' : 'FateDeck';
      },
    });
    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [identity]);

  const withSocket = (
    operation: (socket: RoomSocketClient) => Promise<{ readonly ok: boolean }>,
  ): Promise<{ readonly ok: boolean }> => {
    const socket = socketRef.current;
    if (!socket) {
      setError('实时连接尚未就绪。');
      return Promise.resolve({ ok: false });
    }
    return operation(socket);
  };

  const withCurrentRoom = (
    operation: (
      socket: RoomSocketClient,
      room: RoomProjection,
    ) => Promise<{ readonly ok: boolean }>,
  ): Promise<{ readonly ok: boolean }> => {
    const currentRoom = room;
    return currentRoom
      ? withSocket((socket) => operation(socket, currentRoom))
      : Promise.resolve({ ok: false });
  };

  const perform = async (operation: () => Promise<{ readonly ok: boolean }>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } finally {
      setBusy(false);
    }
  };

  const authenticate = async (operation: () => Promise<{ readonly identity: IdentityState }>) => {
    setBusy(true);
    setAuthError(null);
    try {
      const session = await operation();
      setIdentity({ ...session.identity, avatarId: session.identity.avatarId ?? 'court-01' });
      setAuthOpen(false);
      setMessage(`账号已登录：${session.identity.displayName}`);
    } catch (reason) {
      setAuthError(errorMessage(reason instanceof Error ? reason.message : 'AUTH_FAILED'));
    } finally {
      setBusy(false);
    }
  };

  const leaveActiveGame = async () => {
    const currentRoom = roomRef.current;
    const socket = socketRef.current;
    if (!currentRoom?.game || !socket) {
      setError('当前对局无法退出，请刷新页面。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result =
        currentRoom.kind === 'pve'
          ? await socket.leavePve(currentRoom.id)
          : await socket.gameCommand({
              kind: 'game:leave-match',
              roomId: currentRoom.id,
              expectedVersion: currentRoom.game.version,
            });
      if (!result.ok || (currentRoom.kind === 'pve' && !result.leftRoom)) {
        setError(errorMessage(result.code ?? 'MATCH_LEAVE_FAILED'));
        return;
      }
      ignoredRoomIdsRef.current.add(currentRoom.id);
      roomRef.current = null;
      setRoom(null);
      setMessage(currentRoom.kind === 'pve' ? '已退出人机对局。' : '已退出对局并按失败结算。');
    } finally {
      setBusy(false);
    }
  };

  const controlsDisabled = busy || connection !== 'connected';

  const activeGame = identity && room?.game ? room : null;

  return (
    <main className={activeGame ? 'home-shell game-active' : 'home-shell'}>
      <BrandHeader
        connection={connection}
        account={identity?.kind === 'account'}
        onAuth={() => setAuthOpen(true)}
        onRules={() => setRulesOpen(true)}
      />
      {activeGame ? (
        <GameScene
          room={activeGame}
          now={now}
          disabled={controlsDisabled}
          onSelectStarter={(characterId) =>
            void perform(() =>
              withCurrentRoom((socket, currentRoom) => {
                if (!currentRoom.game) return Promise.resolve({ ok: false });
                return socket.selectStarter(currentRoom.id, currentRoom.game.version, characterId);
              }),
            )
          }
          onCommand={(command: GameAction) =>
            void perform(() =>
              withCurrentRoom((socket, currentRoom) => {
                if (!currentRoom.game) return Promise.resolve({ ok: false });
                return socket.gameCommand({
                  ...command,
                  roomId: currentRoom.id,
                  expectedVersion: currentRoom.game.version,
                });
              }),
            )
          }
          onLeave={() => void leaveActiveGame()}
          onReturnLobby={() =>
            void perform(() =>
              withCurrentRoom((socket, currentRoom) => socket.returnToLobby(currentRoom.id)),
            )
          }
          chatMessages={chatMessages}
          onSendChat={async (text) => {
            const currentRoom = roomRef.current;
            const socket = socketRef.current;
            if (!currentRoom || !socket) return false;
            return (await socket.sendChat(currentRoom.id, text)).ok;
          }}
          tutorialRequest={tutorialRequest}
        />
      ) : (
        <section className="home-stage">
          <div className="home-table-lines" aria-hidden="true" />
          {identity ? (
            <div className="home-layout">
              <ProfileRail
                displayName={identity.displayName}
                avatarId={identity.avatarId ?? 'court-01'}
                account={identity.kind === 'account'}
                mode={mode}
                ratings={ratings}
                leaderboard={leaderboard}
                selfRank={selfRank}
                onAuth={() => setAuthOpen(true)}
                onRules={() => setRulesOpen(true)}
              />
              <CenterStage
                mode={mode}
                targetSize={targetSize}
                allowFallback={allowFallback}
                matchmaking={matchmaking}
                now={now}
                disabled={controlsDisabled}
                onMode={setMode}
                onSize={setTargetSize}
                onFallback={setAllowFallback}
                onEnqueue={() =>
                  void perform(() => {
                    const socket = socketRef.current;
                    return socket
                      ? socket.enqueue(mode, targetSize, allowFallback)
                      : Promise.reject(new Error('NO_SOCKET'));
                  })
                }
                onCancel={() =>
                  void perform(() => {
                    const socket = socketRef.current;
                    return socket
                      ? socket.cancelMatchmaking()
                      : Promise.reject(new Error('NO_SOCKET'));
                  })
                }
              />
              <RoomRail
                room={room}
                mode={mode}
                roomCode={roomCode}
                disabled={controlsDisabled}
                onMode={(nextMode) => {
                  if (!room) {
                    setMode(nextMode);
                    return;
                  }
                  void perform(() => withSocket((socket) => socket.mode(room.id, nextMode)));
                }}
                onRoomCode={(value) => setRoomCode(normalizeRoomCode(value))}
                onCreate={() =>
                  void perform(() => {
                    ignoredRoomIdsRef.current.clear();
                    return withSocket((socket) => socket.create(mode));
                  })
                }
                onJoin={() =>
                  void perform(() => {
                    ignoredRoomIdsRef.current.clear();
                    return withSocket((socket) => socket.join(roomCode));
                  })
                }
                onLeave={() =>
                  void perform(() =>
                    withCurrentRoom((socket, currentRoom) => socket.leave(currentRoom.id)),
                  )
                }
                onReady={(ready) =>
                  void perform(() =>
                    withCurrentRoom((socket, currentRoom) => socket.ready(currentRoom.id, ready)),
                  )
                }
                onKick={(targetId) =>
                  void perform(() =>
                    withCurrentRoom((socket, currentRoom) => socket.kick(currentRoom.id, targetId)),
                  )
                }
                onStart={() =>
                  void perform(() =>
                    withCurrentRoom((socket, currentRoom) => socket.start(currentRoom.id)),
                  )
                }
                onStartPve={(pveMode, targetSize) =>
                  void perform(() => {
                    ignoredRoomIdsRef.current.clear();
                    const socket = socketRef.current;
                    return socket
                      ? socket.startPve(pveMode, targetSize)
                      : Promise.reject(new Error('NO_SOCKET'));
                  })
                }
              />
            </div>
          ) : (
            <section className="identity-loading" aria-live="polite">
              <span className="brand-mark" aria-hidden="true">
                FD
              </span>
              <h1>{identityFailed ? '访客身份创建失败' : '正在准备牌桌'}</h1>
              <p>{error ?? message}</p>
              {identityFailed ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void loadIdentity()}
                >
                  <RefreshCw size={19} />
                  重试
                </button>
              ) : (
                <i aria-hidden="true" />
              )}
            </section>
          )}
          {matchmaking.status === 'confirming' ? (
            <ConfirmationOverlay
              state={matchmaking}
              now={now}
              onAccept={() =>
                void perform(() => {
                  const socket = socketRef.current;
                  return socket
                    ? socket.acceptMatch(matchmaking.proposalId)
                    : Promise.reject(new Error('NO_SOCKET'));
                })
              }
              onDecline={() =>
                void perform(() => {
                  const socket = socketRef.current;
                  return socket ? socket.declineMatch() : Promise.reject(new Error('NO_SOCKET'));
                })
              }
            />
          ) : null}
          {identity ? (
            <div className="home-feedback" role={error ? 'alert' : 'status'} aria-live="polite">
              {error ?? message}
            </div>
          ) : null}
        </section>
      )}
      <footer className="home-footer">
        <span>
          {identity
            ? `${identity.kind === 'guest' ? '访客' : '账号'}：${identity.displayName}`
            : '正在建立身份'}
        </span>
        <span>2–12 人私人房 · 2 人公开匹配 · 断线恢复 30 秒</span>
      </footer>
      <RulesDrawer
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        onOpenTutorial={() => setTutorialRequest((request) => request + 1)}
      />
      <AuthModal
        open={authOpen}
        busy={busy}
        error={authError}
        onClose={() => {
          setAuthOpen(false);
          setAuthError(null);
        }}
        onRegister={(input) => void authenticate(() => registerAccount(input))}
        onLogin={(input) => void authenticate(() => loginAccount(input))}
      />
    </main>
  );
}
