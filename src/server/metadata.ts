/** The same runtime-origin placeholder used by the reference demo. Never derive it from request headers. */
export const BASE_URL_PLACEHOLDER = '__PUBLIC_BASE_URL__';
export const SOCIAL_IMAGE_PATH = '/assets/social/tidepin-social.png';
export const SOCIAL_DESCRIPTION = 'Live tide predictions for US stations from NOAA CO-OPS, with a tide-level ocean display. Not for navigation.';
export const SOCIAL_IMAGE_ALT = 'Tidepin pin and wave logo with the words Tidepin and Tide predictions, at a glance, over an ocean-inspired background. NOAA CO-OPS. Not for navigation.';

const INVALID_BASE_URL = 'PUBLIC_BASE_URL must be an HTTPS origin, or an HTTP loopback origin for local development, without credentials, a path, query or fragment.';

/** Keep public share URLs absolute and secure, with a bounded exception for local development. */
export function normalizePublicBaseUrl(value: string): string {
  const input = value.trim();
  if (!/^https?:\/\/[^/]/i.test(input) || /[\s<>"'`\\]/.test(input) || input.includes('?') || input.includes('#')) {
    throw new Error(INVALID_BASE_URL);
  }
  let url: URL;
  try { url = new URL(input); }
  catch { throw new Error(INVALID_BASE_URL); }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || !url.hostname || !/^\/*$/.test(url.pathname)) {
    throw new Error(INVALID_BASE_URL);
  }
  return url.origin;
}

/** Only replace the trusted build-time token, after validating and escaping its runtime value. */
export function fillBaseUrl(html: string, publicBaseUrl: string): string {
  const base = normalizePublicBaseUrl(publicBaseUrl)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  return html.replaceAll(BASE_URL_PLACEHOLDER, base);
}
