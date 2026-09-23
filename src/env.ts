import { z } from 'zod';

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DEV_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().default('file:./dev.db'),
  PORT: z.coerce.number().int().positive().default(3000),
  ENABLED_MODULES: z.string().optional(),
  OWNER_IDS: z.string().default(''),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  JIRA_WEBHOOK_SECRET: z.string().optional(),
  JIRA_BASE_URL: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export interface Env {
  discordToken: string;
  clientId: string;
  devGuildId?: string;
  databaseUrl: string;
  port: number;
  enabledModules: string[] | null;
  ownerIds: string[];
  isProduction: boolean;
  githubWebhookSecret?: string;
  jiraWebhookSecret?: string;
  /** Read-only Jira REST access for /sprint and /team link. All three or none. */
  jira?: { baseUrl: string; email: string; token: string };
}

const csv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

// Pasted dashboard values often carry quotes or a trailing newline.
const clean = (value: string | undefined): string => (value ?? '').trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();

function jiraAccess(baseUrl?: string, email?: string, token?: string): Env['jira'] {
  // Tokens never contain whitespace; a space inside one is left over from copying a wrapped line.
  const [b, e, t] = [clean(baseUrl), clean(email), clean(token).replace(/\s+/g, '')];
  if (!b || !e || !t) return undefined;
  // Keep only the site: "https://x.atlassian.net/jira/your-work" becomes "https://x.atlassian.net".
  const site = /^https?:\/\/[^/]+/i.exec(b)?.[0] ?? b.replace(/\/+$/, '');
  return { baseUrl: site, email: e, token: t };
}

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const keys = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment: ${keys}`);
  }
  const e = result.data;
  const enabled = csv(e.ENABLED_MODULES);
  return {
    discordToken: e.DISCORD_TOKEN,
    clientId: e.DISCORD_CLIENT_ID,
    devGuildId: e.DEV_GUILD_ID || undefined,
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    enabledModules: enabled.length > 0 ? enabled : null,
    ownerIds: csv(e.OWNER_IDS),
    isProduction: e.NODE_ENV === 'production',
    githubWebhookSecret: e.GITHUB_WEBHOOK_SECRET || undefined,
    jiraWebhookSecret: e.JIRA_WEBHOOK_SECRET || undefined,
    jira: jiraAccess(e.JIRA_BASE_URL, e.JIRA_EMAIL, e.JIRA_API_TOKEN),
  };
}
