/// <reference types="google.maps" />
export interface ClientConfig { googleMapsApiKey: string; googleMapsMapId: string; sessionLimitMinutes: number }

export async function fetchClientConfig(fetcher: typeof fetch = fetch): Promise<ClientConfig> {
  const response = await fetcher('/api/config', { cache: 'no-store' });
  if (!response.ok) throw new Error('Location tools are unavailable.');
  const value = await response.json() as Partial<ClientConfig>;
  return {
    googleMapsApiKey: typeof value.googleMapsApiKey === 'string' ? value.googleMapsApiKey : '',
    googleMapsMapId: typeof value.googleMapsMapId === 'string' && value.googleMapsMapId ? value.googleMapsMapId : 'DEMO_MAP_ID',
    sessionLimitMinutes: typeof value.sessionLimitMinutes === 'number' ? value.sessionLimitMinutes : 120,
  };
}

let loading: Promise<void> | undefined;

/** Browser-restricted key comes from runtime configuration, never a built asset. */
export function loadGoogleMaps(apiKey: string, onAuthFailure: () => void): Promise<void> {
  if (!apiKey) return Promise.reject(new Error('The map is unavailable.'));
  loading ??= new Promise<void>((resolve, reject) => {
    const callback = '__tidepinMapsReady';
    const global = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    const timer = window.setTimeout(() => fail(), 15000);
    const fail = () => {
      window.clearTimeout(timer);
      delete global[callback];
      script.remove();
      reject(new Error('The map could not load.'));
    };
    global[callback] = () => { window.clearTimeout(timer); delete global[callback]; resolve(); };
    global.gm_authFailure = () => { onAuthFailure(); fail(); };
    const parameters = new URLSearchParams({ key: apiKey, v: 'weekly', loading: 'async', callback });
    script.src = `https://maps.googleapis.com/maps/api/js?${parameters}`;
    script.async = true;
    script.onerror = fail;
    document.head.append(script);
  }).catch(error => { loading = undefined; throw error; });
  return loading;
}
