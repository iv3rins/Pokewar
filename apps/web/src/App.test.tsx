import type { RoomProjection } from '@pokewar/protocol';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import type { RoomSocketHandlers } from './services/roomSocket.js';

const mocks = vi.hoisted(() => ({
  ensureGuestSession: vi.fn(),
  registerAccount: vi.fn(),
  loginAccount: vi.fn(),
  getProfile: vi.fn(),
  getLeaderboard: vi.fn(),
  create: vi.fn(() => Promise.resolve({ ok: true })),
  join: vi.fn(() => Promise.resolve({ ok: true })),
  leave: vi.fn(() => Promise.resolve({ ok: true })),
  ready: vi.fn(() => Promise.resolve({ ok: true })),
  mode: vi.fn(() => Promise.resolve({ ok: true })),
  kick: vi.fn(() => Promise.resolve({ ok: true })),
  start: vi.fn(() => Promise.resolve({ ok: true })),
  startPve: vi.fn(() => Promise.resolve({ ok: true })),
  leavePve: vi.fn(() =>
    Promise.resolve({ ok: true, leftRoom: true, dissolved: true, roomId: 'A2BCD' }),
  ),
  selectStarter: vi.fn(() => Promise.resolve({ ok: true })),
  gameCommand: vi.fn(() => Promise.resolve({ ok: true })),
  returnToLobby: vi.fn(() => Promise.resolve({ ok: true })),
  enqueue: vi.fn(() => Promise.resolve({ ok: true })),
  cancelMatchmaking: vi.fn(() => Promise.resolve({ ok: true })),
  acceptMatch: vi.fn(() => Promise.resolve({ ok: true })),
  declineMatch: vi.fn(() => Promise.resolve({ ok: true })),
  handlers: undefined as RoomSocketHandlers | undefined,
}));

vi.mock('./services/guest.js', () => ({ ensureGuestSession: mocks.ensureGuestSession }));
vi.mock('./services/auth.js', () => ({
  registerAccount: mocks.registerAccount,
  loginAccount: mocks.loginAccount,
}));
vi.mock('./services/profile.js', () => ({
  getProfile: mocks.getProfile,
  getLeaderboard: mocks.getLeaderboard,
}));
vi.mock('./services/roomSocket.js', () => ({
  createRoomSocket: (handlers: RoomSocketHandlers) => {
    mocks.handlers = handlers;
    handlers.onConnection('connected');
    handlers.onMatchmaking({ status: 'idle' });
    return {
      create: mocks.create,
      join: mocks.join,
      leave: mocks.leave,
      ready: mocks.ready,
      mode: mocks.mode,
      kick: mocks.kick,
      start: mocks.start,
      startPve: mocks.startPve,
      leavePve: mocks.leavePve,
      selectStarter: mocks.selectStarter,
      gameCommand: mocks.gameCommand,
      returnToLobby: mocks.returnToLobby,
      enqueue: mocks.enqueue,
      cancelMatchmaking: mocks.cancelMatchmaking,
      acceptMatch: mocks.acceptMatch,
      declineMatch: mocks.declineMatch,
      disconnect: vi.fn(),
    };
  },
}));

const hostRoom: RoomProjection = {
  id: 'A2BCD',
  version: 1,
  hostIdentityId: 'host',
  kind: 'private',
  mode: 'normal',
  members: [
    {
      identityId: 'host',
      displayName: '静默星轨#A001',
      ready: true,
      connected: true,
      isSelf: true,
    },
    {
      identityId: 'guest',
      displayName: '赤曜先锋#B002',
      ready: false,
      connected: true,
      isSelf: false,
    },
  ],
  game: null,
};

