// Snapshot-derived peer valuation and practical, category-specific plans for token-radar-01.
// The market anchor is calculated from this snapshot on every run; no protocol name is privileged.

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
  peer_multiple_min: number;
  peer_multiple_max: number;
  category_peer_min_samples: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  growth_weight: number;
  age_days_cap: number;
  age_base: number;
  age_range: number;
  unknown_age_adj: number;
  max_board_rows: number;
}

export const MODEL: ModelConstants = {
  peer_multiple_min: 0.02,
  peer_multiple_max: 25,
  category_peer_min_samples: 5,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  growth_weight: 0.35,
  age_days_cap: 1095,
  age_base: 0.7,
  age_range: 0.3,
  unknown_age_adj: 0.85,
  max_board_rows: 260,
};

export const MODEL_VERSION = 'snapshot-peer-median-1';

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
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  peer_median: number;
  peer_samples: number;
  peer_source: 'category' | 'all-market';
  growth_adj: number;
  age_adj: number;
  farm_steps: string[];
}

export interface PeerRow {
  category: string;
  sample_count: number;
  median_multiple: number;
  used_global_fallback: boolean;
  category_observed_median: number | null;
}

export interface TradingRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  mcap_over_tvl: number;
  rank: number;
}

export interface RadarRow extends BoardRow {}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  constants: ModelConstants;
  counts: {
    protocols: number;
    watchlist: number;
    pre_token: number;
    trading: number;
    board_rows: number;
  };
  peer_table: PeerRow[];
  top_5: Array<Pick<RadarRow, 'rank' | 'slug' | 'name' | 'category' | 'tvl_usd' | 'multiple' | 'implied_value_usd'>>;
  rows: RadarRow[];
  trading: TradingRow[];
  // Kept as convenient summary fields for clients that consumed the starter data shape.
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const MAX_BOARD_ROWS = 260;
const CATEGORY_FALLBACK = 'Uncategorized';

function categoryKey(category: string | null): string {
  return category?.trim() || CATEGORY_FALLBACK;
}

function isPositiveFinite(n: number | null): n is number {
  return n !== null && Number.isFinite(n) && n > 0;
}

