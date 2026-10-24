export interface Config {
  port: number;
  googleMapsApiKey: string;
  googleMapsMapId: string;
  sessionLimitMinutes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawPort = env.PORT ?? '8080';
  if (!/^\d+$/.test(rawPort)) throw new Error('PORT must be an integer between 1 and 65535.');
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const rawSession = env.SESSION_LIMIT_MINUTES ?? '120';
  const sessionLimitMinutes = Number(rawSession);
  if (!/^\d+$/.test(rawSession) || !Number.isSafeInteger(sessionLimitMinutes) || sessionLimitMinutes < 1 || sessionLimitMinutes > 120) {
    throw new Error('SESSION_LIMIT_MINUTES must be an integer between 1 and 120.');
  }
  return { port, googleMapsApiKey: env.GOOGLE_MAPS_API_KEY ?? '', googleMapsMapId: env.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID', sessionLimitMinutes };
}
