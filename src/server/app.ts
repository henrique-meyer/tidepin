import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { createStationClient, type StationClient } from './station-client.js';
import { loadConfig, type Config } from './config.js';
import type { StationCoordinates } from '../shared/stations.js';
import { createNoaaClient } from './noaa-client.js';
import { stationDayWindow } from '../shared/tides.js';
import type { TideResponse } from '../shared/tide-response.js';
import { fillBaseUrl, SOCIAL_IMAGE_PATH } from './metadata.js';

export interface AppOptions {
  /** The built Vite client. Omitted while Vite serves development requests. */
  clientDir?: string;
  /** Original brand files served under /assets/. */
  assetsDir?: string;
  logger?: boolean;
  config?: Config;
  stationClient?: StationClient;
  predictionClient?: ReturnType<typeof createNoaaClient>;
  now?: () => number;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const stations = options.stationClient ?? createStationClient();
  const predictions = options.predictionClient ?? createNoaaClient();
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  // Do not log request URLs: future location searches must not enter logs.
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
  });

  // Process health stays independent of upstream tide-data availability.
  app.get('/health', async () => ({ status: 'ok' }));
  // Only browser-safe runtime settings are exposed; never serialize process.env.
  app.get('/api/config', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { googleMapsApiKey: config.googleMapsApiKey, googleMapsMapId: config.googleMapsMapId, sessionLimitMinutes: config.sessionLimitMinutes };
  });
  app.post<{ Body: StationCoordinates }>('/api/stations/nearest', {
    bodyLimit: 1024,
    schema: { body: { type: 'object', required: ['latitude', 'longitude'], additionalProperties: false, properties: { latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try { return { station: await stations.nearest(request.body) }; }
    catch { return reply.code(503).send({ error: { code: 'stationsUnavailable', message: 'NOAA tide stations are unavailable. Please try again later.' } }); }
  });
  app.get<{ Params: { id: string } }>('/api/stations/:id', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[A-Za-z0-9]{7}$' } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const station = await stations.get(request.params.id);
      return station ? { station } : reply.code(404).send({ error: { code: 'stationNotFound', message: 'This NOAA prediction station is unavailable.' } });
    } catch { return reply.code(503).send({ error: { code: 'stationsUnavailable', message: 'NOAA tide stations are unavailable. Please try again later.' } }); }
  });

  app.get<{ Params: { id: string }; Querystring: { refresh?: string } }>('/api/tides/:id', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[A-Za-z0-9]{7}$' } } },
      querystring: { type: 'object', additionalProperties: false, properties: { refresh: { type: 'string', enum: ['1'] } } },
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const station = await stations.get(request.params.id);
      if (!station) return reply.code(404).send({ error: { code: 'stationNotFound', message: 'This NOAA prediction station is unavailable.' } });
      const instant = Math.floor(now());
      const window = station.timeZoneId ? stationDayWindow(instant, station.timeZoneId) : null;
      if (!window || !station.timeZoneId) return reply.code(422).send({ error: { code: 'timeZoneUnavailable', message: 'The station time zone is unavailable. Predictions cannot be shown safely.' } });
      const products = await predictions.getPredictions({ stationId: station.id, timeZoneId: station.timeZoneId, ...window, curveSupported: station.curveSupported, forceRefresh: request.query.refresh === '1' });
      return { station, window, now: instant, predictions: products } satisfies TideResponse;
    } catch { return reply.code(503).send({ error: { code: 'predictionsUnavailable', message: 'NOAA predictions are unavailable. Please try again later.' } }); }
  });

  if (options.assetsDir && existsSync(options.assetsDir)) {
    const socialImage = resolve(options.assetsDir, SOCIAL_IMAGE_PATH.slice('/assets/'.length));
    const favicon = resolve(options.assetsDir, 'brand/icons/favicon.ico');
    if (existsSync(favicon)) {
      app.get('/favicon.ico', async (_request, reply) => reply
        .type('image/vnd.microsoft.icon')
        .header('Cache-Control', 'public, max-age=31536000')
        .send(await readFile(favicon)));
    }
    await app.register(fastifyStatic, {
      root: options.assetsDir,
      prefix: '/assets/',
      decorateReply: false,
      setHeaders(reply, filePath) {
        // A stable share-card filename can be revalidated daily; do not mark it immutable.
        if (filePath === socialImage) reply.header('Cache-Control', 'public, max-age=86400');
      },
    });
  }
  if (options.clientDir && existsSync(options.clientDir)) {
    // Fill immutable built pages once. Explicit aliases also prevent the static route exposing raw tokens.
    const clientDir = options.clientDir;
    const [indexHtml, locationHtml] = await Promise.all(['index.html', 'location.html'].map(async (file) =>
      fillBaseUrl(await readFile(join(clientDir, file), 'utf8'), config.publicBaseUrl)));
    await app.register(fastifyStatic, {
      root: clientDir, prefix: '/', index: false,
      // The plugin decodes/normalizes this path before authorization. HTML belongs only to filled routes,
      // including file-with-slash aliases that the underlying file server would otherwise open.
      allowedPath: pathname => !/\.html(?:\/|$)/i.test(pathname),
    });
    for (const path of ['/', '/index.html']) {
      app.get(path, async (_request, reply) => reply.type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-cache').send(indexHtml));
    }
    for (const path of ['/location', '/location.html']) {
      app.get(path, async (_request, reply) => reply.type('text/html; charset=utf-8')
        .header('Cache-Control', 'no-cache').send(locationHtml));
    }
  }

  return app;
}