const pveRoom = (phase: 'SELECTING_STARTER' | 'PLAYING'): RoomProjection => ({
  ...hostRoom,
  kind: 'pve',
  mode: phase === 'SELECTING_STARTER' ? 'normal' : 'quick',
  members: [
    {
      identityId: 'host',
      displayName: '静默星轨#A001',
      ready: true,
      connected: true,
      isSelf: true,
    },
    {
      identityId: 'bot:A2BCD:0',
      displayName: '静默旅者[机器人]',
      ready: true,
      connected: true,
      isSelf: false,
    },
  ],
  game: {
    id: 'A2BCD',
    version: 3,
    mode: phase === 'SELECTING_STARTER' ? 'normal' : 'quick',
    phase,
    currentPlayerId: phase === 'PLAYING' ? 'host' : null,
    turnDeadline: phase === 'PLAYING' ? Date.now() + 30_000 : null,
    notices: [],
    pendingAction: null,
    players: [
      {
        id: 'host',
        displayName: '静默星轨#A001',
        seat: phase === 'PLAYING' ? 0 : null,
        connected: true,
        eliminated: false,
        handCount: phase === 'PLAYING' ? 1 : 0,
        hand:
          phase === 'PLAYING' ? [{ kind: 'physical', id: 'card-1', suit: 'spade', rank: 7 }] : [],
        activeCharacter:
          phase === 'PLAYING'
            ? { id: 'self-q', rank: 'Q', suit: 'spade', hp: 40, shield: 0, eliminated: false }
            : null,
        characters: [
          { id: 'self-j', rank: 'J', suit: 'heart', hp: 30, shield: 0, eliminated: false },
          { id: 'self-q', rank: 'Q', suit: 'spade', hp: 40, shield: 0, eliminated: false },
          { id: 'self-k', rank: 'K', suit: 'club', hp: 50, shield: 0, eliminated: false },
        ],
      },
      {
        id: 'bot:A2BCD:0',
        displayName: '静默旅者[机器人]',
        seat: phase === 'PLAYING' ? 1 : null,
        connected: true,
        eliminated: false,
        handCount: phase === 'PLAYING' ? 5 : 0,
        activeCharacter:
          phase === 'PLAYING'
            ? { id: 'bot-j', rank: 'J', suit: 'diamond', hp: 30, shield: 0, eliminated: false }
            : null,
      },
    ],
  },
});

const humanPlayingRoom = (kind: 'private' | 'matchmade'): RoomProjection => {
  const room = pveRoom('PLAYING');
  if (!room.game) throw new Error('GAME_REQUIRED');
  return {
    ...room,
    kind,
    members: room.members.map((member) =>
      member.identityId.startsWith('bot:')
        ? { ...member, identityId: 'guest', displayName: '赤曜先锋#B002' }
        : member,
    ),
    game: {
      ...room.game,
      currentPlayerId: 'guest',
      players: room.game.players.map((player) =>
        player.id.startsWith('bot:')
          ? { ...player, id: 'guest', displayName: '赤曜先锋#B002' }
          : player,
      ),
    },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mocks.handlers = undefined;
  mocks.ensureGuestSession.mockResolvedValue({
    identity: { id: 'host', displayName: '静默星轨#A001', kind: 'guest', avatarId: 'court-01' },
  });
  mocks.getProfile.mockResolvedValue({
    identity: { id: 'host', displayName: '静默星轨#A001', kind: 'guest', avatarId: 'court-01' },
    ratings: [],
  });
  mocks.getLeaderboard.mockResolvedValue({ mode: 'normal', entries: [], self: null });
});