/** A protocol is pre-token exactly when both token identifiers are absent in the frozen record. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** A usable market observation requires both positive market cap and positive TVL. */
function recordsTradingToken(p: SnapshotProtocol): p is SnapshotProtocol & { mcap_usd: number } {
  return isPositiveFinite(p.mcap_usd) && isPositiveFinite(p.tvl_usd);
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function roundTo(value: number, digits = 8): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Whole days since listing, clamped at zero. Invalid or absent dates produce null. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareChains(a: string[], b: string[]): number {
  return compareText(a.join('\u0000'), b.join('\u0000'));
}

function peerTable(snapshot: Snapshot, constants: ModelConstants): { rows: PeerRow[]; globalMedian: number } {
  const tokenProtocols = snapshot.protocols.filter(recordsTradingToken);
  const multiplesByCategory = new Map<string, number[]>();
  const allMultiples = tokenProtocols.map((p) => Math.min(constants.peer_multiple_max, Math.max(constants.peer_multiple_min, p.mcap_usd / p.tvl_usd)));
  for (const p of tokenProtocols) {
    const key = categoryKey(p.category);
    const values = multiplesByCategory.get(key) ?? [];
    values.push(Math.min(constants.peer_multiple_max, Math.max(constants.peer_multiple_min, p.mcap_usd / p.tvl_usd)));
    multiplesByCategory.set(key, values);
  }
  const globalMedian = median(allMultiples);
  const categories = new Set(snapshot.protocols.map((p) => categoryKey(p.category)));
  const rows = [...categories].sort(compareText).map((category) => {
    const observed = multiplesByCategory.get(category) ?? [];
    const observedMedian = observed.length > 0 ? median(observed) : null;
    const fallback = observed.length < constants.category_peer_min_samples;
    return {
      category,
      sample_count: observed.length,
      median_multiple: roundTo(fallback ? globalMedian : observedMedian!),
      used_global_fallback: fallback,
      category_observed_median: observedMedian === null ? null : roundTo(observedMedian),
    };
  });
  return { rows, globalMedian };
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function formatChange(change: number | null): string {
  if (change === null || !Number.isFinite(change)) return '7d change not reported';
  return `7d ${change >= 0 ? '+' : ''}${change}%`;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains[0] || 'the protocol app’s listed chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function gasBudget(chain: string, transactions = 1): string {
  const normalized = chain.toLowerCase();
  const perTransaction = normalized.includes('ethereum') ? 8 : normalized.includes('bitcoin') ? 3 : 1;
  return `$${perTransaction * transactions} estimated gas; check the live wallet quote`;
}

interface PlanActions {
  open: string;
  activity: string;
  maintain: string;
}

const CATEGORY_ACTIONS: Record<string, PlanActions> = {
  'dexs': {
    open: 'Swap $10 USDC for an asset in a liquid pool shown by the app, then add the remaining budget as a balanced USDC/paired-asset position.',
    activity: 'Make one small USDC swap in the app, then confirm the transaction and pool receipt are visible in the wallet.',
    maintain: 'Check pool composition and fees weekly; rebalance only if the displayed pair is still liquid and the price exposure is acceptable.',
  },
  'lending': {
    open: 'Supply the full budget as USDC in the app’s lending market; review utilization and withdrawal terms before confirming.',
    activity: 'Make a small additional USDC supply or repay a small amount, and verify the balance is attributed to the lending position.',
    maintain: 'Check borrow utilization and health weekly; do not borrow just to create activity, and keep a repayment buffer if borrowing.',
  },
  'cdp': {
    open: 'Use the app’s listed collateral asset, worth about half the budget, to open a conservatively collateralized position; do not mint to the maximum.',
    activity: 'Add a small amount of listed collateral or repay a small part of the debt, then verify the collateral ratio remains safely above liquidation.',
    maintain: 'Review collateral ratio and liquidation price weekly; keep spare funds available and avoid increasing debt when the ratio is tight.',
  },
  'perps': {
    open: 'Deposit USDC margin and open the smallest permitted, low-leverage position; set a stop or close price before submitting.',
    activity: 'Close the test position or make one small, deliberate trade; check funding and execution price rather than trading for volume.',
    maintain: 'Check funding, liquidation price and open orders daily; keep only a position whose maximum loss you can afford.',
  },
  'yield': {
    open: 'Deposit USDC into a listed, liquid yield product after checking its asset, withdrawal delay and strategy risks.',
    activity: 'Make one small additional deposit or withdrawal request and confirm the receipt balance and redemption route.',
    maintain: 'Review the displayed yield source and withdrawal queue weekly; do not treat a quoted APY as guaranteed income.',
  },
  'yield aggregator': {
    open: 'Choose a transparent USDC vault and deposit the budget only after checking underlying venues, fees and withdrawal conditions.',
    activity: 'Make a small deposit or claim/reinvest action if the app offers it, and verify the vault-share balance.',
    maintain: 'Check the vault’s allocation and withdrawal status weekly; exit if the underlying strategy or risk changes.',
  },
  'liquidity manager': {
    open: 'Deposit the budget into a listed USDC pool or managed range, checking its target range and rebalance fee first.',
    activity: 'Review the allocation and make one small deposit or rebalance only when the quoted fee is acceptable.',
    maintain: 'Check range placement and fees weekly; a managed position can still lose value through price movement or impermanent loss.',
  },
  'risk curators': {
    open: 'Select a curator vault with disclosed markets and deposit USDC only after checking its exposure limits and withdrawal queue.',
    activity: 'Make a small deposit or withdrawal request and confirm the shares and current allocation shown by the curator.',
    maintain: 'Review curator changes and market exposure weekly; leave if the strategy or risk limits no longer match your tolerance.',
  },
  'basis trading': {
    open: 'Deposit a small USDC amount into a disclosed basis strategy only after checking leverage, venues, funding and withdrawal terms.',
    activity: 'Use the app’s deposit or rebalance action only if its quoted fee and funding exposure are understood; avoid manual leverage.',
    maintain: 'Check basis, funding and venue exposure daily; withdraw if the displayed strategy changes or losses exceed your preset limit.',
  },
  'rwa': {
    open: 'Check jurisdiction and eligibility first, then buy the smallest available amount of the listed tokenized asset with USDC.',
    activity: 'Complete the app’s required investor verification or make a small eligible subscription, and save the receipt.',
    maintain: 'Review redemption windows, issuer disclosures and transfer restrictions weekly; do not assume the asset is instantly redeemable.',
  },
  'restaking': {
    open: 'Stake the smallest supported amount of the protocol’s listed underlying asset and inspect the unbonding and slashing terms.',
    activity: 'Make a small additional stake or use a supported delegation action, then verify the restaking receipt in your wallet.',
    maintain: 'Check operator exposure, slashing rules and withdrawal queue weekly; keep separate funds for gas and any unbonding period.',
  },
  'bridge': {
    open: 'Choose a route displayed by the app and bridge a small USDC test amount between supported networks before sending the rest.',
    activity: 'Complete one small supported bridge transfer and confirm finality on both the source and destination explorers.',
    maintain: 'Check route status and destination balance before any second transfer; never resend while the first message is pending.',
  },
  'farm': {
    open: 'Choose a currently listed farm with visible rewards and deposit USDC or the exact paired assets requested by that pool.',
    activity: 'Make one small deposit or claim/reinvest action and confirm the staking receipt and reward balance in the app.',
    maintain: 'Review reward token value, lock period and withdrawal fee weekly; stop if rewards no longer justify the risk and gas.',
  },
  'options': {
    open: 'Buy only the smallest defined-risk option position the app permits, using USDC and treating the full premium as money at risk.',
    activity: 'Use one small option buy or close action only after checking expiry, strike, spread and maximum premium loss.',
    maintain: 'Check expiry and liquidity daily; close before expiry if you do not intend to accept the option’s full loss risk.',
  },
  'insurance': {
    open: 'Select an eligible exposure and buy the smallest available cover after checking exclusions, premium, duration and claims process.',
    activity: 'Review policy details or make a small eligible cover purchase; save the coverage ID and renewal date.',
    maintain: 'Check that the covered position and policy remain valid weekly; pay no unofficial fee to claim or renew.',
  },
  'chain': {
    open: 'Use the chain’s official wallet route to stake a small amount of its supported native asset with a validator shown in the app.',
    activity: 'Make one small supported stake or governance action and verify the transaction on the chain’s official explorer.',
    maintain: 'Review validator status, commission and unbonding time weekly; keep enough native asset for future gas and exit.',
  },
  'prediction market': {
    open: 'Fund with a small USDC amount and take one minimum-sized position in a market whose rules and settlement source you understand.',
    activity: 'Place or close one small market position after checking liquidity, fees and resolution rules; do not trade to chase rewards.',
    maintain: 'Check the market’s resolution date and open exposure weekly; treat the full position amount as at risk.',
  },
  'launchpad': {
    open: 'Check whether a live offering exists and read eligibility and lock terms; if eligible, subscribe only at its stated minimum.',
    activity: 'Complete one required registration, vote or eligible subscription action and retain the official confirmation.',
    maintain: 'Check allocation, vesting and claim dates weekly; do not send funds to unofficial presale links or assume an allocation.',
  },
  'staking pool': {
    open: 'Stake a small amount of the exact asset listed by the pool and check validator, reward and unstaking terms first.',
    activity: 'Make a small additional stake or a supported delegation/vote action and verify the receipt token or position record.',
    maintain: 'Check reward rate and unbonding queue weekly; reserve the chain’s native asset for gas and exit transactions.',
  },
  'algo-stables': {
    open: 'Use a small USDC amount to mint or acquire the listed stable asset only after reviewing collateral, peg design and redemption rules.',
    activity: 'Make one small mint, repay or swap action and verify the stable asset remains redeemable through the official app.',
    maintain: 'Check peg, collateral health and redemption status daily; exit if the peg or collateral mechanism weakens.',
  },
  'synthetics': {
    open: 'Open the smallest fully collateralized synthetic position offered, using USDC and checking its oracle and liquidation rules.',
    activity: 'Make one small mint, burn or swap action and confirm collateral and exposure in the app before proceeding.',
    maintain: 'Review oracle status, collateral ratio and debt weekly; keep a buffer and close the position before its risk becomes unclear.',
  },
  'nft marketplace': {
    open: 'Inspect verified collections and fees, then list one low-value item you already own or make a small purchase you can afford to lose.',
    activity: 'Create one listing, cancel it, or complete a low-value sale through the verified marketplace contract and save the receipt.',
    maintain: 'Check listing status and royalty/settlement fees weekly; delist or exit if collection verification or liquidity changes.',
  },
};

function categoryActions(category: string | null): PlanActions {
  const key = (category ?? '').trim().toLowerCase();
  return CATEGORY_ACTIONS[key] ?? {
    open: 'Open the simplest listed USDC product with a small deposit, after checking the asset, permissions, fees and withdrawal route.',
    activity: 'Make one small supported deposit, swap, vote or repayment in the app, and verify the successful transaction in your wallet.',
    maintain: 'Review the position, contract permissions and withdrawal route weekly; do not add funds if the product’s risks are unclear.',
  };
}

function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const holdDays = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const context = `${p.name} reports ${formatUsd(p.tvl_usd)} TVL on ${chain}; ${formatChange(p.change_7d)}.`;
  const actions = categoryActions(p.category);
  const setupCost = gasBudget(chain);
  const openCost = gasBudget(chain, 2);
  const exitCost = gasBudget(chain, 2);
  return [
    `${context} Confirm the official app and contract, check supported assets and revoke unrelated approvals; use a separate wallet if practical. Cost: ${setupCost}. Time: 10 minutes.`,
    `Set a $${capital} maximum budget, then ${actions.open.charAt(0).toLowerCase()}${actions.open.slice(1)} Cost: $${capital} position capital plus ${openCost}. Time: 15 minutes.`,
    `For measurable activity, ${actions.activity.charAt(0).toLowerCase()}${actions.activity.slice(1)} Cost: $5 activity budget plus ${gasBudget(chain)}; confirm any fee before signing. Time: 10 minutes, once this week.`,
    `Keep the position open for ${holdDays} days only while its risks and exit route remain acceptable; check balances and protocol notices weekly. Cost: $${capital} remains exposed; budget $2 for checks/gas. Time: ${holdDays} days.`,
    `Exit by withdrawing or closing through the official app, verify the funds arrive, then revoke approvals you no longer need. Cost: ${exitCost} plus any displayed withdrawal fee. Time: 10–20 minutes.`,
  ];
}

interface ScoredProtocol {
  protocol: SnapshotProtocol;
  age: number | null;
  growthAdj: number;
  ageAdj: number;
  peerMedian: number;
  peerSamples: number;
  peerSource: 'category' | 'all-market';
  multiple: number;
  implied: number;
}

function buildTrading(snapshot: Snapshot): TradingRow[] {
  return snapshot.protocols.filter(recordsTradingToken)
    .sort((a, b) => b.mcap_usd - a.mcap_usd || b.tvl_usd - a.tvl_usd || compareText(a.slug, b.slug))
    .map((p, i) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      mcap_over_tvl: p.mcap_usd / p.tvl_usd,
      rank: i + 1,
    }));
}

