import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

export function RulesDrawer({
  open,
  onClose,
  onOpenTutorial,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onOpenTutorial: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="rules-drawer" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <header>
          <div>
            <span>RULEBOOK</span>
            <h2 id="rules-title">FateDeck 规则</h2>
          </div>
          <button
            ref={closeRef}
            className="close-button"
            type="button"
            aria-label="关闭规则"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        <nav aria-label="规则章节">
          <a href="#rule-modes">模式</a>
          <a href="#rule-cards">出牌</a>
          <a href="#rule-suits">花色</a>
          <a href="#rule-joker">Joker</a>
        </nav>
        <section id="rule-modes">
          <h3>标准战与快速战</h3>
          <p>标准战使用 J、Q、K 三名角色；快速战使用一名随机角色。最后存活的玩家获胜。</p>
        </section>
        <section id="rule-cards">
          <h3>合法出牌</h3>
          <p>每次打出 1、3 或 5 张同花色牌。手牌上限为 7；A 可与一张 2–10 合成为不可逆的万化牌。</p>
        </section>
        <section id="rule-suits">
          <h3>四种花色</h3>
          <p>黑桃攻击、红桃吸血、方块摸牌、梅花获得护盾。万化牌所在组合无视花色免疫。</p>
        </section>
        <section id="rule-joker">
          <h3>Joker</h3>
          <p>单 Joker 可按顺序救援濒死角色；双 Joker 可直接处决当前角色，且不能被救援。</p>
        </section>
        <button
          className="game-button primary rules-tutorial-button"
          type="button"
          onClick={() => {
            onOpenTutorial();
            onClose();
          }}
        >
          重新打开 PVE 新手教学
        </button>
        <p className="rules-note">完整时序与边界以服务器规则为准。</p>
      </aside>
    </div>
  );
}
