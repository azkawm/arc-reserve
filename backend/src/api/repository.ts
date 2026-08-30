import type { Database } from '../db/client.js';
import type { CursorPosition } from './envelope.js';

/**
 * Every read the API makes against the projections. Parameterised SQL only; no query is
 * assembled from request data beyond a fixed column allowlist.
 */

export interface AssetRow {
  asset_id: string;
  issuer: string;
  name: string;
  symbol: string | null;
  category: string;
  metadata_uri: string;
  metadata_hash: string;
  maturity_timestamp: bigint;
  status: number;
  current_nav: string | null;
  nav_updated_at: bigint | null;
  submitted_at: bigint;
}

export interface DeploymentRow {
  asset_id: string;
  token: string;
  vault: string;
  offering: string;
  market_manager: string;
  revenue_distributor: string;
  redemption_controller: string;
  pool: string | null;
}

export async function loadCursor(db: Database, chainId: number): Promise<CursorPosition | null> {
  const row = await db.maybe<{
    block_number: bigint;
    block_hash: string;
    block_timestamp: bigint;
  }>(
    `SELECT block_number, block_hash, block_timestamp FROM indexer_cursors
      WHERE chain_id = $1 AND worker = 'arc-events'`,
    [chainId],
  );
  return row === null
    ? null
    : {
        blockNumber: row.block_number,
        blockHash: row.block_hash,
        blockTimestamp: row.block_timestamp,
      };
}

export async function listAssetRows(
  db: Database,
  chainId: number,
  options: { status?: number; limit: number; cursor?: string },
): Promise<AssetRow[]> {
  const params: unknown[] = [chainId, options.limit];
  let where = 'a.chain_id = $1';

  if (options.status !== undefined) {
    params.push(options.status);
    where += ` AND a.status = $${params.length}`;
  }
  if (options.cursor !== undefined) {
    params.push(options.cursor);
    where += ` AND a.asset_id > $${params.length}`;
  }

  const { rows } = await db.query<AssetRow>(
    `SELECT a.asset_id, a.issuer, a.name, a.symbol, a.category, a.metadata_uri, a.metadata_hash,
            a.maturity_timestamp, a.status, a.current_nav::text, a.nav_updated_at, a.submitted_at
       FROM assets a
      WHERE ${where}
      ORDER BY a.asset_id
      LIMIT $2`,
    params,
  );
  return rows;
}

export async function getAssetRow(
  db: Database,
  chainId: number,
  assetId: string,
): Promise<AssetRow | null> {
  return db.maybe<AssetRow>(
    `SELECT asset_id, issuer, name, symbol, category, metadata_uri, metadata_hash,
            maturity_timestamp, status, current_nav::text, nav_updated_at, submitted_at
       FROM assets WHERE chain_id = $1 AND asset_id = $2`,
    [chainId, assetId],
  );
}

export async function getDeployment(
  db: Database,
  chainId: number,
  assetId: string,
): Promise<DeploymentRow | null> {
  return db.maybe<DeploymentRow>(
    `SELECT asset_id, token, vault, offering, market_manager, revenue_distributor,
            redemption_controller, pool
       FROM asset_deployments WHERE chain_id = $1 AND asset_id = $2`,
    [chainId, assetId],
  );
}

export async function getDeployments(
  db: Database,
  chainId: number,
  assetIds: string[],
): Promise<Map<string, DeploymentRow>> {
  if (assetIds.length === 0) return new Map();
  const { rows } = await db.query<DeploymentRow>(
    `SELECT asset_id, token, vault, offering, market_manager, revenue_distributor,
            redemption_controller, pool
       FROM asset_deployments WHERE chain_id = $1 AND asset_id = ANY($2)`,
    [chainId, assetIds],
  );
  return new Map(rows.map((row) => [row.asset_id, row]));
}

export async function getVaultBalances(
  db: Database,
  chainId: number,
  vault: string,
): Promise<Record<string, string> | null> {
  return db.maybe<Record<string, string>>(
    `SELECT redemption_reserve::text, market_making_allocation::text, asset_revenue::text,
            issuer_proceeds::text, protocol_fees::text, total_accounted::text
       FROM vault_balances WHERE chain_id = $1 AND vault = $2`,
    [chainId, vault],
  );
}

export interface NavHistoryRow {
  nav_timestamp: bigint;
  new_nav: string;
  previous_nav: string;
  transaction_hash: string;
}

export async function getNavHistory(
  db: Database,
  chainId: number,
  assetId: string,
  options: { from?: number; to?: number; limit: number },
): Promise<NavHistoryRow[]> {
  const params: unknown[] = [chainId, assetId, options.limit];
  let where = 'chain_id = $1 AND asset_id = $2';

  if (options.from !== undefined) {
    params.push(options.from);
    where += ` AND nav_timestamp >= $${params.length}`;
  }
  if (options.to !== undefined) {
    params.push(options.to);
    where += ` AND nav_timestamp <= $${params.length}`;
  }

  const { rows } = await db.query<NavHistoryRow>(
    `SELECT nav_timestamp, new_nav::text, previous_nav::text, transaction_hash
       FROM nav_history WHERE ${where}
      ORDER BY block_number DESC, log_index DESC
      LIMIT $3`,
    params,
  );
  return rows;
}