function buildBoard(snapshot: Snapshot, peerRows: PeerRow[], constants: ModelConstants): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p) chosen.set(slug, p);
  }
  const room = Math.max(0, constants.max_board_rows - chosen.size);
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isPreToken(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || compareChains(a.chains, b.chains) || compareText(a.slug, b.slug))
    .slice(0, room);
  for (const p of early) chosen.set(p.slug, p);

  const peerByCategory = new Map(peerRows.map((row) => [row.category, row]));
  const scored: ScoredProtocol[] = [...chosen.values()].map((p) => {
    const peer = peerByCategory.get(categoryKey(p.category));
    const peerMedian = peer?.median_multiple ?? 1;
    const peerSamples = peer?.sample_count ?? 0;
    const peerSource = peer?.used_global_fallback ? 'all-market' : 'category';
    const rawChange = p.change_7d ?? 0;
    const clampedChange = Math.min(constants.growth_cap_pct, Math.max(constants.growth_floor_pct, rawChange));
    const growthAdj = 1 + (clampedChange / 100) * constants.growth_weight;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const ageAdj = age === null
      ? constants.unknown_age_adj
      : constants.age_base + constants.age_range * Math.min(age, constants.age_days_cap) / constants.age_days_cap;
    const multiple = peerMedian * growthAdj * ageAdj;
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
    return { protocol: p, age, growthAdj, ageAdj, peerMedian, peerSamples, peerSource, multiple, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || b.protocol.tvl_usd - a.protocol.tvl_usd || compareChains(a.protocol.chains, b.protocol.chains) || compareText(a.protocol.slug, b.protocol.slug));

  let previous = Number.POSITIVE_INFINITY;
  return scored.map((s, i) => {
    // Preserve the underlying formula, but make rounded board values strictly descending as required.
    const implied = Math.max(1, Math.min(s.implied, previous - 1));
    previous = implied;
    const p = s.protocol;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: implied,
      multiple: roundTo(s.multiple),
      peer_median: s.peerMedian,
      peer_samples: s.peerSamples,
      peer_source: s.peerSource,
      growth_adj: roundTo(s.growthAdj),
      age_adj: roundTo(s.ageAdj),
      farm_steps: farmSteps(p, s.age),
    };
  });
}

