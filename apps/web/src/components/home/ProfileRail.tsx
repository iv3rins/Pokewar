import type { GameMode, LeaderboardEntry, RatingView } from '@pokewar/protocol';
import { BookOpen, LogIn, Trophy, UserRound } from 'lucide-react';

const TIER_LABEL = {
  bronze: '青铜',
  silver: '白银',
  gold: '黄金',
  platinum: '铂金',
  diamond: '钻石',
  champion: '王者',
} as const;

export function ProfileRail({
  displayName,
  account,
  mode,
  ratings,
  leaderboard,
  selfRank,
  onAuth,
  onRules,
}: {
  readonly displayName: string;
  readonly account: boolean;
  readonly mode: GameMode;
  readonly ratings: readonly RatingView[];
  readonly leaderboard: readonly LeaderboardEntry[];
  readonly selfRank: LeaderboardEntry | null;
  readonly onAuth: () => void;
  readonly onRules: () => void;
}) {
  const selected = ratings.find((rating) => rating.mode === mode);
  return (
    <aside className="profile-rail" aria-label="个人与天梯">
      <section className="profile-summary">
        <span className="profile-avatar" aria-hidden="true">
          <UserRound size={28} />
        </span>
        <div>
          <span>{account ? '注册玩家' : '系统访客'}</span>
          <strong>{displayName}</strong>
        </div>
      </section>
      {!account ? (
        <button className="rail-command" type="button" onClick={onAuth}>
          <LogIn size={19} />
          <span>
            <strong>注册 / 登录</strong>
            <small>注册后参与天梯排名</small>
          </span>
        </button>
      ) : null}
      <section className="rating-summary" aria-labelledby="rating-title">
        <header>
          <Trophy size={18} />
          <h2 id="rating-title">{mode === 'normal' ? '标准战天梯' : '快速战天梯'}</h2>
        </header>
        {!account ? (
          <>
            <div className="rating-primary">
              <strong>访客不计分</strong>
              <span>含访客的匹配均为非排位</span>
            </div>
          </>
        ) : selected ? (
          <>
            <div className="rating-primary">
              <strong>
                {selected.provisional
                  ? `定级中 ${String(selected.rankedGames)} / 5`
                  : `${TIER_LABEL[selected.tier]} · ${String(Math.round(selected.rating))}`}
              </strong>
              <span>
                {selected.wins} 胜 · {selected.losses} 负
                {selected.rank ? ` · 第 ${String(selected.rank)} 名` : ''}
              </span>
            </div>
            {selfRank && !selected.rank ? <p>我的排名：第 {String(selfRank.rank)} 名</p> : null}
          </>
        ) : (
          <p>正在载入评级…</p>
        )}
        <div className="leaderboard-title">
          <span>TOP 10</span>
          <small>{mode === 'normal' ? '标准战' : '快速战'}</small>
        </div>
        <ol className="leaderboard-list">
          {leaderboard.length === 0 ? (
            <li className="empty-rank">暂无完成定级的玩家</li>
          ) : (
            leaderboard.map((entry) => (
              <li key={`${String(entry.rank)}-${entry.displayName}`}>
                <b>{entry.rank}</b>
                <span>{entry.displayName}</span>
                <strong>{Math.round(entry.rating)}</strong>
              </li>
            ))
          )}
        </ol>
      </section>
      <button className="rail-command rules-command" type="button" onClick={onRules}>
        <BookOpen size={19} />
        <span>
          <strong>游戏规则</strong>
          <small>模式、出牌与 Joker</small>
        </span>
      </button>
    </aside>
  );
}
