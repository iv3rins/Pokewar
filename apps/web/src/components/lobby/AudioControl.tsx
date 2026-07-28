import { Volume2, VolumeX } from 'lucide-react';
import { useState } from 'react';
import { audioEngine } from '../../services/audio.js';

export function AudioControl() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(audioEngine.enabled);
  const [volume, setVolume] = useState(audioEngine.volume);
  const toggle = () => {
    const next = !enabled;
    audioEngine.setEnabled(next);
    setEnabled(next);
    if (next) audioEngine.play('button');
  };
  return (
    <div className="audio-control">
      <button
        className="header-icon-button"
        type="button"
        aria-label={enabled ? '声音已开启' : '声音已静音'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {enabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
      </button>
      {open ? (
        <section className="audio-popover" aria-label="声音设置">
          <button className="game-button" type="button" onClick={toggle}>
            {enabled ? '静音' : '开启声音'}
          </button>
          <label>
            音量 {Math.round(volume * 100)}%
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(volume * 100)}
              onChange={(event) => {
                const next = Number(event.target.value) / 100;
                audioEngine.setVolume(next);
                setVolume(next);
              }}
            />
          </label>
        </section>
      ) : null}
    </div>
  );
}
