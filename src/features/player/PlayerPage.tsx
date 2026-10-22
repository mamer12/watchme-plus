import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Title, VideoFile } from '../../api/types';
import {
  ArrowLeftIcon,
  Back10Icon,
  EpisodesIcon,
  ExitFullscreenIcon,
  FlagIcon,
  Forward10Icon,
  FullscreenIcon,
  NextEpisodeIcon,
  PauseIcon,
  PlayIcon,
  SpeedIcon,
  SubtitlesIcon,
  VolumeIcon,
} from '../../components/Icons';
import { Spinner } from '../../components/Skeleton';
import { useIsp } from '../../hooks/useIsp';
import { liveProfiles } from '../../profiles/logic';
import { useProfiles } from '../../profiles/singleton';
import { isAdaptive, readWorkingQuality, startFile, writeWorkingQuality } from '../../lib/adaptiveQuality';
import { resolvePlayUrl } from '../../lib/playUrl';
import { isExpiring } from '../../lib/signedUrl';
import { clock, displayTitle, synopsis } from '../../lib/format';
import { activeCues } from '../../lib/subtitles';
import { allowedAtLevel } from '../../lib/ratings';
import { recordProgress, startPosition, updateSettings, type SubtitleLang } from '../../state/library';
import { flush, getState, update, useSettings } from '../../state/store';
import { syncFlush, syncPlaying } from '../../sync/bridge';
import {
  clampTime,
  countdownLeft,
  endAction,
  familySkipTarget,
  familyToggleMessage,
  hevcSupported,
  nextEpisode,
  pickQuality,
  playableFiles,
  rangeAt,
  SEEK_STEP,
  nextCardPlan,
  tapZone,
} from './logic';
import { AudioSubsPanel, EpisodesPanel, SpeedPanel, VolumePanel } from './Panels';
import { ProgressBar } from './ProgressBar';
import { parallelWanted } from '../../lib/parallelPage';
import { createSwapEngine, type SwapOutcome } from './swapEngine';
import { announcedPercent, bufferedAheadOf, LOAD_PERCENT, nextPercent, rawPercent } from './loadPercent';
import { createLogGate, errorKind, newLadder, nextStep, noteGoodPlay, noteTrouble, shouldHandleError } from './recovery';

/** Marks a link the service worker must leave alone (plain, single-connection path). */
const PLAIN_MARK = '#wmp-plain';
import { useActiveVideo, type Slot } from './useActiveVideo';
import { useAutoQuality } from './useAutoQuality';
import { usePlayerData } from './usePlayerData';
import { useSubtitles } from './useSubtitles';
import './player.css';

const HIDE_CONTROLS_MS = 3000;
const PAUSE_SCREEN_MS = 5000;
const SAVE_EVERY_MS = 5000;
const DOUBLE_TAP_MS = 300;

type Panel = 'episodes' | 'subs' | 'speed' | 'volume' | null;

function hevcProbe(): boolean {
  const v = document.createElement('video');
  return hevcSupported({
    isTypeSupported: typeof MediaSource !== 'undefined' ? (t) => MediaSource.isTypeSupported(t) : undefined,
    canPlayType: (t) => v.canPlayType(t),
  });
}

