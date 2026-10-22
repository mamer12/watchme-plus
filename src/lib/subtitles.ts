/** SRT decoding (UTF-8 or Windows-1256) and SRT → WebVTT conversion. Pure. */

export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** UTF-8 first; if that produces replacement characters the file is Windows-1256 (old Arabic subtitles). */
export function decodeSubtitle(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = new TextDecoder('utf-8').decode(data);
  if (text.includes('�')) {
    try {
      text = new TextDecoder('windows-1256').decode(data);
    } catch {
      /* decoder not available: keep the UTF-8 attempt */
    }
  }
  return text.replace(/^﻿/, '');
}

const TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,:](\d{1,3}))?/;
const ARROW = new RegExp(`${TIME.source}\\s*-->\\s*${TIME.source}`);

function seconds(h: string | undefined, m: string | undefined, s: string | undefined, ms: string | undefined): number {
  const frac = ms ? Number(ms.padEnd(3, '0')) / 1000 : 0;
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0) + frac;
}

/** Strips styling tags SRT files carry: <i>, <b>, <u>, <font>, and ASS overrides like {\an8}. */
export function cleanCueText(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<\/?(?:i|b|u|font|s)(?:\s[^>]*)?>/gi, '')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

export function parseSrt(text: string): Cue[] {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const idx = lines.findIndex((l) => ARROW.test(l));
    if (idx < 0) continue;
    const m = ARROW.exec(lines[idx] ?? '');
    if (!m) continue;
    const start = seconds(m[1], m[2], m[3], m[4]);
    const end = seconds(m[5], m[6], m[7], m[8]);
    const body = cleanCueText(lines.slice(idx + 1).join('\n'));
    if (body && end > start) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function vttTime(t: number): string {
  const total = Math.max(0, Math.round(t * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}

/** WebVTT text; `offset` (seconds) shifts every cue, e.g. +0.5 shows subtitles later. */
export function cuesToVtt(cues: Cue[], offset = 0): string {
  const out = ['WEBVTT', ''];
  for (const c of cues) {
    const start = c.start + offset;
    const end = c.end + offset;
    if (end <= 0) continue;
    // "-->" inside text would end the cue timing line in VTT.
    out.push(`${vttTime(start)} --> ${vttTime(end)}`, c.text.replace(/-->/g, '→'), '');
  }
  return out.join('\n');
}

export function srtToVtt(text: string, offset = 0): string {
  return cuesToVtt(parseSrt(text), offset);
}

/** Cues active at time `t` (for the custom subtitle renderer). */
export function activeCues(cues: Cue[], t: number, offset = 0): Cue[] {
  return cues.filter((c) => t >= c.start + offset && t < c.end + offset);
}
