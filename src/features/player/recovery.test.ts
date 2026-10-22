import { describe, expect, it } from 'vitest';
import { RECOVERY, createLogGate, errorKind, newLadder, nextStep, noteGoodPlay, noteTrouble, shouldHandleError, type Ladder, type Step } from './recovery';

const run = (kind: 'network' | 'decode' | 'unsupported', parallel: boolean, canLower: boolean, max = 20) => {
  let l: Ladder = newLadder();
  const steps: Step['action'][] = [];
  for (let i = 0; i < max; i++) {
    const r = nextStep(l, { kind, parallel, canLower });
    steps.push(r.step.action);
    l = r.ladder;
    if (r.step.action === 'fail') break;
  }
  return steps;
};

describe('recovery ladder', () => {
  it('PLAYER-018: maps MediaError codes', () => {
    expect([1, 2, 3, 4, 0, undefined].map(errorKind)).toEqual(['aborted', 'network', 'decode', 'unsupported', 'unknown', 'unknown']);
  });

  it('PLAYER-018: a network error re-seats twice (1 s, 3 s), then the plain path, then a lower quality, then fails', () => {
    expect(run('network', true, true)).toEqual(['reseat', 'reseat', 'plain', 'lower', 'lower', 'fail']);
    const a = nextStep(newLadder(), { kind: 'network', parallel: true, canLower: true });
    expect(a.step).toEqual({ action: 'reseat', delayMs: 1000 });
    expect(nextStep(a.ladder, { kind: 'network', parallel: true, canLower: true }).step).toEqual({ action: 'reseat', delayMs: 3000 });
  });

  it('PLAYER-018: skips rungs that do not apply and always ends', () => {
    expect(run('network', false, false)).toEqual(['reseat', 'reseat', 'fail']);
    expect(run('network', false, true)).toEqual(['reseat', 'reseat', 'lower', 'lower', 'fail']);
    expect(run('decode', true, true)).toEqual(['reseat', 'lower', 'lower', 'fail']);
    expect(run('unsupported', true, false)).toEqual(['plain', 'fail']);
    expect(run('unsupported', false, true)).toEqual(['lower', 'lower', 'fail']);
  });

  it('PLAYER-018: the counters start over after 20 s of good playback, not before', () => {
    let l = nextStep(nextStep(newLadder(), { kind: 'network', parallel: false, canLower: false }).ladder, { kind: 'network', parallel: false, canLower: false }).ladder;
    expect(l.reseats).toBe(2);
    l = noteGoodPlay(l, 1000);
    l = noteGoodPlay(l, 1000 + RECOVERY.GOOD_PLAY_MS - 1);
    expect(l.reseats).toBe(2);
    l = noteTrouble(l);
    l = noteGoodPlay(l, 30_000);
    l = noteGoodPlay(l, 30_000 + RECOVERY.GOOD_PLAY_MS - 1);
    expect(l.reseats).toBe(2); // the trouble restarted the clock
    l = noteGoodPlay(l, 30_000 + RECOVERY.GOOD_PLAY_MS);
    expect(l).toMatchObject({ reseats: 0, plainTried: false, lowers: 0 });
  });
});

describe('error filtering', () => {
  it('PLAYER-020: ignores errors from the standby element and from an older source', () => {
    const src = 'https://x/a.mp4';
    expect(shouldHandleError({ fromActive: true, errorSrc: src, expectedSrc: src })).toBe(true);
    expect(shouldHandleError({ fromActive: false, errorSrc: src, expectedSrc: src })).toBe(false);
    expect(shouldHandleError({ fromActive: true, errorSrc: 'https://x/old.mp4', expectedSrc: src })).toBe(false);
    expect(shouldHandleError({ fromActive: true, errorSrc: src, expectedSrc: null })).toBe(false);
    expect(shouldHandleError({ fromActive: true, errorSrc: src, expectedSrc: `${src}#wmp-plain` })).toBe(true);
  });

  it('PLAYER-020: repeated identical errors are logged once per 10 seconds', () => {
    const gate = createLogGate();
    expect(gate('network', 0)).toBe(true);
    expect(gate('network', 5000)).toBe(false);
    expect(gate('decode', 5000)).toBe(true);
    expect(gate('network', 10_000)).toBe(true);
  });
});
