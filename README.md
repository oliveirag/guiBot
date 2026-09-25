# guiBot

My personal everything bot for Discord. It runs my servers and keeps track of how my Senior Design team is doing.

## Develop

```bash
cp .env.example .env   # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DEV_GUILD_ID, OWNER_IDS
npm install
npm run db:migrate     # creates prisma/dev.db
npm run deploy         # registers slash commands in DEV_GUILD_ID
npm run dev
npm test
```

In the Discord Developer Portal, turn on the Server Members and Message Content intents.

## Add a command

Create one file in `src/modules/<module>/commands/`, then run `npm run deploy`:

```ts
import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';

export default command({
  data: new SlashCommandBuilder().setName('hello').setDescription('Say hi.'),
  async run({ interaction }) {
    await interaction.reply({ embeds: [info('hi')] });
  },
});
```

To add a module, create `src/modules/<name>/index.ts` that exports `moduleMeta({ name, description })`. Put event handlers in `events/` and scheduled job handlers in `jobs/`.

## Deploy (Railway)

- Deploy from this repo. Railway builds from `Dockerfile`.
- Add a volume mounted at `/data`.
- Set these env vars: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `OWNER_IDS`, `DATABASE_URL=file:/data/guibot.db`, `NODE_ENV=production`. Set `ENABLED_MODULES` too if you want to limit which modules load.
- On boot the container runs migrations, registers global commands, then starts the bot. The healthcheck is `GET /health`.
- If command registration fails on boot, the bot still starts; commands just stay whatever they were last registered as.

## GitHub and Jira notifications

The `dev` module posts PRs opened/merged, review requests, approvals and change requests, failed workflow runs (and "back to green" when the next run passes), releases, pushes to the default branch (so people know to pull), and Jira issue changes.

1. Set `GITHUB_WEBHOOK_SECRET` and/or `JIRA_WEBHOOK_SECRET` to long random strings (`openssl rand -hex 32`).
2. GitHub: repo Settings → Webhooks → Add webhook. Payload URL `https://<your-railway-domain>/webhooks/github`,
   content type `application/json`, the same secret, and events: Pull requests, Pull request reviews, Workflow runs, Releases, Pushes.
3. Jira: Settings → System → WebHooks → Create. URL `https://<your-railway-domain>/webhooks/jira`, the same
   secret, events: Issue created and Issue updated.
4. In Discord: `/config dev add source:GitHub target:owner/repo channel:#dev`, and the same with `source:Jira target:SD`.

To ping a role when a workflow fails: `/config dev failure-ping role:@Devs` (run it with no role to turn it off).

Pushes to other branches are stored but not posted. Senior Design stats use them.

## Senior Design

The `sd` module runs the team: who's who, standups, meetings, deadlines, the Jira sprint, and progress stats.
Stats come from the GitHub and Jira events above, so set those feeds up first.

- `/team link github:<login> jira:<email or Jira profile link>`: everyone runs this once so their work counts.
  Managers can link others with `member:`. `/team list`, `/team unlink`.
- `/deadline add title date [time]`, `/deadline list`, `/deadline done id`. Reminders go out 7, 2, and 1 day
  before, and a board in the deadlines channel keeps itself current.
- `/meeting create title date time [length] [weekly] [location] [channel]`: posts RSVP buttons, creates a
  Discord event (needs Manage Events), and pings everyone going or maybe 1 hour and 10 minutes before.
  Weekly meetings post next week's copy when they start. `/meeting list`, `/meeting cancel id`.
- `/sprint [project]`: the active sprint's to do, in progress, and done, with who owns what.
- `/progress [member] [days]`: commits, PRs, reviews, Jira issues done, and standup attendance.
- `/standup config channel time [days] [summary-after]`: posts a standup with a button that opens a form (done,
  today, blockers). The summary posts later and flags who's missing and who's blocked. `/standup off` stops it,
  `/standup open|close` runs today's by hand.

Settings live in `/config sd`:

