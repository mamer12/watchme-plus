/** Round profile avatars: simple original drawings on a coloured disc. */
import type { ReactNode } from 'react';
import type { AvatarKey } from './types';

/** Disc colours, index = Profile.color (0-7). */
export const PROFILE_COLORS = ['#e11d48', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'] as const;
export const COLOR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Purple', 'Pink'] as const;

const W = '#ffffff';
const D = '#1b1b1f';

const GLYPHS: Record<AvatarKey, ReactNode> = {
  fox: (
    <>
      <path d="M10 12 26 25 11 33Z M54 12 38 25 53 33Z" fill={W} />
      <path d="M10 30Q32 14 54 30L32 56Z" fill={W} />
      <circle cx="24" cy="36" r="2.6" fill={D} />
      <circle cx="40" cy="36" r="2.6" fill={D} />
      <circle cx="32" cy="50" r="2.6" fill={D} />
    </>
  ),
  owl: (
    <>
      <path d="M14 12 24 20H14Z M50 12 40 20H50Z" fill={W} />
      <ellipse cx="32" cy="36" rx="19" ry="21" fill={W} />
      <circle cx="24" cy="31" r="8" fill="none" stroke={D} strokeWidth="3" />
      <circle cx="40" cy="31" r="8" fill="none" stroke={D} strokeWidth="3" />
      <circle cx="24" cy="31" r="3" fill={D} />
      <circle cx="40" cy="31" r="3" fill={D} />
      <path d="M28 41h8l-4 8Z" fill={D} />
    </>
  ),
  bear: (
    <>
      <circle cx="16" cy="18" r="7" fill={W} />
      <circle cx="48" cy="18" r="7" fill={W} />
      <circle cx="32" cy="34" r="20" fill={W} />
      <ellipse cx="32" cy="42" rx="9" ry="7" fill={D} opacity=".18" />
      <circle cx="24" cy="30" r="2.6" fill={D} />
      <circle cx="40" cy="30" r="2.6" fill={D} />
      <ellipse cx="32" cy="39" rx="3.4" ry="2.6" fill={D} />
    </>
  ),
  cat: (
    <>
      <path d="M12 10 26 20 12 32Z M52 10 38 20 52 32Z" fill={W} />
      <ellipse cx="32" cy="36" rx="21" ry="18" fill={W} />
      <ellipse cx="24" cy="33" rx="2.6" ry="3.6" fill={D} />
      <ellipse cx="40" cy="33" rx="2.6" ry="3.6" fill={D} />
      <path d="M29.5 41h5L32 44Z" fill={D} />
      <path d="M6 38l12 2M6 46l12-3M58 38 46 40M58 46l-12-3" stroke={D} strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  dog: (
    <>
      <ellipse cx="14" cy="30" rx="8" ry="15" fill={D} opacity=".35" transform="rotate(12 14 30)" />
      <ellipse cx="50" cy="30" rx="8" ry="15" fill={D} opacity=".35" transform="rotate(-12 50 30)" />
      <ellipse cx="32" cy="34" rx="18" ry="21" fill={W} />
      <circle cx="25" cy="30" r="2.6" fill={D} />
      <circle cx="39" cy="30" r="2.6" fill={D} />
      <ellipse cx="32" cy="44" rx="8" ry="6" fill={D} opacity=".14" />
      <ellipse cx="32" cy="41" rx="4" ry="3" fill={D} />
    </>
  ),
  panda: (
    <>
      <circle cx="15" cy="17" r="7.5" fill={D} />
      <circle cx="49" cy="17" r="7.5" fill={D} />
      <circle cx="32" cy="34" r="21" fill={W} />
      <ellipse cx="23" cy="31" rx="5" ry="7" fill={D} transform="rotate(20 23 31)" />
      <ellipse cx="41" cy="31" rx="5" ry="7" fill={D} transform="rotate(-20 41 31)" />
      <circle cx="23.5" cy="31" r="1.6" fill={W} />
      <circle cx="40.5" cy="31" r="1.6" fill={W} />
      <ellipse cx="32" cy="42" rx="3.4" ry="2.6" fill={D} />
    </>
  ),
  lion: (
    <>
      <circle cx="32" cy="33" r="26" fill={W} opacity=".55" />
      <circle cx="32" cy="34" r="17" fill={W} />
      <circle cx="26" cy="31" r="2.4" fill={D} />
      <circle cx="38" cy="31" r="2.4" fill={D} />
      <path d="M29 38h6l-3 4Z" fill={D} />
      <path d="M32 42v3M28 46q4 3 8 0" stroke={D} strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </>
  ),
  rocket: (
    <>
      <path d="M32 6c9 8 11 20 9 33H23C21 26 23 14 32 6Z" fill={W} />
      <circle cx="32" cy="24" r="5" fill={D} opacity=".75" />
      <path d="M23 30 13 42l10-2Z M41 30l10 12-10-2Z" fill={W} />
      <path d="M27 42h10l-5 14Z" fill={W} opacity=".7" />
    </>
  ),
  star: <path d="m32 7 7.4 16 17.2 2-12.8 11.8 3.5 17.2L32 44.6 16.7 54l3.5-17.2L7.4 25l17.2-2Z" fill={W} />,
  moon: <path d="M42 8A25 25 0 1 0 56 40 20 20 0 0 1 42 8Z" fill={W} />,
  sun: (
    <>
      <circle cx="32" cy="32" r="12" fill={W} />
      <path d="M32 6v9M32 49v9M6 32h9M49 32h9M13.6 13.6l6.4 6.4M44 44l6.4 6.4M13.6 50.4 20 44M44 20l6.4-6.4" stroke={W} strokeWidth="4" strokeLinecap="round" />
    </>
  ),
  wave: (
    <>
      <path d="M6 28q9-10 13 0t13 0 13 0 13 0" stroke={W} strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M6 42q9-10 13 0t13 0 13 0 13 0" stroke={W} strokeWidth="5" fill="none" strokeLinecap="round" opacity=".7" />
    </>
  ),
};

export function Avatar({ avatar, color, size = 64, className = '' }: { avatar: AvatarKey; color: number; size?: number; className?: string }) {
  return (
    <svg className={`avatar ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="32" fill={PROFILE_COLORS[color % PROFILE_COLORS.length]} />
      {GLYPHS[avatar]}
    </svg>
  );
}