/** Build the complete ranked board plus snapshot-derived peer anchors and separate market observations. */
export function buildRadar(snapshot: Snapshot, constants: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { rows: peerRows } = peerTable(snapshot, constants);
  const board = buildBoard(snapshot, peerRows, constants);
  const trading = buildTrading(snapshot);
  const preTokenCount = snapshot.protocols.filter(isPreToken).length;
  const earlySize = board.filter((row) => !snapshot.watchlist.includes(row.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    constants,
    counts: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      pre_token: preTokenCount,
      trading: trading.length,
      board_rows: board.length,
    },
    peer_table: peerRows,
    top_5: board.slice(0, 5).map(({ rank, slug, name, category, tvl_usd, multiple, implied_value_usd }) => ({ rank, slug, name, category, tvl_usd, multiple, implied_value_usd })),
    rows: board,
    trading,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlySize,
    live_size: trading.length,
  };
  return { board, radar };
}

/** Parse and validate the frozen ten-field protocol snapshot. */
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
  if (!Array.isArray(o.watchlist) || o.watchlist.some((slug) => typeof slug !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((value, i) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((chain): chain is string => typeof chain === 'string') : [],
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

/** Return a concise gate failure, or null when the board meets its coverage and ranking invariants. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((row) => row.slug));
  if (slugs.size !== board.length) return 'the board repeats a protocol slug';
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows; expected 100..4000`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `row ${i + 1} has rank ${board[i]!.rank}, expected ${i + 1}`;
    if (!Number.isSafeInteger(board[i]!.implied_value_usd) || board[i]!.implied_value_usd <= 0) return `${board[i]!.slug} has invalid implied value ${board[i]!.implied_value_usd}`;
    if (i > 0 && board[i]!.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} is not strictly below row ${i} by implied value`;
    const steps = board[i]!.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${board[i]!.slug} has ${steps.length} farm steps`;
    for (const step of steps) if (step.length < 40 || step.length > 500) return `${board[i]!.slug} has a farm step of ${step.length} characters`;
  }
  return null;
}

/** The dashboard's data.js payload; it is self-contained and performs no network fetch. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
