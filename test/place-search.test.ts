import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaceSearch, type Suggestion } from '../src/client/place-search.js';

describe('private in-memory Places search', () => {
  afterEach(() => vi.useRealTimers());
  function harness() {
    vi.useFakeTimers();
    const backend = { createSessionToken: vi.fn(() => ({})), suggest: vi.fn<(input: string, token: object) => Promise<Suggestion[]>>(async () => [{ main: 'Place', secondary: 'Region' }]), locate: vi.fn<(suggestion: Suggestion) => Promise<{ latitude: number; longitude: number }>>(async () => ({ latitude: 40, longitude: -74 })) };
    const options = { onSuggestions: vi.fn(), onError: vi.fn() };
    return { backend, options, search: new PlaceSearch(backend, options) };
  }
  it('debounces input, rejects short queries and uses one billing token until selection', async () => {
    const { search, backend } = harness();
    search.input('ab'); await vi.advanceTimersByTimeAsync(500); expect(backend.suggest).not.toHaveBeenCalled();
    search.input('abcd'); search.input('abcde'); await vi.advanceTimersByTimeAsync(400);
    search.input('abcdef'); await vi.advanceTimersByTimeAsync(400);
    expect(backend.suggest).toHaveBeenCalledTimes(2);
    expect(backend.createSessionToken).toHaveBeenCalledTimes(1);
    expect(backend.suggest.mock.calls[0]![1]).toBe(backend.suggest.mock.calls[1]![1]);
    expect(await search.choose({ main: 'Place', secondary: '' })).toEqual({ latitude: 40, longitude: -74 });
    search.input('another'); await vi.advanceTimersByTimeAsync(400); expect(backend.createSessionToken).toHaveBeenCalledTimes(2);
  });
  it('does not render stale suggestions after newer input or cancellation', async () => {
    const { search, backend, options } = harness();
    let finish: ((value: Suggestion[]) => void) | undefined;
    backend.suggest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    search.input('older'); await vi.advanceTimersByTimeAsync(400);
    search.input(''); finish?.([{ main: 'Old', secondary: '' }]); await Promise.resolve();
    expect(options.onSuggestions).not.toHaveBeenCalledWith([{ main: 'Old', secondary: '' }]);
    search.input('pending'); search.cancelPending(); await vi.advanceTimersByTimeAsync(500); expect(backend.suggest).toHaveBeenCalledTimes(1);
  });
  it('drops stale place details and reports search failures without exposing query text', async () => {
    const { search, backend, options } = harness();
    let finish: ((value: { latitude: number; longitude: number }) => void) | undefined;
    backend.locate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const chosen = search.choose({ main: 'Old place', secondary: '' });
    search.input('newer search'); finish?.({ latitude: 1, longitude: 2 }); expect(await chosen).toBeUndefined();
    backend.suggest.mockRejectedValue(new Error('contains private query'));
    await vi.advanceTimersByTimeAsync(400);
    expect(options.onError).toHaveBeenCalledWith();
  });
});
