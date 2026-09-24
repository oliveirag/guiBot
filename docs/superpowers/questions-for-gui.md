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
