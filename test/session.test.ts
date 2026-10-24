import { describe, expect, it } from 'vitest';
import { DisplaySession, formatSessionLeft } from '../src/client/session.js';

function fixture(limitMinutes = 120) {
  let wall = 1_000_000;
  let monotonic = 0;
  let ended = 0;
  const session = new DisplaySession({ limitMinutes, now: () => wall, monotonicNow: () => monotonic, onEnd: () => { ended++; } });
  return { session, advance: (ms: number) => { wall += ms; monotonic += ms; }, wall: (ms: number) => { wall += ms; }, monotonic: (ms: number) => { monotonic += ms; }, ended: () => ended };
}

describe('demo session', () => {
  it('starts only with the display and expires exactly once at the configured limit', () => {
    const f = fixture(1);
    expect(f.session.check()).toBeUndefined();
    f.session.start();
    expect(f.session.check()).toBe(60_000);
    f.advance(59_999);
    expect(f.session.check()).toBe(1);
    f.advance(1);
    expect(f.session.check()).toBeUndefined();
    expect(f.ended()).toBe(1);
    f.session.check();
    expect(f.ended()).toBe(1);
  });

  it('does not extend an active session on duplicate starts; an explicit restart gets a new limit', () => {
    const f = fixture(1);
    f.session.start();
    f.advance(50_000);
    f.session.start();
    expect(f.session.check()).toBe(10_000);
    f.advance(10_000);
    f.session.check();
    f.session.start();
    expect(f.session.check()).toBe(60_000);
  });

  it('expires immediately on a delayed background callback instead of counting timer ticks', () => {
    const f = fixture();
    f.session.start();
    f.advance(121 * 60_000);
    expect(f.session.check()).toBeUndefined();
    expect(f.ended()).toBe(1);
  });

  it('uses elapsed monotonic time if the wall clock moves backward', () => {
    const f = fixture(1);
    f.session.start();
    f.wall(-3_600_000);
    f.monotonic(60_000);
    f.session.check();
    expect(f.ended()).toBe(1);
  });

  it('handles sleep where only wall time advances, and never increases time left after clock correction', () => {
    const f = fixture(1);
    f.session.start();
    f.wall(50_000);
    expect(f.session.check()).toBe(10_000);
    f.wall(-40_000);
    expect(f.session.check()).toBe(10_000);
    f.wall(50_000);
    f.session.check();
    expect(f.ended()).toBe(1);
  });

  it('anchors late configuration to the original Start rather than the response time', () => {
    const f = fixture();
    f.session.start();
    f.advance(2 * 60_000);
    f.session.setLimit(1);
    f.session.check();
    expect(f.ended()).toBe(1);
  });

  it.each([0, -1, 121, 1.5, NaN, Infinity])('keeps invalid limit %s bounded to 120 minutes', (limit) => {
    const f = fixture(limit);
    f.session.start();
    expect(f.session.check()).toBe(120 * 60_000);
    f.session.setLimit(limit);
    expect(f.session.check()).toBe(120 * 60_000);
  });

  it('can stop without expiry or an end callback', () => {
    const f = fixture();
    f.session.start();
    f.session.stop();
    f.advance(121 * 60_000);
    expect(f.session.check()).toBeUndefined();
    expect(f.ended()).toBe(0);
  });
});

describe('source-style footer time left', () => {
  it.each([[7_200_000, '2:00'], [7_199_999, '1:59'], [300_000, '0:05'], [59_999, '0:00'], [0, '0:00'], [-1, '0:00']])('formats %i as %s', (ms, text) => {
    expect(formatSessionLeft(ms)).toBe(text);
  });
});
