export type SoundName =
  | 'button'
  | 'select'
  | 'deal'
  | 'play'
  | 'attack'
  | 'damage'
  | 'heal'
  | 'shield'
  | 'draw'
  | 'joker'
  | 'turn'
  | 'win'
  | 'lose'
  | 'error';

const FREQUENCIES: Readonly<Record<SoundName, readonly [number, number, number]>> = {
  button: [280, 340, 0.05],
  select: [420, 560, 0.07],
  deal: [180, 240, 0.06],
  play: [260, 520, 0.12],
  attack: [190, 90, 0.18],
  damage: [120, 70, 0.2],
  heal: [360, 720, 0.22],
  shield: [300, 460, 0.2],
  draw: [220, 330, 0.09],
  joker: [440, 880, 0.3],
  turn: [520, 660, 0.16],
  win: [440, 880, 0.5],
  lose: [260, 110, 0.5],
  error: [170, 130, 0.16],
};

class AudioEngine {
  #context: AudioContext | null = null;
  enabled = localStorage.getItem('pokewar:sound') === 'on';
  volume = Number(localStorage.getItem('pokewar:volume') ?? '0.35');

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem('pokewar:sound', enabled ? 'on' : 'off');
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    localStorage.setItem('pokewar:volume', String(this.volume));
  }

  play(name: SoundName): void {
    if (!this.enabled) return;
    const AudioContextClass = window.AudioContext;
    this.#context ??= new AudioContextClass();
    const context = this.#context;
    const [startFrequency, endFrequency, duration] = FREQUENCIES[name];
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = name === 'damage' || name === 'error' ? 'sawtooth' : 'sine';
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, this.volume * 0.12), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }
}

export const audioEngine = new AudioEngine();
