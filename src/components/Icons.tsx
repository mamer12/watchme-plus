/** Inline SVG icons (24×24, currentColor). */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const PlayIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 4.2v15.6a1 1 0 0 0 1.5.86l13-7.8a1 1 0 0 0 0-1.72l-13-7.8A1 1 0 0 0 6 4.2Z" />
  </Svg>
);
export const PauseIcon = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="3.5" width="5" height="17" rx="1" />
    <rect x="14" y="3.5" width="5" height="17" rx="1" />
  </Svg>
);
export const InfoIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.5" {...stroke} />
    <path d="M12 11v6M12 7.5v.01" {...stroke} strokeWidth={2.4} />
  </Svg>
);
export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v16M4 12h16" {...stroke} />
  </Svg>
);
export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="m4.5 12.5 5 5 10-11" {...stroke} />
  </Svg>
);
export const ThumbUpIcon = (p: P) => (
  <Svg {...p}>
    <path d="M7 10v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3Zm0 0 4-7a2.5 2.5 0 0 1 2.6 3l-.6 3h5.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.2 20H7" {...stroke} />
  </Svg>
);
export const ThumbDownIcon = (p: P) => (
  <Svg {...p} style={{ transform: 'rotate(180deg)', ...p.style }}>
    <path d="M7 10v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3Zm0 0 4-7a2.5 2.5 0 0 1 2.6 3l-.6 3h5.5a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.2 20H7" {...stroke} />
  </Svg>
);
export const DoubleThumbIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 11v9H2.8a.8.8 0 0 1-.8-.8v-7.4a.8.8 0 0 1 .8-.8H5Zm0 0 3.4-6a2 2 0 0 1 2.1 2.5l-.5 2.5h4.4a1.7 1.7 0 0 1 1.7 2l-1.2 6A1.7 1.7 0 0 1 13.2 20H5" {...stroke} strokeWidth={1.7} />
    <path d="M13.5 4.5 15 2a1.8 1.8 0 0 1 2 2.2l-.4 2.3h4a1.6 1.6 0 0 1 1.6 1.9l-1.1 5.5A1.6 1.6 0 0 1 19.5 15H18" {...stroke} strokeWidth={1.7} />
  </Svg>
);
export const ChevronDownIcon = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" {...stroke} />
  </Svg>
);
export const ChevronLeftIcon = (p: P) => (
  <Svg {...p}>
    <path d="m15 5-7 7 7 7" {...stroke} strokeWidth={2.5} />
  </Svg>
);
export const ChevronRightIcon = (p: P) => (
  <Svg {...p}>
    <path d="m9 5 7 7-7 7" {...stroke} strokeWidth={2.5} />
  </Svg>
);
export const ArrowLeftIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 12H4m0 0 7-7m-7 7 7 7" {...stroke} />
  </Svg>
);
export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" {...stroke} />
  </Svg>
);
export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" {...stroke} />
    <path d="m15.5 15.5 5 5" {...stroke} />
  </Svg>
);
/** Four-point sparkle with a red-to-pink gradient: the AI entry in the header. */
export const SparkIcon = (p: P) => (
  <Svg {...p}>
    <defs>
      <linearGradient id="spark-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#ff4d5a" />
        <stop offset="1" stopColor="#ff6ec7" />
      </linearGradient>
    </defs>
    <path d="M10.5 3c.6 4.6 2.4 6.9 7 7.5-4.6.6-6.4 2.9-7 7.5-.6-4.6-2.4-6.9-7-7.5 4.6-.6 6.4-2.9 7-7.5Z" fill="url(#spark-grad)" stroke="url(#spark-grad)" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M18.5 15.5c.3 2 1 2.9 3 3.2-2 .3-2.7 1.2-3 3.2-.3-2-1-2.9-3-3.2 2-.3 2.7-1.2 3-3.2Z" fill="url(#spark-grad)" />
  </Svg>
);
export const HomeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" {...stroke} />
  </Svg>
);
export const FlameIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 21c4 0 7-2.7 7-6.6 0-3.1-1.8-5.2-3.4-6.9-.5 1.6-1.3 2.6-2.4 3.1C13.6 6.7 11.6 4.4 9 3c.4 3-1.1 4.9-2.6 6.6C5.3 10.9 5 12.4 5 14.4 5 18.3 8 21 12 21Z" {...stroke} />
  </Svg>
);
export const ListIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h10M18 15v6M15 18h6" {...stroke} />
  </Svg>
);
export const GearIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" {...stroke} />
    <path
      d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.4-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
      {...stroke}
      strokeWidth={1.6}
    />
  </Svg>
);
export const Back10Icon = (p: P) => (
  <Svg {...p}>
    <path d="M5.2 8.6A8 8 0 1 1 4 12" {...stroke} />
    <path d="M4.4 3.6v5.4h5.4" {...stroke} />
    <text x="12.6" y="15.6" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="Inter, system-ui, sans-serif">
      10
    </text>
  </Svg>
);
export const Forward10Icon = (p: P) => (
  <Svg {...p}>
    <path d="M18.8 8.6A8 8 0 1 0 20 12" {...stroke} />
    <path d="M19.6 3.6v5.4h-5.4" {...stroke} />
    <text x="11.4" y="15.6" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="Inter, system-ui, sans-serif">
      10
    </text>
  </Svg>
);
export const VolumeIcon = (p: P & { level?: number }) => {
  const { level = 1, ...rest } = p;
  return (
    <Svg {...rest}>
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" />
      {level > 0 && <path d="M15.5 9a4 4 0 0 1 0 6" {...stroke} />}
      {level > 0.5 && <path d="M18 6.5a7.5 7.5 0 0 1 0 11" {...stroke} />}
      {level === 0 && <path d="m16 9.5 5 5m0-5-5 5" {...stroke} />}
    </Svg>
  );
};
export const FullscreenIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" {...stroke} />
  </Svg>
);
export const ExitFullscreenIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" {...stroke} />
  </Svg>
);
export const SubtitlesIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2" {...stroke} />
    <path d="M6.5 13h4M13 13h4.5M6.5 16h7M15.5 16h2" {...stroke} />
  </Svg>
);
export const EpisodesIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="8" width="15" height="12" rx="1.5" {...stroke} />
    <path d="M6 5h14.5v11" {...stroke} />
  </Svg>
);
export const NextEpisodeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 4.8v14.4a.8.8 0 0 0 1.2.7l11-7.2a.8.8 0 0 0 0-1.4l-11-7.2a.8.8 0 0 0-1.2.7Z" />
    <rect x="18" y="4" width="2.5" height="16" rx=".8" />
  </Svg>
);
export const SpeedIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4.3 17A9 9 0 1 1 19.7 17" {...stroke} />
    <path d="m12 13 4-5" {...stroke} />
    <circle cx="12" cy="13.5" r="1.5" />
  </Svg>
);
export const FlagIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 21V4m0 0h11l-2 4 2 4H5" {...stroke} />
  </Svg>
);
export const WifiOffIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2 8.5a15 15 0 0 1 5-2.9M22 8.5a15 15 0 0 0-11-3.4M5 12a10 10 0 0 1 4-2.2M19 12a10 10 0 0 0-2.4-1.6M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18" {...stroke} />
  </Svg>
);
