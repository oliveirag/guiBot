// PrizePicks' /v1/profiles/<id>/lineups is JSON:API: each `new_wager` in `data` points at `prediction`
// records in `included`, which point at their `projection` (the line) and `new_player`.

export interface SlipPick {
  player: string;
  team: string | null;
  direction: 'more' | 'less';
  line: number;
  stat: string;
  /** Opponent and period, like "NYL 1st Half". */
  context: string | null;
  startsAt: Date | null;
  /** standard, demon, or goblin. */
  oddsType: string;
}

export interface Slip {
  id: string;
  createdAt: Date;
  entryCents: number;
  toWinCents: number;
  multiplier: number | null;
  playType: 'Power Play' | 'Flex Play';
  freePlay: boolean;
  sport: string | null;
  picks: SlipPick[];
}

interface Resource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { type: string; id: string } | { type: string; id: string }[] | null }>;
}

const isResource = (x: unknown): x is Resource =>
  typeof x === 'object' && x !== null && typeof (x as Resource).type === 'string' && typeof (x as Resource).id === 'string';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const date = (v: unknown): Date | null => {
  const d = typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

function one(r: Resource | undefined, name: string): { type: string; id: string } | null {
  const data = r?.relationships?.[name]?.data;
  return data && !Array.isArray(data) ? data : null;
}

function many(r: Resource, name: string): { type: string; id: string }[] {
  const data = r.relationships?.[name]?.data;
  return Array.isArray(data) ? data : [];
}

/** Every open slip in a lineups response, oldest first. Anything malformed is skipped rather than thrown. */
export function parseLineups(raw: unknown): Slip[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const { data, included } = raw as { data?: unknown; included?: unknown };
  if (!Array.isArray(data)) return [];
  const index = new Map<string, Resource>();
  for (const r of Array.isArray(included) ? included : []) if (isResource(r)) index.set(`${r.type}:${r.id}`, r);
  const get = (ref: { type: string; id: string } | null) => (ref ? index.get(`${ref.type}:${ref.id}`) : undefined);

  const slips: Slip[] = [];
  for (const wager of data) {
    if (!isResource(wager) || wager.type !== 'new_wager') continue;
    const a = wager.attributes ?? {};
    const createdAt = date(a.created_at);
    if (!createdAt) continue;

    const picks: SlipPick[] = [];
    for (const ref of many(wager, 'predictions')) {
      const prediction = get(ref);
      const projection = get(one(prediction, 'projection'));
      const player = get(one(prediction, 'new_player') ?? one(projection, 'new_player'));
      const p = prediction?.attributes ?? {};
      const proj = projection?.attributes ?? {};
      const line = num(p.line_score) ?? num(proj.line_score);
      const name = str(player?.attributes?.display_name) ?? str(player?.attributes?.name);
      if (!prediction || line === null || !name) continue;
      picks.push({
        player: name,
        team: str(player?.attributes?.team),
        direction: p.wager_type === 'under' ? 'less' : 'more',
        line,
        stat: str(proj.stat_display_name) ?? str(proj.stat_type) ?? str(get(one(projection, 'stat_type'))?.attributes?.name) ?? 'stat',
        context: str(proj.description),
        startsAt: date(proj.start_time),
        oddsType: str(p.odds_type) ?? str(proj.odds_type) ?? 'standard',
      });
    }

    const payouts = typeof a.payouts === 'object' && a.payouts !== null ? (a.payouts as Record<string, { multiplier?: unknown }>) : {};
    const count = num(a.parlay_count) ?? picks.length;
    slips.push({
      id: wager.id,
      createdAt,
      entryCents: num(a.amount_bet_cents) ?? 0,
      toWinCents: num(a.amount_to_win_cents) ?? 0,
      multiplier: num(payouts[String(count)]?.multiplier),
      // Power pays only when every pick hits; flex also pays for fewer.
      playType: Object.keys(payouts).length > 1 ? 'Flex Play' : 'Power Play',
      freePlay: a.f2p === true,
      sport: str(a.sport),
      picks,
    });
  }
  return slips.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
}
