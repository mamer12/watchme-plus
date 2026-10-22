/** The profile list as one settings row: which remote copy (if any) replaces the local list. Pure. */
import { sanitizeList } from '../profiles/logic';
import { isTombstone, type StoredProfile } from '../profiles/types';
import { rowTs } from './merge';
import { PROFILES_ROW_KEY } from './keys';
import type { RemoteRow } from './types';

export interface ProfilesPick {
  list: StoredProfile[];
  /** When the person made that change (ms). */
  at: number;
  /** The queued local change this one replaces: it lost. */
  supersedes: boolean;
}

/** `rows` are settings rows, oldest first. The newest valid 'profiles' row wins unless this device has a newer change queued. */
export function pickProfilesRow(rows: RemoteRow[], ctx: { selfUid: string | null; pendingTs: number | undefined }): ProfilesPick | null {
  let pick: ProfilesPick | null = null;
  for (const r of rows) {
    if (r.key !== PROFILES_ROW_KEY || r.deleted) continue;
    if (ctx.selfUid && r.updated_by === ctx.selfUid) continue;
    const at = rowTs(r);
    if (ctx.pendingTs !== undefined && ctx.pendingTs > at) continue;
    const list = sanitizeList(r.value);
    if (!list.some((p) => !isTombstone(p))) continue; // never leave a person with no profile
    pick = { list, at, supersedes: ctx.pendingTs !== undefined };
  }
  return pick;
}