- `digest channel [day] [time]`: a weekly post of who did what and what's due. `digest-off` stops it.
- `digest-ai enabled`: adds a short AI-written status paragraph on top of the digest (needs `GEMINI_API_KEY`).
- `deadlines channel`: where deadline reminders and the board go.
- `timezone zone`: for schedules and the dates people type. Defaults to America/New_York.
- `show`: current settings.

`/sprint` and Jira email lookup in `/team link` need read-only API access: set `JIRA_BASE_URL`
(`https://<site>.atlassian.net`), `JIRA_EMAIL`, and `JIRA_API_TOKEN` (from id.atlassian.com, API tokens).
Without them, people can paste their Jira profile link into `/team link` instead of an email.

## AI

The `ai` module answers in Gui's voice with Gemini. Set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`,
default `gemini-2.5-flash`).

- `/ask question`: answers in the channel. It reads the last 15 messages there for context.
- @mention guiBot or reply to one of its messages to talk to it.
- In a server with Senior Design set up, it also sees the active sprint, deadlines, and recent GitHub/Jira activity.

It's off everywhere until you turn it on: `/config ai channel #channel enabled:true` (threads follow their
channel). `/config ai cooldown seconds` sets the per-person wait (default 20s, owners skip it).

## Moderation

The `mod` module. Every action gets a case number, a DM to the person (turn off with `/config mod dm`), and a
post in the modlog channel if `logs` has one.

- `/ban user [reason] [duration] [delete]` (a duration makes it a temp ban), `/unban`, `/kick`,
  `/timeout user duration`, `/untimeout`.
- `/warn user reason`, `/warnings user`, `/delwarn case`, `/clearwarns user`. `/config mod escalate warns action
  [duration]` punishes automatically at a warn count.
- `/note add|list`, `/modlog case|edit|history`.
- `/purge count [user] [bots] [links] [match]`, `/lock`, `/unlock`, `/lockdown on|off`, `/slowmode delay`.

Bans made in Discord's own menu still get a case (the moderator shows up if guiBot has View Audit Log).

## Logs

The `logs` module. Route each kind to a channel with `/config logs set kind channel` (or `all`):
`messages` (edits, deletes, purges), `members` (joins, leaves), `roles` (role and nickname changes), `voice`,
and `modlog` (cases). `/config logs off kind` stops one.

## Automod

The `automod` module. Every rule is off until you turn it on with `/config automod rule name enabled [action]
[limit] [duration]`: `spam`, `duplicates`, `invites`, `links`, `words`, `mentions`, `caps`, `newaccount`.
Actions are delete, warn (counts toward escalation), timeout, or kick. Message rules always delete first, and
only the first hit in a burst gets punished.

`words-add|words-remove`, `allow-link|disallow-link`, and `exempt role|channel` tune it. Anyone with Manage
Messages is never checked. `/config automod show` lists what each rule's limit means.

## Roles

The `roles` module.

- `/rolepanel create title [description] [style] [channel]` posts a panel (buttons or a dropdown), then
  `/rolepanel add panel role [label] [emoji]`, `remove`, `delete`, `list`. Clicking toggles the role.
- `/reactionrole add message emoji role` (paste a message link), `remove`, `list`.
- `/role add|remove user role`, `/role info role`, `/temprole user role duration`.
- `/config roles autorole-add role [for]` gives a role to everyone who joins (people or bots). Waits for
  membership screening if the server uses it.

guiBot can only hand out roles below its own top role, and mods can only set up roles below theirs.

## Welcome

The `welcome` module. Set it up in `/config welcome`:

- `join channel [message] [embed]`, `leave channel [message] [embed]`, `dm [message]`. Messages take
  `{user}`, `{username}`, `{server}`, `{count}`. Only the new member gets pinged. Preview with `/welcome test`.
- `birthdays channel [role] [time] [timezone]`: posts every day at `time` for anyone whose birthday it is, and
  gives `role` for 24 hours. People save theirs with `/birthday set date`; `/birthday list` shows who's next.

The old PrizePicks tracker lives in `legacy/prizepicks/` until it's ported as a module.
