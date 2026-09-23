import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

/** Checks a `sha256=<hex>` HMAC header (GitHub X-Hub-Signature-256, Jira X-Hub-Signature). */
export function verifySignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith(PREFIX)) return false;
  const given = Buffer.from(header.slice(PREFIX.length), 'hex');
  const expected = createHmac('sha256', secret).update(body).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signBody(secret: string, body: Buffer | string): string {
  return PREFIX + createHmac('sha256', secret).update(body).digest('hex');
}
