# guiBot design

Status: approved 2026-09-22. Next step: implementation plan.

## Decisions
- Name: guiBot. Personal-brand "everything bot" modeled on Carl-bot (github.com/botlabs-gg/carlbot-docs).
- Audience: Gui's own servers only (incl. Senior Design team server, 7 members).
- Stack: TypeScript, Node 22, plain discord.js v14 + custom module loader, Prisma + SQLite, Vitest.
- Hosting: Railway (Docker). SQLite at /data/guibot.db on a Railway volume.
- Slash commands only. Per-guild registration in dev, global in prod.
- Privileged intents: GuildMembers, MessageContent.
- Brand: accent #3B82F6 (website Tailwind blue-500). Voice: clean + minimal, lightly playful, based on
  website/proxy-server/prompt/systemPrompt.json.
- AI: Gemini 2.5 Flash (same as website).

## Architecture (approved)
- One process: Discord gateway client + Fastify server (GitHub/Jira webhooks, healthcheck).
- src/core: command()/event() helpers, auto-loader over src/modules/*, perms, cooldowns,
  branded embeds (ok/err/info), central error handler.
- src/modules/<name>/{commands,events,jobs}. New command = one file. More commands will be added over time.
- All rows keyed by guildId.
- Scheduler: DB-backed job table polled every ~15s (reminders, giveaways, timed bans/mutes, temproles, SD reminders).
- Config via /config <module> subcommands. No web dashboard in v1.

## Public-ready constraints
Goal: a future public bot runs the same codebase as a separate Discord application, with personal
modules (sd, prizepicks, ai persona) kept on the private one.
- Per-guild module toggles: /config modules enable|disable <module>. Disabled modules skip their
  commands and events for that guild.
- ENABLED_MODULES env var per deployment (comma-separated, default all). The loader only loads these,
  so modules left out are never registered or run.
- No hardcoded guild, channel, role, or user IDs in code. Everything comes from per-guild DB config or env
  (bot owner via OWNER_IDS).

## v1 modules (approved)
- Core: /help (auto), /ping, /about, /config view
- Moderation: /ban /unban /kick /timeout /untimeout /warn (durations), /warnings /delwarn /clearwarns,
  /note add|list, /modlog case|edit, /purge (count/user/bots/links/match), /lock /unlock /lockdown, /slowmode
- Logging: /config logs routes msg edit/delete, join/leave, bans, role/nick changes, voice, modlog cases
- Automod: spam rate, duplicates, invites, links (allowlist), banned words, mass mentions, caps, new-account
  filter; per-rule action (delete/warn/timeout/kick); warn-threshold escalation
- Roles: button/select role panels (/rolepanel create|add|remove), reaction roles, autoroles (humans/bots),
  /role add|remove|info, /temprole
- Welcome: welcome/leave text or embed with {user} {server} {count}, DM option, /welcome test,
  birthdays (/birthday set, daily post)
- Levels: XP per message w/ cooldown, Carl-like curve, /rank (image card, blue theme), /leaderboard,
  role rewards, level-up msg/channel, no-XP channels/roles, /xp give|set|reset
- Tags + triggers: /tag create|edit|delete|info|list|raw, /t <name>, vars {user} {args} {random:a|b};
  keyword/regex triggers -> text reply or reaction
- Utilities: /remind (+list/delete), /poll (native), /giveaway start|end|reroll, /userinfo /serverinfo
  /avatar /banner /roleinfo, /sticky set|remove, /embed (modal builder), /say
- Starboard: channel, emoji, threshold, self-star toggle
- Suggestions: /suggest, auto-thread + votes, /suggestion approve|deny|consider with reason
- Fun + games: /8ball /coinflip /roll /choose /rps /cat /dog /meme /ship /rate, trivia, tic-tac-toe (buttons)
- AI: /ask + @mention replies with website persona, short per-channel memory, per-user cooldown,
  per-channel admin toggle
- Dev notifications (webhooks only, signature-verified): GitHub workflow runs, PR opened/merged, releases;
  Jira issue created/transitioned/assigned
- PrizePicks: ported last as a module (/pp track|untrack|list), users.js -> DB
- Out of scope: feeds, game alerts, premium/perks, dashboard

## Senior Design module (approved)
Team: 7 members, 1 GitHub repo, 1 Jira Cloud project.
- /team link github:<login> jira:<email> maps Discord -> GitHub/Jira identities
- Standups: /standup config (time, days, channel); button -> modal (yesterday/today/blockers); compiled
  summary, flags missing members
- Meetings: /meeting create, RSVP buttons, reminders 1h/10m, weekly recurrence, Discord scheduled event
- Notes: /notes start opens thread; `- [ ] @user thing` lines become action items
- Deadlines: /deadline add|list|done, reminders 7d/2d/1d, auto-updating upcoming board
- Weekly digest (Friday): PRs/commits per member, Jira closed, deadlines, open action items, optional AI status paragraph
- /sprint: read-only Jira API token; active sprint todo/in progress/done, progress bar, assignees
- /progress [@member]: commits, PRs, issues closed, standup streak (stored webhook events + Jira)
- /link add|list, /decision record|search, /summarize (channel/thread since X, Gemini)

## Build order (approved)
SD-first so the team gets value this semester:
1 core, 2 webhooks (GitHub/Jira), 3 Senior Design, 4 AI, 5 moderation+logging, 6 automod, 7 roles,
8 welcome+levels, 9 tags+triggers, 10 utilities, 11 starboard+suggestions, 12 fun+games, 13 PrizePicks.

## Env vars (planned)
DISCORD_TOKEN, DISCORD_CLIENT_ID, DEV_GUILD_ID, DATABASE_URL, GEMINI_API_KEY, GITHUB_WEBHOOK_SECRET,
JIRA_WEBHOOK_SECRET, JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN (read-only), PORT, ENABLED_MODULES, OWNER_IDS