export default function PlayerPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const restart = !!(location.state as { restart?: boolean } | null)?.restart;
  const settings = useSettings();
  const [reloadKey, setReloadKey] = useState(0);
  const status = usePlayerData(id, reloadKey);
  // Answers for the previous episode are ignored while the next one loads.
  const data = status.state === 'ready' && status.data.id === id ? status.data : null;

  const root = useRef<HTMLDivElement>(null);
  const av = useActiveVideo();
  const { video } = av;
  const pendingSeek = useRef<number | null>(null);
  const epoch = useRef(0);
  const swappedTo = useRef<string | null>(null);
  const engineRef = useRef<ReturnType<typeof createSwapEngine> | null>(null);
  const manualSeq = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ t: number; zone: string } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [quality, setQuality] = useState<VideoFile | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(true);
  const [controls, setControls] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [subText, setSubText] = useState('');
  const [nextDismissed, setNextDismissed] = useState(false);
  const [endLeft, setEndLeft] = useState<number | null>(null);
  const [endCancelled, setEndCancelled] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [plainOnly, setPlainOnly] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const pctRef = useRef(0);
  const ladderRef = useRef(newLadder());
  const ladderFor = useRef('');
  const expiryReloads = useRef(0);
  const recoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoverTok = useRef(0);
  const retryResume = useRef(false);
  const logGate = useRef(createLogGate());
  const [ended, setEnded] = useState(false);
  const [pauseScreen, setPauseScreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ripple, setRipple] = useState<{ side: 'back' | 'forward'; key: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  const isp = useIsp();
  const adaptive = isAdaptive(isp);
  // Parallel range fetching (service worker) answers the mirror's video; the <video> stays a plain no-cors request.
  const parallel = adaptive && parallelWanted() && !plainOnly;
  const hevc = useMemo(() => hevcProbe(), []);
  const files = useMemo(() => (data ? playableFiles(data.files, hevc) : []), [data, hevc]);
  const episodes = data?.episodes ?? [];
  const details = data?.details ?? null;
  const current: Title | null = details ?? episodes.find((e) => e.id === id) ?? null;
  const series = details?.kind === 'series' ? episodes[0] ?? details : null;
  const next = useMemo(() => nextEpisode(episodes, id), [episodes, id]);
  const subs = useSubtitles(data?.subtitles ?? null, settings.subtitleLang, settings.subtitleOffset);
  const lang = settings.titleLang;

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Family mode from the player: the same switch as Settings, forced on for a Kids profile.
  const { list: profileList, activeId: activeProfileId } = useProfiles();
  const kidsProfile = liveProfiles(profileList).find((p) => p.id === activeProfileId)?.kids === true;
  const toggleFamily = useCallback(() => {
    if (kidsProfile) {
      flash('Family mode is always on for a Kids profile');
      return;
    }
    const on = !getState().settings.familySkips;
    update((s) => updateSettings(s, { familySkips: on }));
    flash(familyToggleMessage(on, data?.details?.familySkips?.length ?? 0));
  }, [kidsProfile, flash, data]);

  // ---- progress -------------------------------------------------------------------------------
  // What is loaded and where playback is, kept in refs so saving never mixes two episodes.
  const loaded = useRef<{ id: string; current: Title; series: Title | null; next: Title | null } | null>(null);
  const position = useRef({ id: '', time: 0, duration: 0 });
  useEffect(() => {
    if (data && current) loaded.current = { id: data.id, current, series, next };
  }, [data, current, series, next]);

  const save = useCallback((positionOverride?: number) => {
    const l = loaded.current;
    const p = position.current;
    if (!l || p.id !== l.id || !(p.duration > 0)) return;
    update((s) =>
      recordProgress(s, { video: l.current, series: l.series, position: positionOverride ?? p.time, duration: p.duration, next: l.next }),
    );
  }, []);

  // Sync ignores remote positions for the video playing here.
  useEffect(() => {
    syncPlaying(playing ? id : null);
    return () => syncPlaying(null);
  }, [playing, id]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => save(), SAVE_EVERY_MS);
    return () => clearInterval(t);
  }, [playing, save]);

  // Save when switching videos and when leaving the player; stop the old video meanwhile.
  useEffect(
    () => () => {
      save();
      flush();
      syncFlush();
      video.current?.pause();
    },
    [id, save],
  );

  // ---- source ---------------------------------------------------------------------------------
  useEffect(() => {
    if (!data) return;
    engineRef.current?.cancel('episode');
    epoch.current += 1;
    swappedTo.current = null;
    const chosen = settings.qualityAuto ? startFile(files, readWorkingQuality(isp), isp, parseInt(settings.qualityCap, 10) || 1080) : pickQuality(files, settings.quality);
    setQuality(chosen);
    setEnded(false);
    setNextDismissed(false);
    setEndCancelled(false);
    setEndLeft(null);
    setVideoError(null);
    setWaiting(true);
    setTime(0);
    // A new episode starts the recovery ladder over; a reload of the same one (links, Try again) keeps its counters.
    if (ladderFor.current !== data.id) {
      ladderFor.current = data.id;
      ladderRef.current = newLadder();
      expiryReloads.current = 0;
      setPlainOnly(false);
    }
    recoverTok.current += 1;
    if (recoverTimer.current) clearTimeout(recoverTimer.current);
    recoverTimer.current = null;
    setRecovering(false);
    pctRef.current = 0;
    setLoadPct(0);
    pendingSeek.current = restart && !retryResume.current ? 0 : startPosition(getState(), id);
    retryResume.current = false;
    // Only when a new video's data arrives.
    // The quality preference is read once here; changes go through changeQuality.
  }, [data]);

  // The address the active video loads: on the mirror, the file host behind the 302, so range requests skip the hop.
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!quality) {
      setSrc(null);
      return;
    }
    // A seamless swap already put this file on screen.
    if (swappedTo.current === quality.url) return;
    let alive = true;
    void resolvePlayUrl(quality.url, { adaptive, parallel }).then((u) => alive && setSrc(plainOnly ? u + PLAIN_MARK : u));
    return () => {
      alive = false;
    };
  }, [quality, adaptive, parallel, plainOnly]);

  useEffect(() => {
    if (av.urls.current[av.activeRef.current] !== src) {
      recoverTok.current += 1;
      pctRef.current = 0;
      setLoadPct(0);
      engineRef.current?.cancel('cancelled');
      av.load(av.activeRef.current, src);
    }
    // `av` is stable.
  }, [src]);

  // ---- seamless quality swap ------------------------------------------------------------------
  const speedRef = useRef(1);
  speedRef.current = speed;
  const pendingFile = useRef<{ file: VideoFile; url: string } | null>(null);
  const engine = useMemo(
    () =>
      createSwapEngine({
        main: () => av.video.current,
        standby: () => av.standby(),
        load: (url) => {
          const v = av.standby();
          if (v) {
            v.muted = true;
            v.playbackRate = speedRef.current;
          }
          av.load(av.standbySlot(), url);
        },
        release: () => av.load(av.standbySlot(), null),
        commit: () => {
          const next = pendingFile.current;
          const oldSlot = av.activeRef.current;
          const oldV = av.video.current;
          const slot: Slot = av.standbySlot();
          const newV = av.el(slot);
          if (!next || !newV) return;
          const st = getState().settings;
          newV.volume = st.volume;
          newV.muted = st.muted;
          newV.playbackRate = speedRef.current;
          if (oldV) oldV.muted = true;
          av.urls.current[slot] = next.url;
          av.activate(slot);
          av.load(oldSlot, null);
          swappedTo.current = next.file.url;
          setQuality(next.file);
          setSrc(next.url);
          setWaiting(false);
          setDuration(newV.duration);
        },
        speed: () => speedRef.current,
        blocked: () => {
          const v = av.video.current;
          return !!v && (document.pictureInPictureElement === v || !!v.webkitDisplayingFullscreen);
        },
        now: () => performance.now(),
        frame: (cb) => {
          const id = requestAnimationFrame(cb);
          return () => cancelAnimationFrame(id);
        },
        every: (ms, cb) => {
          const id = setInterval(cb, ms);
          return () => clearInterval(id);
        },
      }),
    // `av` is stable.
    [],
  );
  engineRef.current = engine;
  useEffect(() => () => engine.cancel('episode'), [engine, id]);

  /** Swaps to `file` without interrupting playback. */
  const swapToFile = useCallback(
    async (file: VideoFile): Promise<SwapOutcome> => {
      const my = epoch.current;
      if (!av.video.current || engine.busy()) return 'cancelled';
      const resolved = await resolvePlayUrl(file.url, { adaptive, parallel });
      const url = plainOnly ? resolved + PLAIN_MARK : resolved;
      if (my !== epoch.current || engine.busy()) return 'cancelled';
      pendingFile.current = { file, url };
      const out = await engine.swapTo(file.height, url);
      if (out === 'swapped') writeWorkingQuality(isp, file.resolution);
      return out;
    },
    [av, engine, adaptive, parallel, plainOnly, isp],
  );

  const cap = parseInt(settings.qualityCap, 10) || 1080;
  const auto = useAutoQuality({
    video,
    files,
    quality,
    auto: settings.qualityAuto,
    cap,
    swapTo: swapToFile,
    swapBusy: () => engine.busy(),
    resetKey: id,
  });

  // Test hook (off unless localStorage wmp:test-hook is 1): forces a swap and reports what happened.
  useEffect(() => {
    let on = false;
    try {
      on = localStorage.getItem('wmp:test-hook') === '1';
    } catch {
      /* no storage */
    }
    if (!on) return;
    const w = window as unknown as { __wmp?: unknown };
    w.__wmp = {
      swap: (height: number) => {
        const f = files.find((x) => x.height === height);
        return f ? swapToFile(f).then((o) => ({ outcome: o, drift: engine.stats().lastDrift })) : Promise.resolve({ outcome: 'unknown' });
      },
      active: () => ({ slot: av.activeRef.current, height: quality?.height, time: av.video.current?.currentTime }),
    };
    return () => {
      delete w.__wmp;
    };
  }, [files, swapToFile, engine, av, quality]);

  /** A fixed quality: auto stays off until Auto is picked again. The swap is seamless; only if it can't happen does the file reload. */
  const changeQuality = (f: VideoFile) => {
    update((st) => updateSettings(st, { quality: f.resolution, qualityAuto: false }));
    setPanel(null);
    if (f.height === quality?.height) return;
    const seq = ++manualSeq.current;
    engine.cancel('cancelled');
    void swapToFile(f).then((out) => {
      if (out === 'swapped' || out === 'seek' || out === 'episode' || seq !== manualSeq.current) return;
      pendingSeek.current = video.current?.currentTime ?? 0;
      setQuality(f);
      if (adaptive) writeWorkingQuality(isp, f.resolution);
    });
  };

  const chooseAuto = () => {
    manualSeq.current += 1;
    update((st) => updateSettings(st, { qualityAuto: true }));
    auto.rearm();
    setPanel(null);
  };

  // ---- playback controls ----------------------------------------------------------------------
  const togglePlay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused || v.ended) void v.play().catch(() => setPlaying(false));
    else v.pause();
  }, []);

  const seekTo = useCallback((t: number) => {
    const v = video.current;
    if (!v) return;
    engine.cancel('seek');
    v.currentTime = clampTime(t, v.duration);
    setTime(v.currentTime);
  }, [engine]);

  const seekBy = useCallback((d: number) => {
    const v = video.current;
    if (v) seekTo(v.currentTime + d);
  }, [seekTo]);

  const setVolume = useCallback((vol: number) => {
    const v = Math.min(1, Math.max(0, vol));
    update((s) => updateSettings(s, { volume: v || s.settings.volume, muted: v === 0 }));
  }, []);

  const toggleMute = useCallback(() => update((s) => updateSettings(s, { muted: !s.settings.muted })), []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.volume = settings.volume;
    v.muted = settings.muted;
  }, [settings.volume, settings.muted, quality]);

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed, quality]);

  const toggleFullscreen = useCallback(async () => {
    const el = root.current;
    const v = video.current;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (el?.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' });
        const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        if (matchMedia('(pointer: coarse)').matches) await orientation.lock?.('landscape').catch(() => {});
      } else {
        v?.webkitEnterFullscreen?.();
      }
    } catch {
      v?.webkitEnterFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const goNext = useCallback(() => {
    if (!next) return;
    save();
    setNextDismissed(true);
    navigate(`/watch/${next.id}`, { replace: true });
  }, [next, navigate, save]);

  const playEpisode = (e: Title) => {
    setPanel(null);
    if (e.id === id) return;
    save();
    navigate(`/watch/${e.id}`, { replace: true });
  };

  const back = () => {
    save();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    if (location.key !== 'default') navigate(-1);
    else navigate(`/title/${series?.id ?? id}`, { replace: true });
  };

  // ---- controls visibility & pause screen ----------------------------------------------------
  const activeRef = useRef(false);
  activeRef.current = playing && !panel && !scrubbing;
  const lastActivity = useRef(Date.now());

  const poke = useCallback(() => {
    lastActivity.current = Date.now();
    setControls(true);
    setPauseScreen(false);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (activeRef.current) setControls(false);
    }, HIDE_CONTROLS_MS);
  }, []);

  useEffect(() => {
    if (playing && !panel && !scrubbing) poke();
    else {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setControls(true);
    }
  }, [playing, panel, scrubbing, poke]);

  // "You're watching" after 5 seconds paused without activity.
  useEffect(() => {
    if (playing || ended || !data) {
      setPauseScreen(false);
      return;
    }
    const t = setInterval(() => {
      if (Date.now() - lastActivity.current >= PAUSE_SCREEN_MS) {
        setPauseScreen(true);
        setControls(false);
        setPanel(null);
      }
    }, 500);
    return () => clearInterval(t);
  }, [playing, ended, data]);

  // ---- subtitles renderer (frame-accurate) ----------------------------------------------------
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      const v = video.current;
      if (v) {
        const text = activeCues(subs.cues, v.currentTime, settings.subtitleOffset)
          .map((c) => c.text)
          .join('\n');
        if (text !== last) {
          last = text;
          setSubText(text);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [subs.cues, settings.subtitleOffset]);

  // ---- next episode ---------------------------------------------------------------------------
  const remaining = duration - time;
  // The button (no countdown) from the credits on; the next episode starts by itself only after the video has ended.
  const plan = nextCardPlan(duration, time, nextDismissed, !!next);
  const nextCard = plan.show && !!next && !ended;
  const endMode = endAction({ ended, hasNext: !!next, autoplay: settings.autoplayNext, suppressed: nextDismissed || endCancelled });
  // Seeking back before the button resets a dismissal.
  useEffect(() => {
    if (!ended && time < plan.at && nextDismissed) setNextDismissed(false);
  }, [time, plan.at, ended, nextDismissed]);
  useEffect(() => {
    if (!ended && endCancelled) setEndCancelled(false);
  }, [ended, endCancelled]);
  useEffect(() => {
    if (endMode !== 'countdown') {
      setEndLeft(null);
      return;
    }
    const started = performance.now();
    setEndLeft(countdownLeft(0));
    const t = setInterval(() => {
      const left = countdownLeft(performance.now() - started);
      setEndLeft(left);
      if (left <= 0) {
        clearInterval(t);
        goNext();
      }
    }, 250);
    return () => clearInterval(t);
  }, [endMode, goNext]);

  // ---- keyboard -------------------------------------------------------------------------------
  const intro = data?.details ? rangeAt(time, data.details.introSkips) : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' && e.key !== 'Escape') return;
      let handled = true;
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          // Like Netflix, space always plays/pauses (Enter still activates the focused button).
          togglePlay();
          break;
        case 'ArrowLeft':
          seekBy(-SEEK_STEP);
          break;
        case 'ArrowRight':
          seekBy(SEEK_STEP);
          break;
        case 'ArrowUp':
          setVolume((settings.muted ? 0 : settings.volume) + 0.1);
          break;
        case 'ArrowDown':
          setVolume((settings.muted ? 0 : settings.volume) - 0.1);
          break;
        case 'f':
        case 'F':
          void toggleFullscreen();
          break;
        case 'm':
        case 'M':
          toggleMute();
          break;
        case 's':
        case 'S':
          if (intro) seekTo(intro.end);
          else handled = false;
          break;
        case 'Escape':
          if (panel) setPanel(null);
          else if (endMode === 'countdown') setEndCancelled(true);
          else if (nextCard) setNextDismissed(true);
          else handled = false;
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        poke();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekBy, seekTo, setVolume, toggleMute, toggleFullscreen, panel, nextCard, endMode, intro, poke, settings.muted, settings.volume]);

  // ---- video events ---------------------------------------------------------------------------
  const onTimeUpdate = () => {
    const v = video.current;
    if (!v) return;
    setTime(v.currentTime);
    if (!v.paused && !v.seeking && v.readyState >= 3) {
      const before = ladderRef.current;
      ladderRef.current = noteGoodPlay(before, Date.now());
      if (before.goodSince !== null && ladderRef.current.reseats === 0 && before.reseats > 0) expiryReloads.current = 0;
    }
    if (loaded.current) position.current = { id: loaded.current.id, time: v.currentTime, duration: v.duration };
    if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
    const skipTo = familySkipTarget(v.currentTime, data?.details?.familySkips ?? [], settings.familySkips);
    if (skipTo !== null) {
      v.currentTime = skipTo;
      flash('Skipped a scene (family filter)');
    }
  };

  const onLoadedMetadata = () => {
    const v = video.current;
    if (!v) return;
    setDuration(v.duration);
    const seek = pendingSeek.current;
    pendingSeek.current = null;
    if (seek && seek > 0 && seek < v.duration - 5) v.currentTime = seek;
    v.playbackRate = speed;
    void v.play().catch(() => setPlaying(false));
  };

  const onEnded = () => {
    save(video.current?.duration ?? 0);
    syncFlush();
    setPlaying(false);
    setEnded(true);
  };

  /** Where playback was: the cached position, never read from an element that may be detached. */
  const lastPosition = () => (position.current.id === id ? position.current.time : pendingSeek.current ?? 0);

  const onVideoError = (slot: Slot) => {
    const el = av.el(slot);
    if (!shouldHandleError({ fromActive: av.isActive(slot), errorSrc: el?.getAttribute('src'), expectedSrc: av.urls.current[slot] })) return;
    const kind = errorKind(el?.error?.code);
    if (logGate.current(`${kind}:${quality?.height ?? 0}`, Date.now())) console.warn('[player] video error:', kind, el?.error?.message ?? '');
    if (recoverTimer.current) return; // a re-seat is already waiting
    ladderRef.current = noteTrouble(ladderRef.current);
    const at = lastPosition();
    // A signed link that ran out: ask the catalog for fresh ones and carry on from here (twice at most per ladder).
    if (src && isExpiring(src, Date.now(), 0) && expiryReloads.current < 2) {
      expiryReloads.current += 1;
      save();
      retryResume.current = true;
      setReloadKey((k) => k + 1);
      return;
    }
    const lower = quality ? [...files].reverse().find((f) => f.height < quality.height) : undefined;
    const { step, ladder } = nextStep(ladderRef.current, { kind, parallel, canLower: !!lower });
    ladderRef.current = ladder;
    engineRef.current?.cancel('error');
    switch (step.action) {
      case 'reseat': {
        // Same source, same moment, after a short wait; the buffering state shows meanwhile.
        setRecovering(true);
        setWaiting(true);
        pendingSeek.current = at;
        const tok = ++recoverTok.current;
        recoverTimer.current = setTimeout(() => {
          recoverTimer.current = null;
          if (tok !== recoverTok.current) return;
          const s = av.activeRef.current;
          const url = av.urls.current[s];
          if (url) av.load(s, url);
        }, step.delayMs);
        return;
      }
      case 'plain':
        setRecovering(true);
        setWaiting(true);
        pendingSeek.current = at;
        swappedTo.current = null;
        setPlainOnly(true);
        return;
      case 'lower':
        if (!lower) return;
        setRecovering(true);
        setWaiting(true);
        pendingSeek.current = at;
        swappedTo.current = null;
        setQuality(lower);
        return;
      default:
        save();
        setRecovering(false);
        setVideoError("This video couldn't be played right now.");
    }
  };

  useEffect(
    () => () => {
      if (recoverTimer.current) clearTimeout(recoverTimer.current);
    },
    [],
  );

  // ---- loading percent ------------------------------------------------------------------------
  const loading = (waiting || !data) && !ended;
  useEffect(() => {
    if (!loading) return;
    pctRef.current = 0;
    setLoadPct(0);
    const t = setInterval(() => {
      const v = video.current;
      if (!v) return;
      const raw = rawPercent(bufferedAheadOf(v.buffered, v.currentTime), v.duration - v.currentTime);
      const n = nextPercent(pctRef.current, raw, false);
      if (n !== pctRef.current) {
        pctRef.current = n;
        setLoadPct(n);
      }
    }, LOAD_PERCENT.TICK_MS);
    return () => clearInterval(t);
  }, [loading]);

  // ---- pointer: click / tap / double-tap ------------------------------------------------------
  const onSurfaceUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panel) {
      setPanel(null);
      return;
    }
    if (e.pointerType === 'mouse') {
      togglePlay();
      poke();
      return;
    }
    const zone = tapZone(e.clientX - e.currentTarget.getBoundingClientRect().left, e.currentTarget.clientWidth);
    const now = Date.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && zone !== 'center' && prev.zone === zone) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      seekBy(zone === 'back' ? -SEEK_STEP : SEEK_STEP);
      setRipple({ side: zone, key: now });
      lastTap.current = { t: now, zone };
      return;
    }
    lastTap.current = { t: now, zone };
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      setControls((c) => !c);
      setPauseScreen(false);
    }, DOUBLE_TAP_MS);
  };

  useEffect(() => {
    if (!ripple) return;
    const t = setTimeout(() => setRipple(null), 600);
    return () => clearTimeout(t);
  }, [ripple]);

  // ---- render ---------------------------------------------------------------------------------
  const blocked = !!details && !allowedAtLevel(details, settings.level);
  if (status.state === 'error' || videoError || blocked) {
    return (
      <div className="player player--message" data-nav-ignore>
        <button type="button" className="player__back icon-btn" aria-label="Back" onClick={back}>
          <ArrowLeftIcon size={32} />
        </button>
        <div className="player__error">
          <h1>{blocked ? 'Not available with your family filter' : 'Playback problem'}</h1>
          <p>
            {blocked
              ? 'Change the family filter in Settings to watch this title.'
              : videoError ?? (status.state === 'error' ? status.message : '')}
          </p>
          {!blocked && (
            <button
              type="button"
              className="btn btn--play"
              onClick={() => {
                ladderRef.current = newLadder();
                expiryReloads.current = 0;
                retryResume.current = true;
                setPlainOnly(false);
                setVideoError(null);
                setReloadKey((k) => k + 1);
              }}
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const name = current ? displayTitle(series ?? current, lang) : '';
  const episodeName = current?.kind === 'series' && current.episode ? `E${current.episode}` : null;
  const episodeTitle = current?.kind === 'series' ? `Episode ${current.episode ?? ''}`.trim() : null;
  const volumeLevel = settings.muted ? 0 : settings.volume;
  const subClass = `subs subs--${settings.subtitleSize} subs--${settings.subtitleColor} subs--bg-${settings.subtitleBackground} ${controls ? 'subs--raised' : ''}`;

  return (
    <div
      ref={root}
      className={`player ${controls ? 'player--controls' : 'player--idle'} ${pauseScreen ? 'player--paused-screen' : ''}`}
      data-nav-ignore
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') poke();
      }}
    >
      {(['a', 'b'] as const).map((slot) => {
        const on = (fn: () => void) => () => {
          if (av.isActive(slot)) fn();
        };
        return (
          <video
            key={slot}
            ref={av.refs[slot]}
            className={`player__video ${av.active === slot ? '' : 'player__video--standby'}`}
            aria-hidden={av.active === slot ? undefined : true}
            playsInline
            preload="auto"
            onLoadedMetadata={on(onLoadedMetadata)}
            onDurationChange={on(() => setDuration(video.current?.duration ?? 0))}
            onTimeUpdate={on(onTimeUpdate)}
            onSeeking={on(() => {
              engine.notify('seeking');
              ladderRef.current = noteTrouble(ladderRef.current);
              const v = video.current;
              if (v && bufferedAheadOf(v.buffered, v.currentTime) < 0.1) {
                pctRef.current = 0;
                setLoadPct(0);
              }
            })}
            onSeeked={on(() => {
              const v = video.current;
              if (v && loaded.current) position.current = { id: loaded.current.id, time: v.currentTime, duration: v.duration };
              save();
              syncFlush();
            })}
            onPlay={on(() => {
              setPlaying(true);
              setEnded(false);
              engine.notify('play');
            })}
            onPause={on(() => {
              setPlaying(false);
              save();
              syncFlush();
              engine.notify('pause');
            })}
            onWaiting={on(() => {
              ladderRef.current = noteTrouble(ladderRef.current);
              setWaiting(true);
            })}
            onPlaying={on(() => {
              setWaiting(false);
              setRecovering(false);
            })}
            onCanPlay={on(() => {
              setWaiting(false);
              setRecovering(false);
            })}
            onEnded={on(onEnded)}
            onError={() => onVideoError(slot)}
            onDoubleClick={() => void toggleFullscreen()}
          >
            {subs.vttUrl && settings.subtitleLang !== 'off' && (
              <track key={subs.vttUrl} kind="subtitles" src={subs.vttUrl} srcLang={settings.subtitleLang} label={settings.subtitleLang === 'ar' ? 'العربية' : 'English'} />
            )}
          </video>
        );
      })}

      <div className="player__surface" onPointerUp={onSurfaceUp} onDoubleClick={() => void toggleFullscreen()} />

      {subText && (
        <div className={subClass} aria-live="off">
          {subText.split('\n').map((line, i) => (
            <span key={i} dir="auto">
              {line}
            </span>
          ))}
        </div>
      )}

      {loading && (
        <div className="player__spinner">
          <Spinner label="Buffering" percent={data ? loadPct : null} announce={data ? announcedPercent(loadPct) : null} />
          {recovering && <p className="player__reconnecting">Reconnecting…</p>}
        </div>
      )}

      {ripple && (
        <div key={ripple.key} className={`ripple ripple--${ripple.side}`} aria-hidden="true">
          {ripple.side === 'back' ? <Back10Icon size={36} /> : <Forward10Icon size={36} />}
          <span>10 seconds</span>
        </div>
      )}

      {toast && (
        <div className="player__toast" role="status">
          {toast}
        </div>
      )}

      {pauseScreen && current && (
        <div className="pause-screen" aria-live="polite">
          <p className="pause-screen__kicker">You're watching</p>
          <h1 className="pause-screen__title" dir="auto">
            {name}
          </h1>
          {episodeTitle && (
            <p className="pause-screen__ep">
              Season {current.season ?? 1}: Ep. {current.episode}
            </p>
          )}
          {synopsis(current, lang) && (
            <p className="pause-screen__text" dir="auto">
              {synopsis(current, lang)}
            </p>
          )}
          <p className="pause-screen__paused">Paused</p>
        </div>
      )}

      <div className="player__top">
        <button type="button" className="player__back icon-btn" aria-label="Back to browse" onClick={back}>
          <ArrowLeftIcon size={34} />
        </button>
        <div className="player__title player__toptitle" dir="auto">
          <strong>{name}</strong>
          {episodeName && <span className="player__ep">{episodeName}</span>}
        </div>
      </div>

      {/* Touch devices: big centre controls. */}
      <div className="player__center">
        <button type="button" className="icon-btn" aria-label="Back 10 seconds" onClick={() => seekBy(-SEEK_STEP)}>
          <Back10Icon size={44} />
        </button>
        <button type="button" className="icon-btn player__bigplay" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
          {playing ? <PauseIcon size={56} /> : <PlayIcon size={56} />}
        </button>
        <button type="button" className="icon-btn" aria-label="Forward 10 seconds" onClick={() => seekBy(SEEK_STEP)}>
          <Forward10Icon size={44} />
        </button>
      </div>

      {intro && !nextCard && (
        <button type="button" className="skip-intro" onClick={() => seekTo(intro.end)}>
          Skip Intro
        </button>
      )}

      {nextCard && next && (
        <div className="next-card">
          <button type="button" className="btn btn--ghost" aria-label="Dismiss" onClick={() => setNextDismissed(true)}>
            ✕
          </button>
          <button type="button" className="btn btn--next" onClick={goNext}>
            <NextEpisodeIcon size={20} /> Next Episode
          </button>
        </div>
      )}

      {ended && (
        <div className="end-screen">
          {next ? (
            <>
              <p className="pause-screen__kicker">Up Next</p>
              <h2>
                Season {next.season ?? 1}: Episode {next.episode}
              </h2>
              <button type="button" className="btn btn--play" onClick={goNext}>
                <PlayIcon size={22} /> {endMode === 'countdown' && endLeft !== null ? `Next episode in ${endLeft}` : 'Play Next Episode'}
              </button>
              {endMode === 'countdown' && (
                <button type="button" className="btn btn--ghost" onClick={() => setEndCancelled(true)}>
                  Cancel
                </button>
              )}
            </>
          ) : (
            <>
              <h2 dir="auto">{name}</h2>
              <div className="end-screen__buttons">
                <button type="button" className="btn btn--play" onClick={() => seekTo(0)}>
                  <PlayIcon size={22} /> Watch Again
                </button>
                <button type="button" className="btn btn--info" onClick={back}>
                  Back to Browse
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="player__bottom" onPointerUp={(e) => e.stopPropagation()}>
        <div className="player__timeline">
          <ProgressBar time={time} duration={duration} buffered={buffered} onSeek={seekTo} onScrub={setScrubbing} />
          <span className="player__remaining" aria-label="Time remaining">
            {clock(Math.max(0, remaining))}
          </span>
        </div>
        <div className="player__bar">
          <div className="player__group">
            <button type="button" className="icon-btn player__btn" aria-label={playing ? 'Pause (space)' : 'Play (space)'} onClick={togglePlay}>
              {playing ? <PauseIcon size={34} /> : <PlayIcon size={34} />}
            </button>
            <button type="button" className="icon-btn player__btn" aria-label="Back 10 seconds" onClick={() => seekBy(-SEEK_STEP)}>
              <Back10Icon size={34} />
            </button>
            <button type="button" className="icon-btn player__btn" aria-label="Forward 10 seconds" onClick={() => seekBy(SEEK_STEP)}>
              <Forward10Icon size={34} />
            </button>
            <div className="player__pop" onMouseEnter={() => setPanel('volume')} onMouseLeave={() => setPanel((p) => (p === 'volume' ? null : p))}>
              {panel === 'volume' && <VolumePanel volume={settings.volume} muted={settings.muted} onVolume={setVolume} />}
              <button type="button" className="icon-btn player__btn" aria-label={settings.muted ? 'Unmute (m)' : 'Mute (m)'} onClick={toggleMute}>
                <VolumeIcon size={34} level={volumeLevel} />
              </button>
            </div>
          </div>

          <div className="player__title" dir="auto">
            <strong>{name}</strong>
            {episodeName && <span className="player__ep">{episodeName}</span>}
            {episodeTitle && <span className="player__eptitle">{episodeTitle}</span>}
          </div>

          <div className="player__group">
            {next && (
              <button type="button" className="icon-btn player__btn" aria-label="Next episode" onClick={goNext}>
                <NextEpisodeIcon size={32} />
              </button>
            )}
            {episodes.length > 1 && (
              <div className="player__pop">
                {panel === 'episodes' && <EpisodesPanel episodes={episodes} currentId={id} onPlay={playEpisode} />}
                <button
                  type="button"
                  className="icon-btn player__btn"
                  aria-label="Episodes"
                  aria-expanded={panel === 'episodes'}
                  onClick={() => setPanel((p) => (p === 'episodes' ? null : 'episodes'))}
                >
                  <EpisodesIcon size={32} />
                </button>
              </div>
            )}
            <button
              type="button"
              className={`icon-btn player__btn${settings.familySkips ? ' is-on' : ''}`}
              aria-label={kidsProfile ? 'Family mode (always on for Kids)' : settings.familySkips ? 'Family mode: on' : 'Family mode: off'}
              aria-pressed={settings.familySkips}
              onClick={toggleFamily}
            >
              <FlagIcon size={30} />
            </button>
            <div className="player__pop">
              {panel === 'subs' && data && (
                <AudioSubsPanel
                  subtitles={data.subtitles}
                  lang={settings.subtitleLang}
                  onLang={(l: SubtitleLang) => update((s) => updateSettings(s, { subtitleLang: l }))}
                  files={files}
                  quality={quality}
                  onQuality={changeQuality}
                  auto={settings.qualityAuto}
                  onAuto={chooseAuto}
                  offset={settings.subtitleOffset}
                  onOffset={(o) => update((s) => updateSettings(s, { subtitleOffset: o }))}
                  failed={subs.failed}
                />
              )}
              <button
                type="button"
                className="icon-btn player__btn"
                aria-label="Audio, subtitles and quality"
                aria-expanded={panel === 'subs'}
                onClick={() => setPanel((p) => (p === 'subs' ? null : 'subs'))}
              >
                <SubtitlesIcon size={32} />
              </button>
            </div>
            <div className="player__pop">
              {panel === 'speed' && (
                <SpeedPanel
                  speed={speed}
                  onSpeed={(s) => {
                    setSpeed(s);
                    setPanel(null);
                  }}
                />
              )}
              <button
                type="button"
                className="icon-btn player__btn"
                aria-label="Playback speed"
                aria-expanded={panel === 'speed'}
                onClick={() => setPanel((p) => (p === 'speed' ? null : 'speed'))}
              >
                <SpeedIcon size={32} />
              </button>
            </div>
            <button type="button" className="icon-btn player__btn" aria-label={fullscreen ? 'Exit full screen (f)' : 'Full screen (f)'} onClick={() => void toggleFullscreen()}>
              {fullscreen ? <ExitFullscreenIcon size={32} /> : <FullscreenIcon size={32} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
