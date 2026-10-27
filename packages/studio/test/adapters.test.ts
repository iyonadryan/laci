import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import express from 'express';
import Fastify from 'fastify';
import { Hono } from 'hono';
import { laciStudio as expressStudio } from '../src/express';
import type { ExpressStudioOptions } from '../src/express';
import { laciStudio as fastifyStudio } from '../src/fastify';
import type { FastifyStudioOptions } from '../src/fastify';
import { DISABLED_MESSAGE } from '../src/handler';
import { laciStudio as honoStudio } from '../src/hono';
import type { HonoStudioOptions } from '../src/hono';
import { createTestLaci, CSRF, UI_FIXTURE } from './fixtures';

const createBody = (key: string) => JSON.stringify({ key, schema: { type: 'integer' }, value: 1 });

/** Adds the internal `uiDir` option, so the fixture UI is served. */
function withFixture<T extends object>(options: T): T {
  return { ...options, uiDir: UI_FIXTURE };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Express', () => {
  const servers: { close: () => void }[] = [];
  afterAll(() => {
    for (const server of servers) server.close();
  });

  async function serve(app: express.Express): Promise<string> {
    const server = app.listen(0);
    servers.push(server);
    await new Promise((resolve) => server.once('listening', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('serves the studio at its mount path, with any body parser', async () => {
    const laci = await createTestLaci();
    const options = (authorize: ExpressStudioOptions['authorize']) =>
      withFixture({ laci, authorize, label: 'staging' });
    const app = express();
    app.use('/plain', expressStudio(options(() => ({ id: 'dev-1' }))));
    app.use(
      '/json',
      express.json(),
      expressStudio(options(() => Promise.resolve({ id: 'dev-2' }))),
    );
    app.use('/text', express.text({ type: '*/*' }), expressStudio(options(() => true)));
    app.use('/raw', express.raw({ type: '*/*' }), expressStudio(options(() => true)));
    const base = await serve(app);

    const redirect = await fetch(`${base}/plain`, { redirect: 'manual' });
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('location')).toBe('/plain/');
    expect(await (await fetch(`${base}/plain/`)).text()).toContain('Fixture');
    const session = (await (await fetch(`${base}/plain/api/session`)).json()) as { label: string };
    expect(session.label).toBe('staging');

    for (const prefix of ['plain', 'json', 'text', 'raw']) {
      const response = await fetch(`${base}/${prefix}/api/entries`, {
        method: 'POST',
        headers: CSRF,
        body: createBody(prefix),
      });
      expect(response.status).toBe(201);
    }
    const authors = await Promise.all(
      ['plain', 'json', 'text', 'raw'].map(async (key) => (await laci.getEntry(key))?.createdBy),
    );
    expect(authors).toEqual(['dev-1', 'dev-2', null, null]);
  });

  it('accepts HTTP/1.0 clients without a Host header', async () => {
    const app = express();
    app.use(
      '/laci',
      expressStudio(withFixture({ laci: await createTestLaci(), authorize: () => true })),
    );
    const base = await serve(app);
    const port = Number(new URL(base).port);
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.end('GET /laci HTTP/1.0\r\n\r\n');
      });
      let data = '';
      socket.on('data', (chunk: Buffer) => (data += chunk.toString()));
      socket.on('end', () => {
        resolve(data);
      });
      socket.on('error', reject);
    });
    expect(response).toMatch(/^HTTP\/1\.1 308/);
    expect(response).toContain('location: /laci/');
  });

  it('refuses users that authorize rejects, and passes errors on', async () => {
    const laci = await createTestLaci();
    const app = express();
    app.use('/denied', expressStudio(withFixture({ laci, authorize: () => null })));
    app.use(
      '/broken',
      expressStudio(
        withFixture({
          laci,
          authorize: () => {
            throw new Error('auth service down');
          },
        }),
      ),
    );
    const base = await serve(app);
    const denied = await fetch(`${base}/denied/api/session`);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'You are not allowed to use Laci Studio.' });
    expect((await fetch(`${base}/broken/`)).status).toBe(500);
  });

  it('passes every request on when disabled, and when NODE_ENV is production', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const laci = await createTestLaci();
    const app = express();
    app.use('/off', expressStudio({ laci, authorize: () => true, enabled: false }));
    vi.stubEnv('NODE_ENV', 'production');
    app.use('/prod', expressStudio({ laci, authorize: () => true }));
    app.use('/forced', expressStudio(withFixture({ laci, authorize: () => true, enabled: true })));
    app.get('/app/badge', async (_req, res) => {
      res.json(await laci.find('customerCategoryColor', { category: 'VIP' }));
    });
    app.use((_req, res) => {
      res.status(404).send('app 404');
    });
    const base = await serve(app);
    for (const path of ['/off/', '/prod/', '/prod/api/session', '/prod/api/entries']) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('app 404');
    }
    const write = await fetch(`${base}/prod/api/entries`, {
      method: 'POST',
      headers: CSRF,
      body: createBody('sneaky'),
    });
    expect(write.status).toBe(404);
    expect(await laci.getEntry('sneaky')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(DISABLED_MESSAGE);
    // The app keeps reading, and `enabled: true` still turns the studio on.
    expect(await (await fetch(`${base}/app/badge`)).json()).toMatchObject({ category: 'VIP' });
    expect((await fetch(`${base}/forced/api/session`)).status).toBe(200);
  });
});

