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
  position_tvl_share: number;
  position_floor_usd: number;
  position_cap_usd: number;
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
  position_tvl_share: 0.0002,
  position_floor_usd: 100,
  position_cap_usd: 2500,
};

export const MODEL_VERSION = 'walk-forward-cell-median-2';

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
  size_bucket: string;
  fitted_multiple: number;
  feature_growth_band: 'falling' | 'flat' | 'rising';
  cell_samples: number;
  suggested_position_usd: number;
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

export interface ValidationMetrics {
  median_absolute_log_error: number;
  within_factor_two_share: number;
}

export interface SizeBucketValidation {
  label: string;
  log10_tvl_min: number | null;
  log10_tvl_max: number | null;
  fit_rows: number;
  holdout_rows: number;
  median_realised_multiple: number | null;
  median_fitted_multiple: number | null;
}

export interface ModelValidation {
  split_field: 'listed_at';
  split_date: string;
  fit_rows: number;
  holdout_rows: number;
  overall_fit_multiple: number;
  model: ValidationMetrics;
  naive: ValidationMetrics;
  verdict: 'beats' | 'trails';
  size_buckets: SizeBucketValidation[];
  method: {
    size_feature: 'log10(tvl_usd)';
    size_bucket_count: number;
    growth_bands: string[];
    flat_band_pct: number;
    minimum_cell_rows: number;
    cell_shrink_formula: string;
    category_shrink_formula: string;
  };
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
  validation: ModelValidation;
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

export interface FittedValueModel {
  peerRows: PeerRow[];
  validation: ModelValidation;
  predict: (protocol: SnapshotProtocol) => { multiple: number; sizeBucket: string; growthBand: 'falling' | 'flat' | 'rising'; cellSamples: number; categoryMedian: number; categorySamples: number };
}

/** Split token observations by listing date, validate the snapshot-feature predictor, then refit it on all token observations. */
export function fitAndValidateValueModel(snapshot: Snapshot, constants: ModelConstants = MODEL): FittedValueModel {
  const SIZE_BUCKET_COUNT = 4;
  const MIN_CELL_ROWS = 6;
  const FLAT_CHANGE_THRESHOLD_PCT = 1;
  const SHRINKAGE_PRIOR_ROWS = 6;
  const LOG_ERROR_BASE = Math.E;
  const allTokenRows = snapshot.protocols.filter(recordsTradingToken);
  const tokenRows = allTokenRows.filter((p): p is SnapshotProtocol & { mcap_usd: number; listed_at: string } =>
    p.listed_at !== null && Number.isFinite(Date.parse(p.listed_at)),
  ).sort((a, b) => compareText(a.listed_at, b.listed_at) || compareText(a.slug, b.slug));
  if (tokenRows.length < 4) throw new SnapshotError('walk-forward validation needs at least four listed token observations');
  const splitIndex = Math.floor(tokenRows.length / 2);
  const fitRows = tokenRows.slice(0, splitIndex);
  const holdoutRows = tokenRows.slice(splitIndex);
  const splitDate = tokenRows[splitIndex]!.listed_at;
  const growthBand = (change: number | null): 'falling' | 'flat' | 'rising' =>
    change !== null && change < -FLAT_CHANGE_THRESHOLD_PCT ? 'falling'
      : change !== null && change > FLAT_CHANGE_THRESHOLD_PCT ? 'rising' : 'flat';
  const logSize = (p: SnapshotProtocol): number => Math.log10(Math.max(p.tvl_usd, 1));
  const quantile = (values: number[], fraction: number): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    return sorted[lower]! + (sorted[Math.ceil(position)]! - sorted[lower]!) * (position - lower);
  };
  const bucketName = (index: number, edges: number[]): string =>
    `Size ${index + 1} · log10(TVL) ${edges[index]!.toFixed(2)}–${edges[index + 1]!.toFixed(2)}`;
  const fit = (training: Array<SnapshotProtocol & { mcap_usd: number }>) => {
    const logs = training.map(logSize);
    const minLog = Math.min(...logs);
    const maxLog = Math.max(...logs);
    const edges = Array.from({ length: SIZE_BUCKET_COUNT + 1 }, (_, i) => minLog + (maxLog - minLog) * i / SIZE_BUCKET_COUNT);
    const sizeIndex = (p: SnapshotProtocol): number => Math.min(SIZE_BUCKET_COUNT - 1,
      Math.max(0, Math.floor((logSize(p) - minLog) / ((maxLog - minLog) || 1) * SIZE_BUCKET_COUNT)));
    const overallMedian = median(training.map((p) => p.mcap_usd / p.tvl_usd));
    const byCategory = new Map<string, typeof training>();
    for (const p of training) byCategory.set(categoryKey(p.category), [...(byCategory.get(categoryKey(p.category)) ?? []), p]);
    const categoryValues = new Map<string, { median: number; samples: number }>();
    for (const [category, members] of byCategory) {
      const observedMedian = median(members.map((p) => p.mcap_usd / p.tvl_usd));
      const categoryWeight = members.length / (members.length + SHRINKAGE_PRIOR_ROWS);
      categoryValues.set(category, { median: observedMedian * categoryWeight + overallMedian * (1 - categoryWeight), samples: members.length });
    }
    const cells = new Map<string, typeof training>();
    const cellKey = (p: SnapshotProtocol): string => `${sizeIndex(p)}|${categoryKey(p.category)}|${growthBand(p.change_7d)}`;
    for (const p of training) cells.set(cellKey(p), [...(cells.get(cellKey(p)) ?? []), p]);
    const categoryPrior = (category: string): number => categoryValues.get(category)?.median ?? overallMedian;
    const predict = (p: SnapshotProtocol) => {
      const index = sizeIndex(p);
      const members = cells.get(cellKey(p)) ?? [];
      const category = categoryKey(p.category);
      const prior = categoryPrior(category);
      const cellMedian = members.length ? median(members.map((member) => member.mcap_usd / member.tvl_usd)) : prior;
      const cellWeight = members.length >= MIN_CELL_ROWS ? 1 : members.length / MIN_CELL_ROWS;
      return {
        multiple: cellMedian * cellWeight + prior * (1 - cellWeight),
        sizeBucket: bucketName(index, edges),
        growthBand: growthBand(p.change_7d),
        cellSamples: members.length,
        categoryMedian: prior,
        categorySamples: categoryValues.get(category)?.samples ?? 0,
      };
    };
    return { edges, sizeIndex, overallMedian, categoryValues, predict };
  };
  const validationFit = fit(fitRows);
  const validationPredict = (p: SnapshotProtocol): number => validationFit.predict(p).multiple;
  const summarizeErrors = (evaluate: (p: typeof holdoutRows[number]) => number): ValidationMetrics => {
    const logErrors = holdoutRows.map((p) => Math.abs(Math.log(evaluate(p) / (p.mcap_usd / p.tvl_usd)) / Math.log(LOG_ERROR_BASE)));
    return {
      median_absolute_log_error: roundTo(median(logErrors)),
      within_factor_two_share: roundTo(holdoutRows.filter((p) => {
        const ratio = evaluate(p) / (p.mcap_usd / p.tvl_usd);
        return ratio >= 0.5 && ratio <= 2;
      }).length / holdoutRows.length, 6),
    };
  };
  const modelMetrics = summarizeErrors(validationPredict);
  const naiveMetrics = summarizeErrors(() => validationFit.overallMedian);
  const holdoutBucketStats = new Map<number, { realized: number[]; predicted: number[] }>();
  for (const p of holdoutRows) {
    const bucket = validationFit.sizeIndex(p);
    const stats = holdoutBucketStats.get(bucket) ?? { realized: [], predicted: [] };
    stats.realized.push(p.mcap_usd / p.tvl_usd);
    stats.predicted.push(validationPredict(p));
    holdoutBucketStats.set(bucket, stats);
  }
  const sizeBuckets: SizeBucketValidation[] = Array.from({ length: SIZE_BUCKET_COUNT }, (_, index) => {
    const stats = holdoutBucketStats.get(index);
    const fitCount = fitRows.filter((p) => validationFit.sizeIndex(p) === index).length;
    return {
      label: bucketName(index, validationFit.edges),
      log10_tvl_min: roundTo(validationFit.edges[index]!),
      log10_tvl_max: roundTo(validationFit.edges[index + 1]!),
      fit_rows: fitCount,
      holdout_rows: stats?.realized.length ?? 0,
      median_realised_multiple: stats ? roundTo(median(stats.realized)) : null,
      median_fitted_multiple: stats ? roundTo(median(stats.predicted)) : null,
    };
  });
  const fullFit = fit(allTokenRows);
  const categories = new Set(snapshot.protocols.map((p) => categoryKey(p.category)));
  const peerRows = [...categories].sort(compareText).map((category) => {
    const observed = tokenRows.filter((p) => categoryKey(p.category) === category).map((p) => p.mcap_usd / p.tvl_usd);
    const observedMedian = observed.length ? median(observed) : null;
    const categorySamples = fullFit.categoryValues.get(category)?.samples ?? 0;
    return {
      category,
      sample_count: categorySamples,
      median_multiple: roundTo(fullFit.categoryValues.get(category)?.median ?? fullFit.overallMedian),
      used_global_fallback: categorySamples === 0,
      category_observed_median: observedMedian === null ? null : roundTo(observedMedian),
    };
  });
  return {
    peerRows,
    validation: {
      split_field: 'listed_at',
      split_date: splitDate,
      fit_rows: fitRows.length,
      holdout_rows: holdoutRows.length,
      overall_fit_multiple: roundTo(validationFit.overallMedian),
      model: modelMetrics,
      naive: naiveMetrics,
      verdict: modelMetrics.median_absolute_log_error <= naiveMetrics.median_absolute_log_error ? 'beats' : 'trails',
      size_buckets: sizeBuckets,
      method: {
        size_feature: 'log10(tvl_usd)',
        size_bucket_count: SIZE_BUCKET_COUNT,
        growth_bands: ['falling', 'flat', 'rising'],
        flat_band_pct: FLAT_CHANGE_THRESHOLD_PCT,
        minimum_cell_rows: MIN_CELL_ROWS,
        cell_shrink_formula: 'cell weight = min(1, cell rows / 6); remainder goes to category prior',
        category_shrink_formula: 'category weight = category fit rows / (category fit rows + 6); remainder goes to fit-set overall median',
      },
    },
    predict: fullFit.predict,
  };
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

function capitalFor(p: SnapshotProtocol, constants: ModelConstants): number {
  const rawPosition = p.tvl_usd * constants.position_tvl_share;
  const readablePosition = Math.round(rawPosition / 50) * 50;
  return Math.min(constants.position_cap_usd, Math.max(constants.position_floor_usd, readablePosition));
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

function farmSteps(p: SnapshotProtocol, age: number | null, constants: ModelConstants): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p, constants);
  const position = `$${capital.toLocaleString('en-US')}`;
  const holdDays = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const chainContext = p.chains.length > 2 ? `${p.chains.slice(0, 2).join(', ')} +${p.chains.length - 2} chains` : p.chains.join(', ') || chain;
  const context = `${p.name}: ${formatUsd(p.tvl_usd)} TVL; ${chainContext}; ${formatChange(p.change_7d)}.`;
  const concise = (text: string, limit: number): string => text.length <= limit ? text : `${text.slice(0, limit - 1).replace(/\s+\S*$/, '')}…`;
  const actions = categoryActions(p.category);
  const setupCost = gasBudget(chain);
  const openCost = gasBudget(chain, 2);
  const exitCost = gasBudget(chain, 2);
  return [
    `${context} Suggested single-position size ${position}: 0.02% of TVL, rounded to $50, floored at $100 and capped at $2,500; use this limit, not a generic deposit. Cost: ${position} reserved capital plus ${setupCost}. Time: 10 minutes.`,
    `On ${chain}, ${concise(actions.open.charAt(0).toLowerCase() + actions.open.slice(1), 125)} Keep ${p.name} exposure within the same ${position} cap. Cost: ${position} capital plus ${openCost}. Time: 15 minutes.`,
    `${p.name} ${formatUsd(p.tvl_usd)} TVL · ${formatChange(p.change_7d)}: ${concise(actions.activity.charAt(0).toLowerCase() + actions.activity.slice(1), 115)}; use the same ${position} exposure cap. Cost: reuse ${position} plus ${gasBudget(chain)}. Time: 10 minutes this week.`,
    `Hold at most ${position} in ${p.name} for ${holdDays} days; snapshot ${formatUsd(p.tvl_usd)} TVL, ${chainContext}, ${formatChange(p.change_7d)}. Review the position and exit route weekly. Cost: ${position} exposed; checks ${gasBudget(chain)}. Time: ${holdDays} days.`,
    `Exit ${p.name} through its official app, withdraw the same ${position} cap, verify receipt, then revoke unused approvals; allow for the withdrawal queue. Cost: release ${position}; exit ${exitCost} plus any displayed withdrawal fee. Time: 10–20 minutes.`,
  ].map((step) => step.length <= 500 ? step : `${concise(step.slice(0, step.indexOf(' Cost:')), 190)} ${step.slice(step.indexOf('Cost:'))}`);
}

