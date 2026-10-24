export interface Config {
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawPort = env.PORT ?? '8080';
  if (!/^\d+$/.test(rawPort)) throw new Error('PORT must be an integer between 1 and 65535.');
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return { port };
}
