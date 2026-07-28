import type { GameMode } from '@pokewar/protocol';

export function ModeSelector({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: GameMode;
  readonly onChange: (mode: GameMode) => void;
  readonly disabled?: boolean;
}) {
  return (
    <div className="mode-selector" aria-label="游戏模式">
      <button
        type="button"
        aria-pressed={value === 'normal'}
        disabled={disabled}
        onClick={() => onChange('normal')}
      >
        <strong>标准战</strong>
        <span>3 名角色</span>
      </button>
      <button
        type="button"
        aria-pressed={value === 'quick'}
        disabled={disabled}
        onClick={() => onChange('quick')}
      >
        <strong>快速战</strong>
        <span>1 名角色</span>
      </button>
    </div>
  );
}