export interface PositionActionRow {
  kind: number;
  action: string;
  block_timestamp: bigint;
  transaction_hash: string;
}

/** The most recent action per position kind, for the `lastAction` field. */
export async function getLastPositionActions(
  db: Database,
  chainId: number,
  marketManager: string,
): Promise<Map<number, PositionActionRow>> {
  const { rows } = await db.query<PositionActionRow>(
    `SELECT DISTINCT ON (kind) kind, action, block_timestamp, transaction_hash
       FROM position_liquidity_events
      WHERE chain_id = $1 AND market_manager = $2
      ORDER BY kind, block_number DESC, log_index DESC`,
    [chainId, marketManager],
  );
  return new Map(rows.map((row) => [row.kind, row]));
}

export interface RevenueDepositRow {
  block_timestamp: bigint;
  transaction_hash: string;
  period_id: string | null;
  report_hash: string | null;
  behind_schedule: boolean | null;
  gross_amount: string;
  holder_amount: string;
  reserve_amount: string;
  operator_amount: string;
  protocol_amount: string;
}

export async function getRevenueDeposits(
  db: Database,
  chainId: number,
  assetId: string,
  limit: number,
): Promise<RevenueDepositRow[]> {
  const { rows } = await db.query<RevenueDepositRow>(
    `SELECT block_timestamp, transaction_hash, period_id::text, report_hash, behind_schedule,
            gross_amount::text, holder_amount::text, reserve_amount::text,
            operator_amount::text, protocol_amount::text
       FROM revenue_deposits WHERE chain_id = $1 AND asset_id = $2
      ORDER BY block_number DESC, log_index DESC LIMIT $3`,
    [chainId, assetId, limit],
  );
  return rows;
}

export async function getRevenueTotals(
  db: Database,
  chainId: number,
  assetId: string,
): Promise<Record<string, string>> {
  return db.one<Record<string, string>>(
    `SELECT COALESCE(SUM(gross_amount), 0)::text AS gross,
            COALESCE(SUM(holder_amount), 0)::text AS holder,
            COALESCE(SUM(reserve_amount), 0)::text AS reserve,
            COALESCE(SUM(operator_amount), 0)::text AS operator,
            COALESCE(SUM(protocol_amount), 0)::text AS protocol
       FROM revenue_deposits WHERE chain_id = $1 AND asset_id = $2`,
    [chainId, assetId],
  );
}

export interface RedemptionRow {
  block_timestamp: bigint;
  transaction_hash: string;
  holder: string;
  mode: number;
  token_amount: string;
  stablecoin_amount: string;
  nav: string;
  redemption_price: string;
}

export async function getRedemptions(
  db: Database,
  chainId: number,
  assetId: string,
  limit: number,
): Promise<RedemptionRow[]> {
  const { rows } = await db.query<RedemptionRow>(
    `SELECT block_timestamp, transaction_hash, holder, mode, token_amount::text,
            stablecoin_amount::text, nav::text, redemption_price::text
       FROM redemptions WHERE chain_id = $1 AND asset_id = $2
      ORDER BY block_number DESC, log_index DESC LIMIT $3`,
    [chainId, assetId, limit],
  );
  return rows;
}

export interface HolderRow {
  balance: string;
  yield_excluded: boolean;
  issuer_allocation: boolean;
  compliance_exempt: boolean;
  frozen: boolean;
  frozen_tokens: string;
}

export async function getHolder(
  db: Database,
  chainId: number,
  token: string,
  holder: string,
): Promise<HolderRow | null> {
  return db.maybe<HolderRow>(
    `SELECT balance::text, yield_excluded, issuer_allocation, compliance_exempt, frozen,
            frozen_tokens::text
       FROM token_balances WHERE chain_id = $1 AND token = $2 AND holder = $3`,
    [chainId, token, holder],
  );
}

export interface IdentityRow {
  country: number | null;
  investor_class: number | null;
  claim_expires_at: bigint | null;
  registered: boolean;
}

export async function getIdentity(
  db: Database,
  chainId: number,
  investor: string,
): Promise<IdentityRow | null> {
  return db.maybe<IdentityRow>(
    `SELECT country, investor_class, claim_expires_at, registered
       FROM identities WHERE chain_id = $1 AND investor = $2
      ORDER BY updated_block DESC LIMIT 1`,
    [chainId, investor],
  );
}

