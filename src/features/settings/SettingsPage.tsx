import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { providerManager, useProviderState } from '../../api/provider';
import { providerLabel } from '../../api/endpoints';
import type { Level } from '../../api/types';
import { useIsp } from '../../hooks/useIsp';
import { invalidateQueries } from '../../hooks/useQuery';
import { LEVEL_LABELS } from '../../lib/ratings';
import { clearHistory, updateSettings, type Settings } from '../../state/library';
import { update, useSettings } from '../../state/store';
import { GuardianPad } from '../../profiles/Guardian';
import { profileStore, useProfiles } from '../../profiles/singleton';
import { AccountSection } from '../../sync/AccountSection';
import { SyncSection } from '../../sync/SyncSection';
import { ResetSiteDialog } from './ResetSiteDialog';

const QUALITIES = ['2160p', '1080p', '720p', '480p', '360p', '240p'];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field__text">
        <span className="field__label">{label}</span>
        {hint && <span className="field__hint">{hint}</span>}
      </div>
      <div className="field__control">{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const navigate = useNavigate();
  const isp = useIsp();
  const conn = useProviderState();
  const [cleared, setCleared] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [guard, setGuard] = useState(false);
  const profiles = useProfiles();
  const set = (patch: Partial<Settings>) => update((st) => updateSettings(st, patch));

  return (
    <div className="page settings-page">
      <h1 className="page-title">Settings</h1>

      <section className="settings-group">
        <h2>Connection</h2>
        <Field label={`Connected through: ${providerLabel(isp)}`} hint={conn.fixed ? 'Fixed by ?isp= in the address for this session. Re-check goes back to automatic.' : 'Picked automatically: Watchme+ tests the available connections and switches by itself if one stops working.'}>
          <button type="button" className="btn btn--info btn--sm" disabled={conn.checking} onClick={() => void providerManager().recheck()}>
            {conn.checking ? 'Checking…' : 'Re-check'}
          </button>
        </Field>
      </section>

      <section className="settings-group">
        <h2>Viewing</h2>
        <Field label="Family filter" hint="Applies to every row, search and the billboard.">
          <select
            className="select"
            value={s.level}
            onChange={(e) => {
              set({ level: Number(e.target.value) as Level });
              invalidateQueries();
            }}
          >
            {([0, 2, 3] as Level[]).map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Skip flagged scenes" hint="Jumps over scenes the catalog marks as not family-friendly.">
          <Toggle label="Skip flagged scenes" checked={s.familySkips} onChange={(v) => set({ familySkips: v })} />
        </Field>
        <Field label="Title language" hint="Titles, synopses and logos.">
          <Segmented
            label="Title language"
            value={s.titleLang}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ar', label: 'العربية' },
            ]}
            onChange={(v) => set({ titleLang: v })}
          />
        </Field>
      </section>

      <section className="settings-group">
        <h2>Playback</h2>
        <Field label="Autoplay previews and trailers" hint="Muted previews on the billboard, trailers on hover cards and in details (never on data saver or with reduced motion).">
          <Toggle label="Autoplay previews and trailers" checked={s.previewAutoplay} onChange={(v) => set({ previewAutoplay: v })} />
        </Field>
        <Field label="Autoplay next episode">
          <Toggle label="Autoplay next episode" checked={s.autoplayNext} onChange={(v) => set({ autoplayNext: v })} />
        </Field>
        <Field label="Quality" hint="Auto follows your connection and switches without interrupting playback.">
          <select
            className="select"
            value={s.qualityAuto ? 'auto' : s.quality}
            onChange={(e) => set(e.target.value === 'auto' ? { qualityAuto: true } : { qualityAuto: false, quality: e.target.value })}
          >
            <option value="auto">Auto</option>
            {QUALITIES.map((q) => (
              <option key={q} value={q}>
                {q === '2160p' ? '4K (when supported)' : q}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Highest automatic quality" hint="4K appears in the player when your browser can decode HEVC.">
          <select className="select" value={s.qualityCap} onChange={(e) => set({ qualityCap: e.target.value })}>
            {QUALITIES.map((q) => (
              <option key={q} value={q}>
                {q === '2160p' ? '4K (when supported)' : q}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="settings-group">
        <h2>Subtitles</h2>
        <Field label="Default subtitles">
          <Segmented
            label="Default subtitles"
            value={s.subtitleLang}
            options={[
              { value: 'ar', label: 'العربية' },
              { value: 'en', label: 'English' },
              { value: 'off', label: 'Off' },
            ]}
            onChange={(v) => set({ subtitleLang: v })}
          />
        </Field>
        <Field label="Size">
          <Segmented
            label="Subtitle size"
            value={s.subtitleSize}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'large', label: 'Large' },
            ]}
            onChange={(v) => set({ subtitleSize: v })}
          />
        </Field>
        <Field label="Color">
          <Segmented
            label="Subtitle color"
            value={s.subtitleColor}
            options={[
              { value: 'white', label: 'White' },
              { value: 'yellow', label: 'Yellow' },
              { value: 'cyan', label: 'Cyan' },
            ]}
            onChange={(v) => set({ subtitleColor: v })}
          />
        </Field>
        <Field label="Background">
          <Segmented
            label="Subtitle background"
            value={s.subtitleBackground}
            options={[
              { value: 'shadow', label: 'Drop shadow' },
              { value: 'box', label: 'Dark box' },
              { value: 'none', label: 'None' },
            ]}
            onChange={(v) => set({ subtitleBackground: v })}
          />
        </Field>
        <div className={`subs-preview subs subs--${s.subtitleSize} subs--${s.subtitleColor} subs--bg-${s.subtitleBackground}`} aria-hidden="true">
          <span>This is how subtitles will look.</span>
          <span dir="rtl">هكذا ستظهر الترجمة.</span>
        </div>
        <Field label="Timing offset" hint="Positive values show subtitles later.">
          <div className="stepper">
            <button type="button" className="icon-btn" aria-label="Earlier" onClick={() => set({ subtitleOffset: Math.round((s.subtitleOffset - 0.5) * 10) / 10 })}>
              −
            </button>
            <output>{s.subtitleOffset.toFixed(1)}s</output>
            <button type="button" className="icon-btn" aria-label="Later" onClick={() => set({ subtitleOffset: Math.round((s.subtitleOffset + 0.5) * 10) / 10 })}>
              +
            </button>
          </div>
        </Field>
      </section>

      <section className="settings-group">
        <h2>Profiles</h2>
        <Field label="Ask who's watching on every start" hint="Off: this device reopens the last profile. Viewing choices above, My List, ratings and progress belong to the profile; quality, volume and previews are for this device.">
          <Toggle label="Ask who's watching on every start" checked={profiles.askOnStart} onChange={(v) => profileStore.setAskOnStart(v)} />
        </Field>
        <Field label="Manage profiles" hint="Add, edit or remove profiles, set a PIN, make a Kids profile.">
          <button type="button" className="btn btn--info btn--sm" onClick={() => (profileStore.guardianRequired() ? setGuard(true) : profileStore.openPicker(true))}>
            Manage profiles
          </button>
        </Field>
      </section>
      {guard && <GuardianPad onCancel={() => setGuard(false)} onOk={() => { setGuard(false); profileStore.openPicker(true); }} />}

      <AccountSection />
      <SyncSection />

      <section className="settings-group">
        <h2>Your data</h2>
        <Field label="Watch history" hint="Clears Continue Watching and resume points. My List and ratings stay.">
          <button
            type="button"
            className="btn btn--info btn--sm"
            onClick={() => {
              if (window.confirm('Clear your watch history?')) {
                update(clearHistory);
                setCleared(true);
              }
            }}
          >
            {cleared ? 'Cleared' : 'Clear history'}
          </button>
        </Field>
        <Field label="Taste" hint="Pick genres and titles again to tune recommendations.">
          <button type="button" className="btn btn--info btn--sm" onClick={() => navigate('/welcome')}>
            Redo onboarding
          </button>
        </Field>
      </section>

      <section className="settings-group settings-group--danger">
        <h2>Danger zone</h2>
        <Field label="Reset this site" hint="Deletes everything stored in this browser (My List, ratings, progress, settings, cached images) and starts over. Also works by adding ?reset=1 to the site address.">
          <button type="button" className="btn btn--danger btn--sm" onClick={() => setResetOpen(true)}>
            Reset this site
          </button>
        </Field>
      </section>
      {resetOpen && <ResetSiteDialog onClose={() => setResetOpen(false)} />}

      <p className="about">
        Watchme+ is an unofficial client for the streaming catalog. Videos stream directly from the catalog's CDN, so they play wherever
        the catalog does. Artwork and weekly charts come from TMDB. Everything you save stays in this browser, unless you turn on Sync to share it with your other devices.
      </p>
    </div>
  );
}
