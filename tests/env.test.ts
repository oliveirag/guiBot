import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/env.js';

const base = { DISCORD_TOKEN: 'token', DISCORD_CLIENT_ID: 'client' };

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env).toEqual({
      discordToken: 'token',
      clientId: 'client',
      devGuildId: undefined,
      databaseUrl: 'file:./dev.db',
      port: 3000,
      enabledModules: null,
      ownerIds: [],
      isProduction: false,
      githubWebhookSecret: undefined,
      jiraWebhookSecret: undefined,
    });
  });

  it('splits and trims list vars', () => {
    const env = parseEnv({ ...base, ENABLED_MODULES: ' core, sd ,', OWNER_IDS: '1,2' });
    expect(env.enabledModules).toEqual(['core', 'sd']);
    expect(env.ownerIds).toEqual(['1', '2']);
  });

  it('treats an empty DEV_GUILD_ID as unset and reads production', () => {
    const env = parseEnv({ ...base, DEV_GUILD_ID: '', NODE_ENV: 'production', PORT: '8080' });
    expect(env.devGuildId).toBeUndefined();
    expect(env.isProduction).toBe(true);
    expect(env.port).toBe(8080);
  });

  it('names missing required vars', () => {
    expect(() => parseEnv({})).toThrow(/DISCORD_TOKEN.*DISCORD_CLIENT_ID/);
  });

  it('reads webhook secrets and treats empty ones as unset', () => {
    const env = parseEnv({ ...base, GITHUB_WEBHOOK_SECRET: 'gh', JIRA_WEBHOOK_SECRET: '' });
    expect(env.githubWebhookSecret).toBe('gh');
    expect(env.jiraWebhookSecret).toBeUndefined();
  });
});
