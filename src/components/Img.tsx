import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { getIsp, rehostImage } from '../api/endpoints';
import { useInView } from '../hooks/useInView';
import { useIsp } from '../hooks/useIsp';
import { IMAGE_SLOTS, slotQueue } from '../lib/imageVariant';

/** Lazy images wait here for a download slot, in the order they came into view. */
const slots = slotQueue(() => IMAGE_SLOTS[getIsp()]);

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError' | 'onLoad'> & {
  src: string | null | undefined;
  /** Tried once when `src` can't be loaded (a poster's other size, say). */
  fallback?: string | null;
  eager?: boolean;
  /** `fetchpriority="high"`: only for the first billboard image. */
  priority?: boolean;
  /** Called once when no file can be loaded. */
  onFail?: () => void;
};

/** Lazy image that fades in, tries its fallback, and hides itself when nothing loads (the box keeps its size). */
export function Img({ src, fallback, className = '', eager = false, priority = false, alt = '', onFail, ...rest }: Props) {
  type State = { src: string | null | undefined; second: boolean; loaded: boolean; failed: boolean };
  const [state, setState] = useState<State>({ src, second: false, loaded: false, failed: false });
  const current: State = state.src === src ? state : { src, second: false, loaded: false, failed: false };
  if (current !== state) setState(current);
  const isp = useIsp();
  const raw = current.second ? fallback : src;
  const url = raw ? rehostImage(raw, isp) : raw;
  const ref = useRef<HTMLImageElement>(null);
  const inView = useInView(ref, '200px');
  const [granted, setGranted] = useState<string | null>(null);
  const release = useRef<(() => void) | null>(null);
  const waiting = !!url && !eager && !current.failed;
  useEffect(() => {
    if (!waiting || !inView || !url) return;
    const free = slots.acquire(() => setGranted(url));
    release.current = free;
    return () => {
      free();
      release.current = null;
    };
  }, [waiting, inView, url]);
  if (!url || current.failed) return null;
  const allowed = eager || granted === url;
  const done = () => release.current?.();
  return (
    <img
      {...rest}
      {...(priority ? ({ fetchpriority: 'high' } as object) : {})}
      ref={ref}
      src={allowed ? url : undefined}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      className={`img ${current.loaded ? 'img--loaded' : ''} ${className}`}
      onLoad={() => {
        done();
        setState({ ...current, loaded: true });
      }}
      onError={() => {
        done();
        if (!current.second && fallback && fallback !== src) {
          setState({ ...current, second: true });
          return;
        }
        setState({ ...current, failed: true });
        onFail?.();
      }}
    />
  );
}
