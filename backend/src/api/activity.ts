import { formatFixed, STABLE_DECIMALS, TOKEN_DECIMALS } from '../lib/decimal.js';
import { redemptionModeName, positionKindName, statusName } from './schemas/common.js';
import type { RawLogRow } from './repository.js';

/**
 * The unified activity timeline.
 *
 * Built from `raw_logs` — the complete event archive — rather than a union over projection
 * tables, so the feed cannot silently omit an event type nobody remembered to add. That also
 * covers the vault's annotation events (reserve deposits, market funding), which have no
 * aggregate of their own.
 *
 * `actor` is the address the event itself names. Some events (`NAVUpdated`,
 * `AssetStatusChanged`, `Rebalanced`) name none: the acting party is the transaction sender,
 * which is not in the log. Reporting `null` is the honest answer; inventing an address, or
 * spending an RPC round trip per row to fetch the sender, is not.
 */

export interface ActivityItem {
  id: string;
  timestamp: number;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  type: string;
  actor: string | null;
  summary: Record<string, string | number>;
}

type Decimals = 'stable' | 'token' | 'raw';

interface EventMapping {
  type: string;
  /** Decoded argument naming the acting party, if the event names one. */
  actorArg?: string;
  /** Argument name -> how to format it. Anything unlisted is passed through verbatim. */
  fields: Record<string, Decimals>;
}

const MAPPINGS: Record<string, EventMapping> = {
  TokensPurchased: {
    type: 'Purchase',
    actorArg: 'buyer',
    fields: {
      stablecoinAmount: 'stable',
      tokenAmount: 'token',
      issuerShare: 'stable',
      reserveShare: 'stable',
      marketShare: 'stable',
    },
  },
  RevenueDeposited: {
    type: 'RevenueDeposit',
    actorArg: 'depositor',
    fields: {
      grossAmount: 'stable',
      holderAmount: 'stable',
      reserveAmount: 'stable',
      operatorAmount: 'stable',
      protocolAmount: 'stable',
      periodId: 'raw',
    },
  },
  RevenueClaimed: { type: 'RevenueClaim', actorArg: 'holder', fields: { amount: 'stable' } },
  OperatorRevenueClaimed: {
    type: 'RevenueClaim',
    actorArg: 'operator',
    fields: { amount: 'stable' },
  },
  Redeemed: {
    type: 'Redemption',
    actorArg: 'holder',
    fields: {
      tokenAmount: 'token',
      stablecoinAmount: 'stable',
      nav: 'stable',
      redemptionPrice: 'stable',
    },
  },
  NAVUpdated: { type: 'NAVUpdate', fields: { previousNAV: 'stable', newNAV: 'stable' } },
  AssetStatusChanged: { type: 'StatusChange', fields: {} },
  Rebalanced: {
    type: 'Rebalance',
    fields: { spotPrice: 'stable', twapPrice: 'stable', nav: 'stable' },
  },
  PositionLiquidityAdded: {
    type: 'LiquidityAdded',
    fields: { liquidity: 'raw', amount0: 'raw', amount1: 'raw' },
  },
  PositionLiquidityRemoved: {
    type: 'LiquidityRemoved',
    fields: { liquidity: 'raw', amount0: 'raw', amount1: 'raw' },
  },
  PositionConfigured: { type: 'PositionConfigured', fields: {} },
  FeesCollected: { type: 'FeesCollected', fields: { amount0: 'raw', amount1: 'raw' } },
  SwapExecuted: { type: 'Swap', fields: { amountIn: 'raw', amountOut: 'raw' } },
  InitialReserveDeposited: { type: 'ReserveDeposit', actorArg: 'issuer', fields: { amount: 'stable' } },
  ReserveContribution: {
    type: 'ReserveDeposit',
    actorArg: 'issuer',
    fields: { amount: 'stable', newReserve: 'stable', periodId: 'raw' },
  },
  MarketFundsReleased: {
    type: 'MarketFunded',
    actorArg: 'marketManager',
    fields: { amount: 'stable' },
  },
  MarketFundsReturned: {
    type: 'MarketReturned',
    actorArg: 'marketManager',
    fields: { amount: 'stable' },
  },
  IssuerProceedsWithdrawn: {
    type: 'IssuerWithdrawal',
    actorArg: 'issuer',
    fields: { amount: 'stable' },
  },
  ProtocolFeesWithdrawn: {
    type: 'ProtocolFeesWithdrawn',
    actorArg: 'recipient',
    fields: { amount: 'stable' },
  },
  /**
   * D-023. Both of these move the reserve **without a redemption**, which is why category
   * balances are projected from `AllocationChanged` rather than inferred from `Redeemed`.
   */
  ReserveYieldAccrued: {
    type: 'ReserveYield',
    actorArg: 'source',
    fields: { amount: 'stable', newCategoryBalance: 'stable' },
  },
  ResidualReserveReleased: {
    type: 'ResidualReserveReleased',
    actorArg: 'issuer',
    fields: { amount: 'stable', obligationsRetained: 'token' },
  },
  ReserveShortfallEntered: {
    type: 'ReserveShortfall',
    fields: { backing: 'stable', targetBacking: 'stable' },
  },
  ReserveShortfallCleared: {
    type: 'ReserveShortfallCleared',
    fields: { backing: 'stable', targetBacking: 'stable' },
  },
  Transfer: { type: 'Transfer', actorArg: 'from', fields: { value: 'token' } },
};

