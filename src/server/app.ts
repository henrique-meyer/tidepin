import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance } from 'fastify';

export interface AppOptions {
  /** The built Vite client. Omitted while Vite serves development requests. */
  clientDir?: string;
  /** Original brand files served under /assets/. */
  assetsDir?: string;
  logger?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  // Do not log request URLs: future location searches must not enter logs.
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
  });

  // Process health stays independent of upstream tide-data availability.
  app.get('/health', async () => ({ status: 'ok' }));

  if (options.assetsDir && existsSync(options.assetsDir)) {
    await app.register(fastifyStatic, {
      root: options.assetsDir,
      prefix: '/assets/',
      decorateReply: false,
    });
  }
  if (options.clientDir && existsSync(options.clientDir)) {
    await app.register(fastifyStatic, { root: options.clientDir, prefix: '/' });
  }

  return app;
}
