/** The shared profile model. The TV app implements the same one in Java, so rows must stay compatible. */

export const MAIN_ID = 'main';
export const MAX_PROFILES = 6;
export const NAME_MAX = 20;
export const COLOR_COUNT = 8;
export const PIN_ITER = 20000;
export const AVATARS = ['fox', 'owl', 'bear', 'cat', 'dog', 'panda', 'lion', 'rocket', 'star', 'moon', 'sun', 'wave'] as const;
export type AvatarKey = (typeof AVATARS)[number];

export interface PinRecord {
  /** base64, 16 bytes */
  salt: string;
  iter: number;
  /** base64 of PBKDF2-HMAC-SHA256, 32 bytes */
  hash: string;
}

export interface Profile {
  id: string;
  name: string;
  color: number;
  avatar: AvatarKey;
  kids: boolean;
  pin: PinRecord | null;
  order: number;
  /** epoch ms */
  created: number;
}

/** A deleted profile stays in the synced list so other devices drop it too. */
export interface Tombstone {
  id: string;
  deleted: true;
}

export type StoredProfile = Profile | Tombstone;

export const isTombstone = (p: StoredProfile): p is Tombstone => (p as Tombstone).deleted === true;
export const isAvatar = (v: unknown): v is AvatarKey => (AVATARS as readonly unknown[]).includes(v);
