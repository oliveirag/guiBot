import { describe, expect, it } from 'vitest';
import { BRAND_COLOR, ERROR_COLOR, err, info, ok } from '../../src/core/embeds.js';

describe('embeds', () => {
  it('info uses the brand color and optional title', () => {
    const json = info('hello', 'Title').toJSON();
    expect(json).toMatchObject({ color: BRAND_COLOR, description: 'hello', title: 'Title' });
  });

  it('ok prefixes a check mark', () => {
    expect(ok('saved').toJSON()).toMatchObject({ color: BRAND_COLOR, description: '✓ saved' });
  });

  it('err uses the error color', () => {
    expect(err('nope').toJSON()).toMatchObject({ color: ERROR_COLOR, description: '✕ nope' });
  });
});
