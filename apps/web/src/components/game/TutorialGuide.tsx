import type { GameMode } from '@pokewar/protocol';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export const PVE_TUTORIAL_STORAGE_KEY = 'pokewar:pve-tutorial:v1';
export const PVE_TUTORIAL_SESSION_KEY = 'pokewar:pve-tutorial-dismissed';

type TutorialPhase =
  'SELECTING_STARTER' | 'PLAYING' | 'WAITING_FOR_JOKER' | 'SELECTING_REPLACEMENT' | 'GAME_OVER';

interface TutorialStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly selector: string;
}

const STARTER_STEP: TutorialStep = {
  id: 'starter',
  title: '选择首发角色',
  description: '标准战拥有 J、Q、K 三名角色。比较花色与生命值，点击一张角色牌，再确认首发。',
  selector: '[data-tutorial="starter"]',
};

const TABLE_STEPS: readonly TutorialStep[] = [
  {
    id: 'hand',
    title: '认识你的手牌',
    description: '底部中央是你的固定手牌托盘。点击牌即可选择；再次点击可以取消。',
    selector: '[data-tutorial="hand"]',
  },
  {
    id: 'combination',
    title: '组成合法牌组',
    description: '普通出牌只能选择 1、3 或 5 张同花色牌。状态带会实时说明组合是否合法。',
    selector: '[data-tutorial="combination"]',
  },
  {
    id: 'target',
    title: '选择攻击目标',
    description: '黑桃、红桃和方块需要目标。先选牌，再点击顶部对手 HUD；金色边框表示当前目标。',
    selector: '[data-tutorial="targets"]',
  },
  {
    id: 'suits',
    title: '理解四种花色',
    description: '黑桃强化伤害，红桃按实际伤害治疗，方块触发全场摸牌，梅花不攻击而是获得护盾。',
    selector: '[data-tutorial="battle"]',
  },
  {
    id: 'joker',
    title: 'Joker 救援与处决',
    description:
      '濒死时可按顺序使用单 Joker 救援；在自己的回合选择两张 Joker，可直接处决目标角色。',
    selector: '[data-tutorial="actions"]',
  },
];

export function hasFinishedPveTutorial(): boolean {
  return (
    localStorage.getItem(PVE_TUTORIAL_STORAGE_KEY) !== null ||
    sessionStorage.getItem(PVE_TUTORIAL_SESSION_KEY) !== null
  );
}

export function resetPveTutorial(): void {
  localStorage.removeItem(PVE_TUTORIAL_STORAGE_KEY);
  sessionStorage.removeItem(PVE_TUTORIAL_SESSION_KEY);
}

export function TutorialGuide({
  open,
  mode,
  phase,
  onClose,
}: {
  readonly open: boolean;
  readonly mode: GameMode;
  readonly phase: TutorialPhase;
  readonly onClose: () => void;
}) {
  const steps = useMemo(
    () => (mode === 'normal' ? [STARTER_STEP, ...TABLE_STEPS] : [...TABLE_STEPS]),
    [mode],
  );
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    if (phase !== 'SELECTING_STARTER' && steps[index]?.id === 'starter') setIndex(1);
  }, [index, open, phase, steps]);

  const step = steps[index];
  useEffect(() => {
    if (!open || !step) return;
    const target = document.querySelector<HTMLElement>(step.selector);
    target?.classList.add('tutorial-highlight');
    return () => target?.classList.remove('tutorial-highlight');
  }, [open, step]);

  if (!open || !step) return null;
  const finish = (status: 'completed' | 'skipped') => {
    localStorage.setItem(PVE_TUTORIAL_STORAGE_KEY, status);
    onClose();
  };
  const next = () => {
    if (index === steps.length - 1) finish('completed');
    else setIndex(index + 1);
  };

  return (
    <aside className="tutorial-guide" aria-label="PVE 新手教学" aria-live="polite">
      <header>
        <span>
          新手教学 · {index + 1}/{steps.length}
        </span>
        <button
          type="button"
          aria-label="暂时关闭教学"
          onClick={() => {
            sessionStorage.setItem(PVE_TUTORIAL_SESSION_KEY, 'closed');
            onClose();
          }}
        >
          <X size={18} />
        </button>
      </header>
      <h2>{step.title}</h2>
      <p>{step.description}</p>
      <div className="tutorial-progress" aria-hidden="true">
        {steps.map((item, itemIndex) => (
          <i className={itemIndex <= index ? 'is-complete' : ''} key={item.id} />
        ))}
      </div>
      <footer>
        <button className="tutorial-skip" type="button" onClick={() => finish('skipped')}>
          跳过教学
        </button>
        <div>
          <button
            type="button"
            aria-label="上一步"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button className="tutorial-next" type="button" onClick={next}>
            {index === steps.length - 1 ? '完成' : '下一步'}
            {index === steps.length - 1 ? null : <ChevronRight size={18} />}
          </button>
        </div>
      </footer>
    </aside>
  );
}
