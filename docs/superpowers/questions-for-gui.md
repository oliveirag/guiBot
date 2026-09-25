# Questions for Gui

Decisions I made on my own while you were away. Each has the default I picked; tell me which to change.

## Deploy
- Nothing is pushed. Each module is a local commit on `main`. Push when you've looked (Railway redeploys on push).
- New Railway env: `GEMINI_API_KEY` (required for AI). Optional `GEMINI_MODEL` (default `gemini-2.5-flash`).
- After pushing, run `npm run deploy` (or however you deployed slash commands last time) so the new commands show up.

## AI
- Persona: your website prompt, trimmed to voice + a few facts, reframed as "guiBot, Gui's bot, talks like him but actually helps". Resume details left out. OK?
- AI is off in every channel by default. Turn on per channel with `/config ai channel`.
- Cooldown default 20s per user. Owners skip it.
- Uses Gemini REST directly (no SDK), thinking disabled for speed, max ~600 output tokens.
- `/ask` replies publicly and quotes the question on top. Mentions reply without pinging you back.

## Moderation + logs
- DMs on action are on by default (`/config mod dm`).
- Escalation fires once, exactly when active warns hit the threshold (not again at threshold+1). Default timeout 1h if you don't give a duration.
- `/lockdown on` locks every channel @everyone can currently talk in; `off` only unlocks those. No per-channel lockdown list. Want a fixed list instead?
- Log kinds: messages, members, roles (incl. nicknames), voice, modlog. No "ignored channels" setting yet. Need one?
- guiBot needs these Discord permissions for all of this: Ban Members, Kick Members, Moderate Members, Manage Messages, Manage Channels, Manage Roles, View Audit Log.

## Automod
- All rules off by default. Default limits: spam 5 msgs/5s, duplicates 3 in 30s, mentions 5, caps 70% (10+ letters), new accounts 7 days.
- Offenders get a short channel notice that deletes itself after 6s. Keep or drop?
- newaccount with action delete/warn only flags the join in the modlog; kick/timeout act on it.
- Message edits aren't re-checked (someone could edit a banned word in). Want that?

## Roles
- Panels have no "max picks" or "only one role" (unique) mode yet. Want exclusive panels (like color roles)?
- Temp roles live only as a scheduled job; there's no `/temprole list`. Fine?

## Welcome
- Join messages default to an embed; leave messages default to plain text. Default texts: "Welcome to **{server}**, {user}! You're member #{count}." / "**{username}** left. We're at {count} now."
- Birthdays have their own timezone setting (default America/New_York), separate from `/config sd timezone`. Merge them into one server timezone?
- Bots don't get welcome or leave messages.

## Suggestions
- Votes are buttons, not reactions, so each person gets one vote and counts can't be faked. `/suggest` has a 60s cooldown.
- No anonymous suggestions and no separate "reviewed suggestions" channel. Want either?
