import { fetchClientConfig } from './client-config.js';

const DEFAULT_LIMIT_MINUTES = 120;

function validLimit(minutes: number): number {
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 120 ? minutes : DEFAULT_LIMIT_MINUTES;
}

/** Source display format: H:mm, counted down to the whole minute. */
export function formatSessionLeft(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** One in-memory display session. Delayed callbacks and backward clock changes cannot extend it. */
export class DisplaySession {
  private limitMinutes: number;
  private started: { wall: number; monotonic: number } | undefined;
  private elapsed = 0;

  constructor(private readonly options: {
    limitMinutes?: number;
    now?: () => number;
    monotonicNow?: () => number;
    onEnd: () => void;
  }) {
    this.limitMinutes = validLimit(options.limitMinutes ?? DEFAULT_LIMIT_MINUTES);
  }

  start(): void {
    if (this.started) return;
    this.elapsed = 0;
    this.started = { wall: this.now(), monotonic: this.monotonicNow() };
  }

  setLimit(minutes: number): void {
    this.limitMinutes = validLimit(minutes);
  }

  stop(): void {
    this.started = undefined;
  }

  /** Check synchronously before another consumer resumes background work. */
  check(): number | undefined {
    if (!this.started) return undefined;
    this.elapsed = Math.max(this.elapsed, this.now() - this.started.wall, this.monotonicNow() - this.started.monotonic);
    const remaining = Math.max(0, this.limitMinutes * 60_000 - this.elapsed);
    if (remaining === 0) {
      this.stop();
      this.options.onEnd();
      return undefined;
    }
    return remaining;
  }

  private now(): number { return this.options.now?.() ?? Date.now(); }
  private monotonicNow(): number { return this.options.monotonicNow?.() ?? performance.now(); }
}

/** Register before graph listeners so an expired foreground tab never resumes its polling. */
export function setupDisplaySession(): () => void {
  const sourceLine = document.querySelector('.footer-source');
  if (!sourceLine) throw new Error('The display requires its source footer.');
  const countdown = document.createElement('span');
  countdown.id = 'session-expires';
  countdown.className = 'session-expires';
  countdown.hidden = true;
  sourceLine.append(countdown);

  let interval: ReturnType<typeof setInterval> | undefined;
  let destroyed = false;
  const session = new DisplaySession({
    onEnd: () => window.dispatchEvent(new Event('tidepin:session-ended')),
  });
  function render(): void {
    const remaining = session.check();
    countdown.hidden = remaining === undefined;
    countdown.textContent = remaining === undefined ? '' : ` · Session expires: ${formatSessionLeft(remaining)}`;
  }
  function start(): void {
    session.start();
    interval ??= setInterval(render, 1000);
    render();
  }
  function stop(): void {
    session.stop();
    clearInterval(interval);
    interval = undefined;
    render();
  }
  function checkVisibility(): void {
    if (!document.hidden) render();
  }
  window.addEventListener('tidepin:display-start', start);
  window.addEventListener('tidepin:session-ended', stop);
  // Capture runs before graph visibility handlers, even if they were registered earlier.
  document.addEventListener('visibilitychange', checkVisibility, { capture: true });
  window.addEventListener('pageshow', render, { capture: true });
  window.addEventListener('focus', render, { capture: true });

  // The bounded default is active immediately, including while configuration is loading or unavailable.
  void fetchClientConfig((input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }))
    .then((config) => {
      if (destroyed) return;
      session.setLimit(config.sessionLimitMinutes);
      render();
    })
    .catch(() => { /* Keep the bounded 120-minute fallback; never leave a session unlimited. */ });

  return () => {
    destroyed = true;
    stop();
    window.removeEventListener('tidepin:display-start', start);
    window.removeEventListener('tidepin:session-ended', stop);
    document.removeEventListener('visibilitychange', checkVisibility, { capture: true });
    window.removeEventListener('pageshow', render, { capture: true });
    window.removeEventListener('focus', render, { capture: true });
    countdown.remove();
  };
}
