import type { GraphState } from './graph-controller.js';

/** A retry cooldown disables activation but is not an in-flight operation. */
export function graphRefreshFeedback({ data, now, loading, error }: Pick<GraphState, 'data' | 'now' | 'loading' | 'error'>) {
  const products = data?.predictions;
  const retryAt = Math.max(products?.curve.error?.retryAt ?? 0, products?.events.error?.retryAt ?? 0);
  const waitSeconds = Math.max(0, Math.ceil(retryAt - now));
  const saved = Boolean(data) && (error !== null || products?.curve.status === 'saved' || products?.events.status === 'saved');
  const unavailable = products?.curve.status === 'error' || products?.events.status === 'error';
  const messages = [
    saved ? 'Showing saved predictions.' : '',
    error ?? (unavailable ? 'Some NOAA predictions are unavailable.' : ''),
    waitSeconds ? `Please wait ${waitSeconds} seconds before refreshing.` : '',
  ].filter(Boolean);
  return {
    busy: loading,
    disabled: loading || waitSeconds > 0,
    waitSeconds,
    warning: messages.length > 0,
    message: messages.join(' ') || (loading ? 'Updating predictions…' : ''),
  };
}
