import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { connect } from 'node:net';
import { userInfo } from 'node:os';
import { DISABLED_MESSAGE } from '../src/handler';
import { startStudio } from '../src/node';
import type { RunningStudio, StartStudioOptions } from '../src/node';
import { createTestLaci, UI_FIXTURE } from './fixtures';

const running: RunningStudio[] = [];

async function start(options: Partial<StartStudioOptions> = {}) {
  const log = vi.fn();
  const laci = await createTestLaci();
  const studio = await startStudio({
    laci,
    port: 0,
    token: 'secret',
    log,
    ...options,
    // Internal: serve the test fixture instead of the built UI.
    ...({ uiDir: UI_FIXTURE } as object),
  });
  if (studio) running.push(studio);
  return { studio, log, base: studio ? `http://127.0.0.1:${studio.port}` : '' };
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((studio) => studio.close()));
  vi.unstubAllEnvs();
});

/** A random high port, likely free together with the ten after it. */
function randomPort(): number {
  return 40_000 + Math.floor(Math.random() * 9_000);
}

function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.end(text);
    });
    let data = '';
    socket.on('data', (chunk: Buffer) => (data += chunk.toString()));
    socket.on('end', () => {
      resolve(data);
    });
    socket.on('error', reject);
  });
}

describe('startStudio', () => {
  it('is unlocked by the token link and locked otherwise', async () => {
    const { studio, base, log } = await start({ label: 'staging' });
    expect(studio?.url).toBe(`http://localhost:${studio?.port}/?token=secret`);
    expect(log).toHaveBeenCalledWith(`Laci Studio: ${studio?.url}  (saves to: staging)`);

    const locked = await fetch(`${base}/`);
    expect(locked.status).toBe(401);
    expect(await locked.text()).toContain('Laci Studio is locked');
    const lockedApi = await fetch(`${base}/api/entries`);
    expect(await lockedApi.json()).toEqual({ error: 'Open the link printed in the terminal.' });
    expect((await fetch(`${base}/?token=wrong`)).status).toBe(401);

    const unlock = await fetch(`${base}/?token=secret&tab=1`, { redirect: 'manual' });
    expect(unlock.status).toBe(303);
    expect(unlock.headers.get('location')).toBe('/?tab=1');
    const cookie = unlock.headers.get('set-cookie') ?? '';
    expect(cookie).toBe(`laci_studio_${studio?.port}=secret; Path=/; HttpOnly; SameSite=Strict`);

    const headers = { cookie: `other=1; ${cookie.split(';')[0]}; flag` };
    const session = (await (await fetch(`${base}/api/session`, { headers })).json()) as {
      user: unknown;
    };
    expect(session.user).toEqual({ id: userInfo().username });
    expect((await fetch(`${base}/`, { headers })).status).toBe(200);
    expect((await fetch(`${base}/`, { headers: { cookie: 'laci_studio_1=secret' } })).status).toBe(
      401,
    );

    const created = await fetch(`${base}/api/entries`, {
      method: 'POST',
      headers: { ...headers, 'x-laci-studio': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'maxUpload', schema: {}, value: 10, note: 'From the studio' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ createdBy: userInfo().username });
  });

  it('records the given user as author', async () => {
    const { base, studio } = await start({ user: { id: 'dev-7', name: 'Dev' } });
    const cookie = `laci_studio_${studio?.port}=secret`;
    const session = (await (
      await fetch(`${base}/api/session`, { headers: { cookie } })
    ).json()) as {
      user: unknown;
    };
    expect(session.user).toEqual({ id: 'dev-7', name: 'Dev' });
  });

  it('passes repeated headers on, and accepts clients without a Host header', async () => {
    const { studio } = await start();
    const port = studio?.port as number;
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/api/session',
          headers: { cookie: `laci_studio_${port}=secret`, 'x-tag': ['a', 'b'] },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode as number);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(200);
    expect(await raw(port, 'GET / HTTP/1.0\r\n\r\n')).toMatch(/^HTTP\/1\.1 401/);
  });

  it('answers 500 when a request cannot be handled', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { studio } = await start();
    const port = studio?.port as number;
    // `new Request` refuses the TRACE method.
    const response = await raw(
      port,
      `TRACE /api/session HTTP/1.1\r\nHost: localhost\r\nCookie: laci_studio_${port}=secret\r\nConnection: close\r\n\r\n`,
    );
    expect(response).toMatch(/^HTTP\/1\.1 500/);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('uses the next port when the port is taken, and gives up after ten', async () => {
    const port = randomPort();
    const blockers = [await occupy(port)];
    const { studio } = await start({ port });
    expect(studio?.port).toBe(port + 1);
    for (let n = 2; n <= 10; n++) blockers.push(await occupy(port + n));
    await expect(start({ port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await Promise.all(blockers.map((server) => new Promise((resolve) => server.close(resolve))));
  });

  it('rethrows other listen errors', async () => {
    await expect(start({ host: 'no-such-host.invalid' })).rejects.toMatchObject({
      code: expect.stringMatching(/ENOTFOUND|EAI_AGAIN/),
    });
  });

  it('reads the port and token from the environment', async () => {
    const port = randomPort();
    vi.stubEnv('LACI_STUDIO_PORT', String(port));
    vi.stubEnv('LACI_STUDIO_TOKEN', 'from-env');
    const { studio } = await start({ port: undefined, token: undefined });
    expect(studio?.url).toBe(`http://localhost:${port}/?token=from-env`);
  });

  it('makes a random token and uses port 5224 by default', async () => {
    vi.stubEnv('LACI_STUDIO_TOKEN', undefined);
    vi.stubEnv('LACI_STUDIO_PORT', undefined);
    // Port 5224 may be in use on this machine; any port from 5224 on is fine.
    const { studio } = await start({ port: undefined, token: undefined });
    expect(studio?.port).toBeGreaterThanOrEqual(5224);
    expect(studio?.url).toMatch(/\?token=[\w-]{32}$/);
  });

  it('warns when other computers can reach it', async () => {
    const { studio, log } = await start({ host: '127.0.0.2' });
    expect(studio?.url).toMatch(/^http:\/\/127\.0\.0\.2:/);
    expect(log).toHaveBeenCalledWith(
      'Laci Studio listens on 127.0.0.2: other computers can reach it (with the token).',
    );
  });

  it('does not start when disabled, and logs to the console by default', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const studio = await startStudio({ laci: await createTestLaci(), enabled: false });
    expect(studio).toBeNull();
    expect(info).toHaveBeenCalledWith(DISABLED_MESSAGE);
    info.mockRestore();
  });

  it('does not start when NODE_ENV is production, unless enabled explicitly', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const off = await start();
    expect(off.studio).toBeNull();
    expect(off.log).toHaveBeenCalledWith(DISABLED_MESSAGE);

    const on = await start({ enabled: true, label: 'PRODUCTION' });
    expect(on.log).toHaveBeenCalledWith(`Laci Studio: ${on.studio?.url}  (saves to: PRODUCTION)`);
    const cookie = `laci_studio_${on.studio?.port}=secret`;
    const session = await fetch(`${on.base}/api/session`, { headers: { cookie } });
    expect(await session.json()).toMatchObject({ label: 'PRODUCTION', runtime: 'production' });
  });

  it('reports errors when closing twice', async () => {
    const { studio } = await start();
    running.pop();
    await studio?.close();
    await expect(studio?.close()).rejects.toThrow();
  });
});