describe('Fastify', () => {
  async function app(options: Partial<FastifyStudioOptions> = {}) {
    const laci = await createTestLaci();
    const fastify = Fastify();
    await fastify.register(
      fastifyStudio(withFixture({ laci, authorize: () => ({ id: 'dev-1' }), ...options })),
      { prefix: '/laci' },
    );
    return { fastify, laci };
  }

  it('serves the studio under its prefix', async () => {
    const { fastify, laci } = await app();
    const redirect = await fastify.inject({ url: '/laci' });
    expect(redirect.statusCode).toBe(308);
    expect(redirect.headers.location).toBe('/laci/');
    expect((await fastify.inject({ url: '/laci/' })).body).toContain('Fixture');
    expect((await fastify.inject({ url: '/laci/assets/app.js' })).headers['content-type']).toBe(
      'text/javascript; charset=utf-8',
    );
    const created = await fastify.inject({
      method: 'POST',
      url: '/laci/api/entries',
      headers: CSRF,
      payload: createBody('maxUpload'),
    });
    expect(created.statusCode).toBe(201);
    expect((await laci.getEntry('maxUpload'))?.createdBy).toBe('dev-1');
    const empty = await fastify.inject({ method: 'POST', url: '/laci/api/entries', headers: CSRF });
    expect(empty.statusCode).toBe(400);
  });

  it('refuses users that authorize rejects', async () => {
    const { fastify } = await app({ authorize: () => Promise.resolve(false) });
    expect((await fastify.inject({ url: '/laci/api/session' })).statusCode).toBe(403);
  });

  it('adds no routes when disabled or when NODE_ENV is production', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fastify } = await app({ enabled: false });
    expect((await fastify.inject({ url: '/laci/' })).statusCode).toBe(404);
    vi.stubEnv('NODE_ENV', 'production');
    const production = await app();
    expect((await production.fastify.inject({ url: '/laci/api/session' })).statusCode).toBe(404);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(DISABLED_MESSAGE);
  });
});

describe('Hono', () => {
  async function app(options: Partial<HonoStudioOptions> = {}) {
    const laci = await createTestLaci();
    const hono = new Hono();
    hono.route(
      '/laci',
      honoStudio(withFixture({ laci, authorize: () => ({ id: 'dev-1' }), ...options })),
    );
    return { hono, laci };
  }

  it('serves the studio where it is mounted', async () => {
    const { hono, laci } = await app();
    const redirect = await hono.request('/laci');
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('location')).toBe('/laci/');
    expect(await (await hono.request('/laci/')).text()).toContain('Fixture');
    const created = await hono.request('/laci/api/entries', {
      method: 'POST',
      headers: CSRF,
      body: createBody('maxUpload'),
    });
    expect(created.status).toBe(201);
    expect((await laci.getEntry('maxUpload'))?.createdBy).toBe('dev-1');
  });

  it('refuses users that authorize rejects', async () => {
    const { hono } = await app({ authorize: () => undefined });
    expect((await hono.request('/laci/api/session')).status).toBe(403);
  });

  it('has no routes when disabled or when NODE_ENV is production', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { hono } = await app({ enabled: false });
    expect((await hono.request('/laci/')).status).toBe(404);
    vi.stubEnv('NODE_ENV', 'production');
    const production = await app();
    expect((await production.hono.request('/laci/api/session')).status).toBe(404);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(DISABLED_MESSAGE);
  });
});