/** Only these contracts contribute to an asset timeline; mUSD movements are not asset activity. */
const TIMELINE_CONTRACTS = new Set([
  'AssetRegistry',
  'AssetVault',
  'PrimaryOffering',
  'RevenueDistributor',
  'RedemptionController',
  'AssetMarketManager',
  'AssetToken',
]);

export function toActivityItem(row: RawLogRow): ActivityItem | null {
  if (row.event_name === null || row.decoded === null) return null;
  if (row.contract_name !== null && !TIMELINE_CONTRACTS.has(row.contract_name)) return null;

  const mapping = MAPPINGS[row.event_name];
  if (mapping === undefined) return null;

  const decoded = row.decoded;
  const summary: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(decoded)) {
    const format = mapping.fields[key];
    if (format === 'stable' || format === 'token') {
      summary[key] = formatFixed(
        BigInt(String(value)),
        format === 'stable' ? STABLE_DECIMALS : TOKEN_DECIMALS,
      );
    } else if (typeof value === 'number') {
      summary[key] = value;
    } else if (typeof value === 'boolean') {
      summary[key] = String(value);
    } else {
      summary[key] = String(value);
    }
  }

  // Enum integers are an interface both consumers hardcode; the timeline shows the name too.
  if (row.event_name === 'Redeemed' && typeof decoded.mode === 'string') {
    summary.modeName = redemptionModeName(Number(decoded.mode));
  }
  if (row.event_name === 'AssetStatusChanged') {
    summary.previousStatusName = statusName(Number(decoded.previousStatus));
    summary.newStatusName = statusName(Number(decoded.newStatus));
  }
  if (
    typeof decoded.kind === 'string' &&
    ['PositionConfigured', 'PositionLiquidityAdded', 'PositionLiquidityRemoved', 'FeesCollected'].includes(
      row.event_name,
    )
  ) {
    summary.kindName = positionKindName(Number(decoded.kind));
  }
  if (row.event_name === 'Rebalanced' && typeof decoded.operation === 'string') {
    summary.operation = decodeBytes32(decoded.operation);
  }

  const actorRaw = mapping.actorArg === undefined ? undefined : decoded[mapping.actorArg];

  return {
    id: `${row.transaction_hash}:${row.log_index}`,
    timestamp: Number(row.block_timestamp),
    blockNumber: Number(row.block_number),
    txHash: row.transaction_hash,
    logIndex: row.log_index,
    type: mapping.type,
    actor: typeof actorRaw === 'string' ? actorRaw.toLowerCase() : null,
    summary,
  };
}

function decodeBytes32(value: string): string {
  const body = value.replace(/^0x/, '');
  let out = '';
  for (let i = 0; i < body.length; i += 2) {
    const byte = Number.parseInt(body.slice(i, i + 2), 16);
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}
