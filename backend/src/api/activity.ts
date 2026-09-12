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
  // amountSpent leads deliberately: it is the trade size. amountRequested rides along so a
  // partial fill is visible rather than invisible (D-037).
  SwapExactInput: {
    type: 'Swap',
    actorArg: 'trader',
    fields: { amountSpent: 'raw', amountOut: 'raw', amountRequested: 'raw' },
  },
  SurplusCredited: { type: 'SurplusCredited', fields: { amount: 'stable' } },
  MarketSurplusCredited: {
    type: 'SurplusCredited',
    fields: { amount: 'stable', newReserve: 'stable' },
  },
  // Informational. The floor climbing is the headline, so when a rebalance does NOT move it,
  // "why not" is the first question asked — and an invisible raw log cannot answer it.
  FlywheelSkipped: { type: 'FlywheelSkipped', fields: {} },
  FloorLevelUpSkipped: { type: 'FloorLevelUpSkipped', fields: {} },
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
  /** D-025. previousTick/newTick are ticks, not prices; floorPrice is the 6d mUSD level. */
  FloorLevelUp: {
    type: 'FloorLevelUp',
    fields: { floorPrice: 'stable', backing: 'stable', nav: 'stable' },
  },
  FloorLevelCooldownSet: { type: 'FloorCooldownSet', fields: {} },
  FloorControllerSet: { type: 'FloorControllerSet', fields: {} },
  /** D-026. The hash binds the deployment to the verifier-approved term sheet. */
  TermsApproved: { type: 'TermsApproved', fields: {} },
  Transfer: { type: 'Transfer', actorArg: 'from', fields: { value: 'token' } },
  // Verification is the one action in the whole system a visitor performs with their own hand.
  // It was projected into `identities` but rendered nowhere, so someone could verify themselves,
  // open the timeline, and see every action except their own — which reads as "it did not work"
  // at the exact moment they are deciding whether this thing is real.
  IdentityRegistered: { type: 'IdentityRegistered', actorArg: 'investorAddress', fields: {} },
  IdentityUpdated: { type: 'IdentityUpdated', actorArg: 'investorAddress', fields: {} },
  IdentityRemoved: { type: 'IdentityRemoved', actorArg: 'investorAddress', fields: {} },
};

/** Only these contracts contribute to an asset timeline; mUSD movements are not asset activity. */
export const TIMELINE_CONTRACTS = new Set([
  'AssetRegistry',
  'AssetVault',
  'PrimaryOffering',
  'RevenueDistributor',
  'RedemptionController',
  'AssetMarketManager',
  'AssetToken',
  'FloorController',
  // Protocol-wide rather than per-asset, but who may hold this asset is part of its story, and
  // with one registry per deployment there is no ambiguity about which asset a registration
  // concerns.
  'IdentityRegistry',
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
  // NO_CONTROLLER, NOT_ELIGIBLE, CAN_LEVEL_UP_REVERTED, LEVEL_UP_REVERTED — the reason is the
  // entire content of these events, and as hex it tells a reader nothing.
  if (
    ['FlywheelSkipped', 'FloorLevelUpSkipped'].includes(row.event_name) &&
    typeof decoded.reason === 'string'
  ) {
    summary.reason = decodeBytes32(decoded.reason);
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