describe('PokeWar home', () => {
  it('automatically establishes an immutable guest and renders the three home areas', async () => {
    render(<App />);
    expect(await screen.findByText('静默星轨#A001')).toBeInTheDocument();
    expect(mocks.ensureGuestSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('你的昵称')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'POKEWAR' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '标准战天梯' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '私人房间' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始匹配' })).not.toBeDisabled();
  });

  it('opens the account modal and accessible rules drawer', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('静默星轨#A001');
    await user.click(screen.getByRole('button', { name: '打开注册或登录' }));
    expect(screen.getByRole('dialog', { name: '注册与登录' })).toBeInTheDocument();
    expect(screen.getByLabelText('公开昵称前缀')).toHaveValue('静默');
    expect(screen.getByLabelText('公开昵称称号')).toHaveValue('旅者');
    await user.click(screen.getByRole('button', { name: '关闭账号窗口' }));
    await user.click(screen.getByRole('button', { name: '打开游戏规则' }));
    expect(screen.getByRole('dialog', { name: 'PokeWar 规则' })).toBeInTheDocument();
  });

  it('submits reviewed registration choices and switches to account state', async () => {
    mocks.registerAccount.mockResolvedValue({
      identity: { id: 'host', displayName: '赤曜先锋#A001', kind: 'account', avatarId: 'court-02' },
    });
    mocks.getProfile.mockResolvedValue({
      identity: { id: 'host', displayName: '赤曜先锋#A001', kind: 'account', avatarId: 'court-02' },
      ratings: [
        {
          mode: 'normal',
          rating: 1500,
          deviation: 350,
          rankedGames: 0,
          wins: 0,
          losses: 0,
          provisional: true,
          tier: 'gold',
          rank: null,
        },
        {
          mode: 'quick',
          rating: 1500,
          deviation: 350,
          rankedGames: 0,
          wins: 0,
          losses: 0,
          provisional: true,
          tier: 'gold',
          rank: null,
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('静默星轨#A001');
    await user.click(screen.getByRole('button', { name: '打开注册或登录' }));
    await user.type(screen.getByLabelText('登录用户名'), 'player_01');
    await user.type(screen.getByLabelText('密码'), 'secure123');
    await user.selectOptions(screen.getByLabelText('公开昵称前缀'), '赤曜');
    await user.selectOptions(screen.getByLabelText('公开昵称称号'), '先锋');
    await user.click(screen.getByRole('button', { name: '升级为注册账号' }));
    expect(mocks.registerAccount).toHaveBeenCalledWith({
      loginName: 'player_01',
      password: 'secure123',
      prefix: '赤曜',
      noun: '先锋',
    });
    expect(await screen.findByText('赤曜先锋#A001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开注册或登录' })).not.toBeInTheDocument();
  });

  it('normalizes room codes and joins through the realtime client', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText('加入房间');
    await user.type(input, 'a2b0cd');
    expect(input).toHaveValue('A2BCD');
    await user.click(screen.getByRole('button', { name: '加入房间' }));
    expect(mocks.join).toHaveBeenCalledWith('A2BCD');
  });

  it('renders authoritative room snapshots and host controls', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom(hostRoom);
    expect(await screen.findByRole('heading', { name: 'A2BCD' })).toBeInTheDocument();
    expect(screen.getByText('赤曜先锋#B002')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始对局' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '移出 赤曜先锋#B002' })).toBeInTheDocument();
  });

  it('switches a normal PVE room into starter selection and submits the selected character', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom(pveRoom('SELECTING_STARTER'));
    expect(
      await screen.findByRole('heading', { level: 1, name: '选择首发角色' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /K/ }));
    await user.click(screen.getByRole('button', { name: '确认角色' }));
    expect(mocks.selectStarter).toHaveBeenCalledWith('A2BCD', 3, 'self-k');
  });

  it('opens first-time PVE tutorial without blocking the projected table', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom(pveRoom('PLAYING'));
    expect(await screen.findByRole('complementary', { name: 'PVE 新手教学' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '认识你的手牌' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 ♠' })).not.toBeDisabled();
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    expect(screen.getByRole('heading', { name: '组成合法牌组' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '跳过教学' }));
    expect(localStorage.getItem('pokewar:pve-tutorial:v1')).toBe('skipped');
  });

  it('temporarily closes the tutorial for the current browser session', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom(pveRoom('PLAYING'));
    await user.click(await screen.findByRole('button', { name: '暂时关闭教学' }));
    expect(sessionStorage.getItem('pokewar:pve-tutorial-dismissed')).toBe('closed');
    expect(localStorage.getItem('pokewar:pve-tutorial:v1')).toBeNull();
  });

  it('persists permanent completion after the final tutorial step', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom(pveRoom('PLAYING'));
    const guide = await screen.findByRole('complementary', { name: 'PVE 新手教学' });
    for (let step = 0; step < 4; step += 1) {
      await user.click(within(guide).getByRole('button', { name: /下一步/ }));
    }
    await user.click(within(guide).getByRole('button', { name: '完成' }));
    expect(localStorage.getItem('pokewar:pve-tutorial:v1')).toBe('completed');
    expect(screen.queryByRole('complementary', { name: 'PVE 新手教学' })).not.toBeInTheDocument();
  });

  it('switches a quick PVE room into the projected table scene', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom(pveRoom('PLAYING'));
    expect(await screen.findByRole('heading', { name: 'PVE 牌桌' })).toBeInTheDocument();
    expect(screen.getByText('静默旅者[机器人]')).toBeInTheDocument();
    expect(screen.getByLabelText('你的手牌，共 1 张')).toBeInTheDocument();
    expect(screen.getAllByText('HP').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('盾').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: '确认出牌' })).toBeInTheDocument();
    expect(screen.queryByText('对局已开始')).not.toBeInTheDocument();
  });

  it('opens a structured battle history drawer from the table header', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    const playing = pveRoom('PLAYING');
    if (!playing.game) throw new Error('GAME_REQUIRED');
    mocks.handlers?.onRoom({
      ...playing,
      game: {
        ...playing.game,
        notices: [
          {
            id: '3:cards:played:0',
            kind: 'play',
            actorPlayerId: 'host',
            targetPlayerId: 'bot:A2BCD:0',
            value: 7,
            cards: [{ kind: 'physical', suit: 'spade', value: 7, fused: false }],
          },
        ],
      },
    });
    expect(await screen.findByRole('region', { name: '最近一次战斗' })).toBeInTheDocument();
    expect(screen.getByText('攻击者')).toBeInTheDocument();
    expect(screen.getByText('受击者')).toBeInTheDocument();
    expect(screen.getByText('打出的牌')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '打开战斗历史' }));
    expect(screen.getByRole('dialog', { name: '战斗历史' })).toBeInTheDocument();
    expect(
      screen.getAllByText('静默星轨#A001 打出 7♠，攻击 静默旅者[机器人]；总点数 7'),
    ).toHaveLength(2);
  });

  it('selects a card and target before submitting an authoritative play command', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom(pveRoom('PLAYING'));
    await user.click(await screen.findByRole('button', { name: '7 ♠' }));
    await user.click(screen.getByRole('button', { name: /静默旅者\[机器人\]/ }));
    await user.click(screen.getByRole('button', { name: '确认出牌' }));
    expect(mocks.gameCommand).toHaveBeenCalledWith({
      kind: 'game:play-cards',
      cardIds: ['card-1'],
      targetPlayerId: 'bot:A2BCD:0',
      roomId: 'A2BCD',
      expectedVersion: 3,
    });
  });

  it('renders and leaves a live human table through the authoritative leave command', async () => {
    const user = userEvent.setup();
    localStorage.setItem('pokewar:pve-tutorial:v1', 'completed');
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom(humanPlayingRoom('private'));
    expect(await screen.findByRole('heading', { name: '私人牌桌' })).toBeInTheDocument();
    expect(screen.getByLabelText('其他玩家')).toBeInTheDocument();
    expect(screen.getByText('等待其他玩家行动')).toBeInTheDocument();
    expect(screen.queryByText('PVE 牌桌')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'PVE 新手教学' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '退出对局' }));
    await user.click(screen.getByRole('button', { name: '确认退出' }));
    expect(mocks.gameCommand).toHaveBeenCalledWith({
      kind: 'game:leave-match',
      roomId: 'A2BCD',
      expectedVersion: 3,
    });
    expect(mocks.leavePve).not.toHaveBeenCalled();
    expect(await screen.findByText('已退出对局并按失败结算。')).toBeInTheDocument();
  });

  it('renders a matchmade game without PVE labels', async () => {
    localStorage.setItem('pokewar:pve-tutorial:v1', 'completed');
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom(humanPlayingRoom('matchmade'));
    expect(await screen.findByRole('heading', { name: '公开匹配牌桌' })).toBeInTheDocument();
    expect(screen.getByLabelText('其他玩家')).toBeInTheDocument();
  });

  it('leaves a PVE table immediately after a successful dedicated leave acknowledgement', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom(pveRoom('PLAYING'));
    await user.click(await screen.findByRole('button', { name: '退出对局' }));
    await user.click(screen.getByRole('button', { name: '确认退出' }));
    expect(mocks.leavePve).toHaveBeenCalledWith('A2BCD');
    expect(await screen.findByRole('heading', { name: '私人房间' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'PVE 牌桌' })).not.toBeInTheDocument();
    expect(screen.getByText('已退出人机对局。')).toBeInTheDocument();

    mocks.handlers?.onRoom(pveRoom('PLAYING'));
    expect(screen.queryByRole('heading', { name: 'PVE 牌桌' })).not.toBeInTheDocument();
  });

  it('reopens the PVE tutorial from the rules drawer during a table', async () => {
    const user = userEvent.setup();
    localStorage.setItem('pokewar:pve-tutorial:v1', 'completed');
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom(pveRoom('PLAYING'));
    expect(screen.queryByRole('complementary', { name: 'PVE 新手教学' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '打开游戏规则' }));
    await user.click(screen.getByRole('button', { name: '重新打开 PVE 新手教学' }));
    expect(await screen.findByRole('complementary', { name: 'PVE 新手教学' })).toBeInTheDocument();
  });

  it('shows accessible success feedback after copying a private room code', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom(hostRoom);
    await user.click(await screen.findByRole('button', { name: '复制房间码' }));
    expect(writeText).toHaveBeenCalledWith('A2BCD');
    expect(await screen.findByText('房间码已复制')).toBeInTheDocument();
  });

  it('lets a non-host player toggle readiness', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '私人房间' });
    mocks.handlers?.onRoom({
      ...hostRoom,
      members: hostRoom.members.map((member) => ({
        ...member,
        isSelf: member.identityId === 'guest',
      })),
    });
    const toggle = await screen.findByRole('checkbox', { name: /准备对局/ });
    await user.click(toggle);
    expect(mocks.ready).toHaveBeenCalledWith('A2BCD', true);
  });
});
