# lobo brand assets

A Noto-style husky. Every SVG is filled paths with outlined text, so no font is needed.

- `discord/lobo-discord-avatar-transparent-1024.png`: the bot's Discord profile picture. Just the husky on a fully
  transparent background, scaled to fill Discord's circle crop without cutting off the ears or tail.
  `lobo-discord-avatar-transparent.svg` is its source.
- `svg/lobo-mark-*.svg`: the mark. `color` (navy badge) is the default on light backgrounds, `reversed` (no badge)
  is for dark ones, `black` and `white` are one-colour.
- `svg/lobo-lockup-horizontal-*.svg`, `svg/lobo-lockup-stacked-*.svg`: mark plus wordmark, same four variants.
  The README header uses the horizontal `color` lockup, and `reversed` in dark mode.
- `svg/lobo-app-icon.svg`, `png/lobo-app-icon-1024.png`: square app icon on the navy ground.
- `png/lobo-mark-color-512.png`, `png/lobo-mark-reversed-1024.png`: raster marks for places that don't take SVG.

## Palette

- Ground (badge, app icon): `#16213A`
- Coat (cap, back, ears, tail): `#6B7480`
- Mask, belly, legs: `#E9ECEF`
- Eyes, nose, mouth: `#2B2B2B`
- Wordmark on light backgrounds: `#1E2530`

Wordmark: Bricolage Grotesque Bold, lowercase, tracking -3%.

## Rules

- Don't put the badge-less mark on white or light backgrounds: the light grey face and legs disappear.
- Don't recolour, stretch, rotate, outline, or add shadows or gradients. Don't retype the wordmark.