export async function getPurchasedByWallet(
  db: Database,
  chainId: number,
  assetId: string,
  buyer: string,
): Promise<string> {
  const row = await db.one<{ total: string }>(
    `SELECT COALESCE(SUM(stablecoin_amount), 0)::text AS total
       FROM offering_purchases WHERE chain_id = $1 AND asset_id = $2 AND buyer = $3`,
    [chainId, assetId, buyer],
  );
  return row.total;
}

export interface RawLogRow {
  block_number: bigint;
  block_timestamp: bigint;
  transaction_hash: string;
  log_index: number;
  address: string;
  event_name: string | null;
  contract_name: string | null;
  decoded: Record<string, unknown> | null;
}

/**
 * The activity feed reads the log archive rather than unioning nine projection tables.
 * `raw_logs` is complete by construction — including the annotation events (reserve
 * deposits, market funding) that have no aggregate of their own — so the timeline cannot
 * silently omit an event type that nobody remembered to add to a UNION.
 */
export async function getAssetLogs(
  db: Database,
  chainId: number,
  addresses: string[],
  options: { limit: number; actor?: string; before?: { block: bigint; logIndex: number } },
): Promise<RawLogRow[]> {
  const params: unknown[] = [chainId, addresses, options.limit];
  let where = 'r.chain_id = $1 AND r.address = ANY($2) AND r.event_name IS NOT NULL';

  if (options.before !== undefined) {
    params.push(options.before.block.toString(), options.before.logIndex);
    where += ` AND (r.block_number, r.log_index) < ($${params.length - 1}::bigint, $${params.length}::int)`;
  }

  if (options.actor !== undefined) {
    // Topic match: an indexed address argument is the 32-byte left-padded address.
    params.push(`0x${'0'.repeat(24)}${options.actor.replace(/^0x/, '')}`);
    where += ` AND $${params.length} IN (r.topic1, r.topic2, r.topic3)`;
  }

  const { rows } = await db.query<RawLogRow>(
    `SELECT r.block_number, b.timestamp AS block_timestamp, r.transaction_hash, r.log_index,
            r.address, r.event_name, r.contract_name, r.decoded
       FROM raw_logs r
       JOIN indexed_blocks b ON b.chain_id = r.chain_id AND b.number = r.block_number
      WHERE ${where}
      ORDER BY r.block_number DESC, r.log_index DESC
      LIMIT $3`,
    params,
  );
  return rows;
}

export interface CandleRow {
  bucket_start: bigint;
  open_raw: string;
  high_raw: string;
  low_raw: string;
  close_raw: string;
  volume_asset_raw: string;
  volume_stable_raw: string;
  trade_count: number;
  finalized: boolean;
  source: string;
}

/**
 * Which source already owns this series. `canonical_swap` wins: once a real swap has been
 * indexed the synthetic feed must never write over it.
 */
export async function getCandleSource(
  db: Database,
  chainId: number,
  pool: string,
  interval: number,
): Promise<'canonical_swap' | 'mock' | null> {
  const row = await db.maybe<{ source: string }>(
    `SELECT source FROM candles
      WHERE chain_id = $1 AND pool = $2 AND interval_seconds = $3
      ORDER BY (source = 'canonical_swap') DESC
      LIMIT 1`,
    [chainId, pool, interval],
  );
  if (row === null) return null;
  return row.source === 'canonical_swap' ? 'canonical_swap' : 'mock';
}

export async function getCandles(
  db: Database,
  chainId: number,
  pool: string,
  options: { interval: number; from?: number; to?: number; limit: number },
): Promise<CandleRow[]> {
  const params: unknown[] = [chainId, pool, options.interval, options.limit];
  let where = 'chain_id = $1 AND pool = $2 AND interval_seconds = $3';

  if (options.from !== undefined) {
    params.push(options.from);
    where += ` AND bucket_start >= $${params.length}`;
  }
  if (options.to !== undefined) {
    params.push(options.to);
    where += ` AND bucket_start <= $${params.length}`;
  }

  const { rows } = await db.query<CandleRow>(
    `SELECT bucket_start, open_raw::text, high_raw::text, low_raw::text, close_raw::text,
            volume_asset_raw::text, volume_stable_raw::text, trade_count, finalized, source
       FROM (
         SELECT * FROM candles WHERE ${where}
          ORDER BY bucket_start DESC LIMIT $4
       ) recent
      ORDER BY bucket_start ASC`,
    params,
  );
  return rows;
}

/** Close of the newest bucket at or before `at`, for a 24h change calculation. */
export async function getCloseAt(
  db: Database,
  chainId: number,
  pool: string,
  interval: number,
  at: number,
): Promise<bigint | null> {
  const row = await db.maybe<{ close_raw: string }>(
    `SELECT close_raw::text FROM candles
      WHERE chain_id = $1 AND pool = $2 AND interval_seconds = $3 AND bucket_start <= $4
      ORDER BY bucket_start DESC LIMIT 1`,
    [chainId, pool, interval, at],
  );
  return row === null ? null : BigInt(row.close_raw);
}