interface ScoredProtocol {
  protocol: SnapshotProtocol;
  age: number | null;
  growthAdj: number;
  ageAdj: number;
  peerMedian: number;
  peerSamples: number;
  peerSource: 'category' | 'all-market';
  sizeBucket: string;
  fittedMultiple: number;
  growthBand: 'falling' | 'flat' | 'rising';
  cellSamples: number;
  multiple: number;
  implied: number;
  suggestedPosition: number;
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

function buildBoard(snapshot: Snapshot, fitted: FittedValueModel, constants: ModelConstants): BoardRow[] {
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

  const scored: ScoredProtocol[] = [...chosen.values()].map((p) => {
    const prediction = fitted.predict(p);
    const peerMedian = prediction.categoryMedian;
    const peerSamples = prediction.categorySamples;
    const peerSource = prediction.categorySamples > 0 ? 'category' : 'all-market';
    const rawChange = p.change_7d ?? 0;
    const clampedChange = Math.min(constants.growth_cap_pct, Math.max(constants.growth_floor_pct, rawChange));
    const growthAdj = 1 + (clampedChange / 100) * constants.growth_weight;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const ageAdj = age === null
      ? constants.unknown_age_adj
      : constants.age_base + constants.age_range * Math.min(age, constants.age_days_cap) / constants.age_days_cap;
    const multiple = prediction.multiple * growthAdj * ageAdj;
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
    return {
      protocol: p, age, growthAdj, ageAdj, peerMedian, peerSamples, peerSource, multiple, implied,
      sizeBucket: prediction.sizeBucket, fittedMultiple: prediction.multiple,
      growthBand: prediction.growthBand, cellSamples: prediction.cellSamples,
      suggestedPosition: capitalFor(p, constants),
    };
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
      peer_median: roundTo(s.peerMedian),
      peer_samples: s.peerSamples,
      size_bucket: s.sizeBucket,
      fitted_multiple: roundTo(s.fittedMultiple),
      feature_growth_band: s.growthBand,
      cell_samples: s.cellSamples,
      suggested_position_usd: s.suggestedPosition,
      peer_source: s.peerSource,
      growth_adj: roundTo(s.growthAdj),
      age_adj: roundTo(s.ageAdj),
      farm_steps: farmSteps(p, s.age, constants),
    };
  });
}

/** Build the complete ranked board plus snapshot-derived peer anchors and separate market observations. */
export function buildRadar(snapshot: Snapshot, constants: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fitted = fitAndValidateValueModel(snapshot, constants);
  const peerRows = fitted.peerRows;
  const board = buildBoard(snapshot, fitted, constants);
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
    validation: fitted.validation,
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
