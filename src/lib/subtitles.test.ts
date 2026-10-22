import { describe, expect, it } from 'vitest';
import { activeCues, cleanCueText, cuesToVtt, decodeSubtitle, parseSrt, srtToVtt } from './subtitles';

const SRT = `1
00:00:01,000 --> 00:00:03,500
<i>Hello</i> there

2
00:00:04,250 --> 00:00:06,000
{\\an8}<font color="#ffff00">General</font> Kenobi
-->

`;

describe('subtitles', () => {
  it('PLAYER-004: decodes UTF-8 subtitles as UTF-8', () => {
    const bytes = new TextEncoder().encode('﻿1\n00:00:01,000 --> 00:00:02,000\nمرحبا\n');
    expect(decodeSubtitle(bytes)).toBe('1\n00:00:01,000 --> 00:00:02,000\nمرحبا\n');
  });

  it('PLAYER-004: falls back to windows-1256 when UTF-8 yields replacement characters', () => {
    // "مرحبا" in Windows-1256: م E3, ر D1, ح CD, ب C8, ا C7
    const header = Array.from(new TextEncoder().encode('1\r\n00:00:01,000 --> 00:00:02,000\r\n'));
    const bytes = new Uint8Array([...header, 0xe3, 0xd1, 0xcd, 0xc8, 0xc7, 0x0d, 0x0a]);
    const text = decodeSubtitle(bytes.buffer);
    expect(text).toContain('مرحبا');
    expect(srtToVtt(text)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nمرحبا\n');
  });

  it('PLAYER-005: converts SRT to WebVTT, stripping <i>, <font> and {\\an8} tags', () => {
    expect(srtToVtt(SRT)).toBe(
      'WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello there\n\n00:00:04.250 --> 00:00:06.000\nGeneral Kenobi\n→\n',
    );
    expect(cleanCueText('{\\an8}<b>Hi</b>\n  <u>you</u>  ')).toBe('Hi\nyou');
    expect(parseSrt('garbage\n\n')).toEqual([]);
    expect(parseSrt('1\n0:01:02.5 --> 0:01:03,25\nShort stamps')[0]).toEqual({ start: 62.5, end: 63.25, text: 'Short stamps' });
  });

  it('PLAYER-006: shifts cues by the timing offset and finds the active ones', () => {
    const cues = parseSrt(SRT);
    expect(cuesToVtt(cues, 1.5)).toContain('00:00:02.500 --> 00:00:05.000');
    expect(cuesToVtt(cues, -10)).toBe('WEBVTT\n');
    expect(activeCues(cues, 2).map((c) => c.text)).toEqual(['Hello there']);
    expect(activeCues(cues, 2, 1.5)).toHaveLength(0);
    expect(activeCues(cues, 3.9)).toHaveLength(0);
  });
});
