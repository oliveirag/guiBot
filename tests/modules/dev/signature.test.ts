import { describe, expect, it } from 'vitest';
import { signBody, verifySignature } from '../../../src/modules/dev/lib/signature.js';

// Example from GitHub's "Validating webhook deliveries" docs.
const secret = "It's a Secret to Everybody";
const body = Buffer.from('Hello, World!');
const header = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';

describe('verifySignature', () => {
  it('accepts the documented example', () => {
    expect(verifySignature(secret, body, header)).toBe(true);
    expect(signBody(secret, body)).toBe(header);
  });

  it('rejects a wrong secret, a tampered body, and malformed headers without throwing', () => {
    expect(verifySignature('nope', body, header)).toBe(false);
    expect(verifySignature(secret, Buffer.from('Hello, World?'), header)).toBe(false);
    expect(verifySignature(secret, body, undefined)).toBe(false);
    expect(verifySignature(secret, body, 'sha1=abc')).toBe(false);
    expect(verifySignature(secret, body, 'sha256=zz')).toBe(false);
    expect(verifySignature(secret, body, 'sha256=')).toBe(false);
  });
});
