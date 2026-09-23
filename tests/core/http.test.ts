import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/core/http.js';

describe('buildServer', () => {
  it('answers the healthcheck', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
