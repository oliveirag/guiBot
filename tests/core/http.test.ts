import { describe, expect, it } from 'vitest';
import { acceptRawJson, buildServer } from '../../src/core/http.js';
import type { HttpRoutes } from '../../src/core/types.js';
import { silentLog, testEnv } from '../helpers.js';

const deps = { env: testEnv({ port: 4321 }), log: silentLog() };

describe('buildServer', () => {
  it('answers the healthcheck', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('mounts module routes and hands them deps', async () => {
    const hello: HttpRoutes = async (app, { env }) => {
      app.get('/hello', async () => ({ port: env.port }));
    };
    const app = buildServer({ routes: [hello], deps });
    const res = await app.inject({ method: 'GET', url: '/hello' });
    expect(res.json()).toEqual({ port: 4321 });
    await app.close();
  });
});

describe('acceptRawJson', () => {
  const raw: HttpRoutes = async (app) => {
    acceptRawJson(app);
    app.post('/raw', async (req) => ({ isBuffer: Buffer.isBuffer(req.body), length: (req.body as Buffer).length }));
  };
  const parsed: HttpRoutes = async (app) => {
    app.post('/parsed', async (req) => ({ type: typeof req.body }));
  };

  it('keeps JSON as raw bytes in its own scope only', async () => {
    const app = buildServer({ routes: [raw, parsed], deps });
    const body = '{"a":1}';
    const headers = { 'content-type': 'application/json; charset=utf-8' };
    expect((await app.inject({ method: 'POST', url: '/raw', payload: body, headers })).json()).toEqual({
      isBuffer: true,
      length: body.length,
    });
    expect((await app.inject({ method: 'POST', url: '/parsed', payload: body, headers })).json()).toEqual({
      type: 'object',
    });
    await app.close();
  });

  it('accepts bodies over 1 MB', async () => {
    const app = buildServer({ routes: [raw], deps });
    const body = JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) });
    const res = await app.inject({
      method: 'POST',
      url: '/raw',
      payload: body,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(body.length);
    await app.close();
  });
});
