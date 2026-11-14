// Token Radar — model radar-2.
//
// One sealed snapshot in, one ranked board out. The board ranks every protocol
// that records no token and is not a wrapped, staked, bridged or versioned
// product of one that trades: the snapshot's 40-protocol watchlist (the floor,
// never the ceiling) plus every other rankable pre-token protocol below it,
// 198 rows in this snapshot. Live-token protocols are never ranked; they are
// the market's own evidence, kept apart in the dashboard's Live view.
//
// IMPLIED VALUE — computed from the snapshot's own figures, never from a
// hand-kept list of names. The same function scores every protocol:
//
//   peerMultiple(category)
//       = median(mcap_usd / tvl_usd) over the snapshot's live-token peers in
//         the same category (n >= 4 peers), clamped to [0.10, 0.60];
//         categories with fewer peers use the global peer median instead.
//         (This snapshot: global median ~0.24; Lending ~0.13, Dexs ~0.34,
//         RWA ~0.28, Basis Trading and Bridges ~0.55-0.60 after clamping.)
//   growthMult   = 1 + clamp(change_7d, -50, +100) / 100 * 0.6
//   maturityMult = 0.70 + min(age_days, 1095) / 1095 * 0.30
//                  (age from listed_at to as_of; unknown age counts as 365d)
//   breadthMult  = 1 + 0.01 * min(chains - 1, 10)   (multi-chain footprint)
//   implied      = max(1, round(tvl_usd * peer * growth * maturity * breadth))
//
// Why this shape: a token launch is priced by the market like the tokens of
// protocols that already trade, so the peer multiple is the anchor; TVL is
// the size; 7-day growth rewards momentum and punishes shrinkage; age with
// no token rewards a long, proven run (pent-up launch value); chain breadth
// rewards distribution. A protocol whose token already trades can never
// outrank a pre-token one here, because it is never scored at all.
//
// FARM PLANS — generated from the protocol's own record (category, chains,
// TVL, age): capital sized to TVL, hold length sized to age, the core action
// matched to the category, every step carrying what it costs and how long
// it takes. No name is ever special-cased.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  peer_min_peers: number;
  peer_floor: number;
  peer_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  peer_min_peers: 4,
  peer_floor: 0.1,
  peer_cap: 0.6,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.01,
  breadth_max_chains: 10,
};

export const MODEL_VERSION = 'radar-2';

export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface PeerRow {
  category: string;
  peers: number;
  median_multiple: number;
  applied_multiple: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  model_note: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
  peers: PeerRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Live-token peers: protocols that record a token and a market cap. */
export function livePeers(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
}

/**
 * The peer multiple for a category: the median mcap/TVL of live peers in that
 * category when at least `peer_min_peers` exist, else the global peer median.
 * Clamped to [peer_floor, peer_cap] so a thin category cannot explode the board.
 */
export function peerMultiple(
  category: string | null,
  peers: SnapshotProtocol[],
  model: ModelConstants,
): { multiple: number; count: number; global: number } {
  const global = clamp(median(peers.map((p) => p.mcap_usd! / p.tvl_usd)), model.peer_floor, model.peer_cap);
  const mine = peers.filter((p) => (p.category ?? null) === category);
  if (mine.length >= model.peer_min_peers) {
    return {
      multiple: clamp(median(mine.map((p) => p.mcap_usd! / p.tvl_usd)), model.peer_floor, model.peer_cap),
      count: mine.length,
      global,
    };
  }
  return { multiple: global, count: mine.length, global };
}

/** The peer table the dashboard's methodology section renders. */
export function peerTable(snapshot: Snapshot, model: ModelConstants = MODEL): PeerRow[] {
  const peers = livePeers(snapshot);
  const cats = [...new Set(snapshot.protocols.map((p) => p.category ?? 'Uncategorised'))].sort();
  return cats
    .map((category) => {
      const mine = peers.filter((p) => (p.category ?? 'Uncategorised') === category);
      const pm = peerMultiple(category === 'Uncategorised' ? null : category, peers, model);
      return {
        category,
        peers: mine.length,
        median_multiple: mine.length > 0 ? Math.round(median(mine.map((p) => p.mcap_usd! / p.tvl_usd)) * 1000) / 1000 : 0,
        applied_multiple: Math.round(pm.multiple * 1000) / 1000,
      };
    })
    .filter((r) => r.peers > 0 || r.applied_multiple > 0);
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: SnapshotProtocol[],
  model: ModelConstants,
): { implied: number; peer: number; peerCount: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple: peer, count: peerCount } = peerMultiple(protocol.category, peers, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peer * growthMult * maturityMult * breadthMult));
  return { implied, peer, peerCount, growthPct, growthMult, maturityMult, breadthMult, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose product is a wrapped, staked or bridged form of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names: a protocol beginning with one is that exchange's product, not a launch of its own. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Rankable: pre-token AND not a wrapped, staked or bridged product of a token
 * that already trades — the watchlist's own rule, applied to every row, not
 * just the 40 above the floor. Without it the board's top would be WBTC,
 * Binance staked ETH and USDT0: Bitcoin, ETH and USDT in another wrapper,
 * none of them a protocol still waiting on a launch of its own.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const peers = livePeers(snapshot);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, whatever its TVL.
  // The watchlist is the floor; the early rows are the radar's whole point.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, peers, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: s.peer,
      peer_count: s.peerCount,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it so both sides of the position are active.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in the pair it lists first, and keep the position in range.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside the destination app it points to.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, then close it the same week.`;
  if (c.includes('prediction')) return `Fund ${name} with $${capital} on ${chain} and place one small position on a market that settles within the week.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares instead of withdrawing them.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the wallet that minted it.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it so the yield accrues to your wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full cover period.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Deposit $${capital} into ${name}'s highest-TVL strategy on ${chain} and let the yield compound in the position.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to the ${name} chain and use it in two of the chain's native apps so the wallet shows real activity.`;
  if (c.includes('payment')) return `Receive or spend $${capital} through ${name} on ${chain} for a real payment, then keep a balance in the wallet.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote in its next governance round from the same wallet.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open so the wallet shows a live balance.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const gas = capital >= 150 ? 8 : 4;
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm with, and keep its seed phrase offline on paper.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: action, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    {
      text: second
        ? `Repeat the same position on ${second} as well, so the wallet is active on two of the protocol's chains instead of one.`
        : `Make one more qualifying action on ${chain} this week, such as a swap, a second deposit or a vote.`,
      cost: 'about $2 of gas',
      time: '10 minutes a week',
    },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not withdraw early.`, cost: `the $${capital} stays locked in the position`, time: `${hold} days` },
    { text: `Once a week, do one small real action — a deposit, a borrow, a swap or a vote — and keep a note of the transaction hash.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Before you withdraw anything, open the protocol's own points or rewards page from the link it publishes, and claim only there.`, cost: 'no fee to check, and never pay anyone to claim', time: '10 minutes' },
    { text: `Log the wallet, the dates and every transaction, and remember the token may never launch: only farm money you can afford to lose.`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    on_watchlist: row.on_watchlist,
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    model_note:
      'implied = TVL x peer multiple (median mcap/TVL of live-token peers in the same category, n>=4, clamped 0.10-0.60, else the global peer median) x growth (7d change clamped -50..+100%, weight 0.6) x maturity (0.70-1.00 by age up to 3y) x breadth (1% per extra chain, max 10). No protocol name is special-cased; every figure comes from the sealed snapshot.',
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
    rows: board.map(radarRow),
    live,
    peers: peerTable(snapshot, model),
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
