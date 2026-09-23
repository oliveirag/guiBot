import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import {
  clearGuildConfigCache,
  getDisabledModules,
  isModuleEnabled,
  setModuleEnabled,
} from '../../src/core/guildConfig.js';
import { resetDb } from '../db.js';

describe('guildConfig', () => {
  beforeEach(resetDb);

  it('treats every module as enabled for an unknown guild without creating a row', async () => {
    expect(await isModuleEnabled('g1', 'levels')).toBe(true);
    expect(await prisma.guildConfig.count()).toBe(0);
  });

  it('persists a disabled module', async () => {
    await setModuleEnabled('g1', 'levels', false);
    clearGuildConfigCache();
    expect(await isModuleEnabled('g1', 'levels')).toBe(false);
    expect([...(await getDisabledModules('g1'))]).toEqual(['levels']);
  });

  it('re-enables a module', async () => {
    await setModuleEnabled('g1', 'levels', false);
    await setModuleEnabled('g1', 'levels', true);
    clearGuildConfigCache();
    expect(await isModuleEnabled('g1', 'levels')).toBe(true);
  });

  it('keeps guilds separate', async () => {
    await setModuleEnabled('g1', 'fun', false);
    expect(await isModuleEnabled('g2', 'fun')).toBe(true);
  });
});
