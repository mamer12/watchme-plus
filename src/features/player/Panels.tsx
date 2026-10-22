import type { ReactNode } from 'react';
import type { SubtitleFiles, Title, VideoFile } from '../../api/types';
import { CheckIcon } from '../../components/Icons';
import type { SubtitleLang } from '../../state/library';
import { Episodes } from '../title/Episodes';
import { SPEEDS } from './logic';

function Option({ selected, disabled, onClick, children }: { selected: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <li>
      <button type="button" className={`popover__opt ${selected ? 'is-selected' : ''}`} aria-pressed={selected} disabled={disabled} onClick={onClick}>
        <span className="popover__check">{selected && <CheckIcon size={18} />}</span>
        {children}
      </button>
    </li>
  );
}

/** "Auto (480p)": the menu entry shows the level auto is on right now. */
export const autoLabel = (auto: boolean, quality: VideoFile | null): string => (auto && quality ? `Auto (${quality.resolution})` : 'Auto');

interface AudioSubsProps {
  subtitles: SubtitleFiles;
  lang: SubtitleLang;
  onLang: (l: SubtitleLang) => void;
  files: VideoFile[];
  quality: VideoFile | null;
  onQuality: (f: VideoFile) => void;
  /** Auto quality is on. */
  auto: boolean;
  onAuto: () => void;
  offset: number;
  onOffset: (o: number) => void;
  failed: boolean;
}

/** Audio & Subtitles, with the quality picker and subtitle timing alongside. */
export function AudioSubsPanel({ subtitles, lang, onLang, files, quality, onQuality, auto, onAuto, offset, onOffset, failed }: AudioSubsProps) {
  return (
    <div className="popover popover--audio" role="dialog" aria-label="Audio and subtitles">
      <div className="popover__cols">
        <section>
          <h3>Audio</h3>
          <ul>
            <Option selected onClick={() => {}}>
              Original
            </Option>
          </ul>
        </section>
        <section>
          <h3>Subtitles</h3>
          <ul>
            <Option selected={lang === 'off'} onClick={() => onLang('off')}>
              Off
            </Option>
            <Option selected={lang === 'ar'} disabled={!subtitles.ar} onClick={() => onLang('ar')}>
              العربية
            </Option>
            <Option selected={lang === 'en'} disabled={!subtitles.en} onClick={() => onLang('en')}>
              English
            </Option>
          </ul>
          {failed && <p className="popover__note">Couldn't load these subtitles.</p>}
        </section>
        <section>
          <h3>Quality</h3>
          <ul>
            <Option selected={auto} onClick={onAuto}>
              {autoLabel(auto, quality)}
            </Option>
            {[...files].reverse().map((f) => (
              <Option key={f.height} selected={!auto && quality?.height === f.height} onClick={() => onQuality(f)}>
                {f.height >= 2160 ? '4K' : f.resolution}
                {f.height >= 720 && f.height < 2160 && <span className="popover__tag">HD</span>}
              </Option>
            ))}
          </ul>
        </section>
      </div>
      {lang !== 'off' && (
        <div className="popover__timing">
          <span>Subtitle timing</span>
          <button type="button" className="icon-btn" aria-label="Show subtitles earlier" onClick={() => onOffset(Math.round((offset - 0.5) * 10) / 10)}>
            −
          </button>
          <output aria-live="polite">{offset > 0 ? `+${offset.toFixed(1)}` : offset.toFixed(1)}s</output>
          <button type="button" className="icon-btn" aria-label="Show subtitles later" onClick={() => onOffset(Math.round((offset + 0.5) * 10) / 10)}>
            +
          </button>
        </div>
      )}
    </div>
  );
}

export function SpeedPanel({ speed, onSpeed }: { speed: number; onSpeed: (s: number) => void }) {
  return (
    <div className="popover popover--speed" role="dialog" aria-label="Playback speed">
      <h3>Playback Speed</h3>
      <div className="speed">
        <span className="speed__line" />
        {SPEEDS.map((s) => (
          <button key={s} type="button" className={`speed__stop ${s === speed ? 'is-selected' : ''}`} aria-pressed={s === speed} onClick={() => onSpeed(s)}>
            <span className="speed__dot" />
            <span className="speed__label">{s === 1 ? '1x (Normal)' : `${s}x`}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function VolumePanel({ volume, muted, onVolume }: { volume: number; muted: boolean; onVolume: (v: number) => void }) {
  const value = muted ? 0 : volume;
  return (
    <div className="popover popover--volume">
      <input
        type="range"
        className="volume"
        min={0}
        max={1}
        step={0.05}
        value={value}
        aria-label="Volume"
        onChange={(e) => onVolume(Number(e.target.value))}
        style={{ ['--fill' as string]: `${value * 100}%` }}
      />
    </div>
  );
}

export function EpisodesPanel({ episodes, currentId, onPlay }: { episodes: Title[]; currentId: string; onPlay: (e: Title) => void }) {
  return (
    <div className="popover popover--episodes" role="dialog" aria-label="Episodes">
      <Episodes episodes={episodes} currentId={currentId} onPlay={onPlay} compact />
    </div>
  );
}
