/** All NOAA metadata and prediction traffic shares one process-wide transport. */
export interface NoaaDownload { response: Response; payload: unknown; jsonOk: boolean }
export interface NoaaScheduler { download(url: string | URL): Promise<NoaaDownload>; deferUntil(time: number): void }
export class NoaaBackoffError extends Error {
  constructor(readonly retryAt: number) { super('NOAA requests are temporarily paused.'); }
}

export function createNoaaScheduler(options: {
  fetch?: typeof fetch; now?: () => number; sleep?: (milliseconds: number) => Promise<void>;
} = {}): NoaaScheduler {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now() / 1000);
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = -Infinity;
  let retryAt = -Infinity;
  return {
    deferUntil(time) { if (Number.isFinite(time)) retryAt = Math.max(retryAt, time); },
    download(url) {
      const operation = queue.then(async () => {
        if (now() < retryAt) throw new NoaaBackoffError(retryAt);
        const delay = Math.max(0, lastStart + 1 - now());
        if (delay) await sleep(delay * 1000);
        // Recheck after yielding: backoff and pacing apply to every queued caller.
        if (now() < retryAt) throw new NoaaBackoffError(retryAt);
        lastStart = now();
        let response: Response;
        try { response = await fetcher(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } }); }
        catch (error) { retryAt = Math.max(retryAt, now() + 60); throw error; }
        if (!response.ok) {
          const header = response.headers.get('retry-after');
          const seconds = header ? Number(header) : NaN;
          const specified = header ? Number.isFinite(seconds) ? now() + Math.max(0, seconds) : Date.parse(header) / 1000 : NaN;
          retryAt = Math.max(now() + 60, Number.isFinite(specified) ? specified : -Infinity);
          await response.arrayBuffer();
          return { response, payload: null, jsonOk: true };
        }
        try {
          const payload: unknown = await response.json();
          if (!payload || typeof payload !== 'object' || Array.isArray(payload) || 'error' in payload) retryAt = Math.max(retryAt, now() + 60);
          return { response, payload, jsonOk: true };
        } catch { retryAt = Math.max(retryAt, now() + 60); return { response, payload: null, jsonOk: false }; }
      });
      queue = operation.catch(() => undefined);
      return operation;
    },
  };
}

export const sharedNoaaScheduler = createNoaaScheduler();
