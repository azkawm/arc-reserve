import { getAddress, toFunctionSelector } from 'viem';
import type { ArcPublicClient } from './client.js';
import { loadAbi, type ContractName } from './abis.js';

/**
 * Contract view snapshot.
 *
 * Milestone B built the read model from events. This fills the gap events cannot: the
 * offering's configuration, the supply cap, the reserve ratio policy, tick spacing, token
 * ordering and the redemption price are **state, never emitted**. `PrimaryOffering` emits
 * only `TokensPurchased`; nothing announces its price, cap or window.
 *
 * Everything here is read at the **indexed block**, not at `latest`, so a response cannot mix
 * a projection from block N with a view from block N+3 and call the pair coherent.
 *
 * These values are labelled `onchain`: they are direct reads of contract state at a stated
 * block. The one exception is market price — see `poolIsCanonical`.
 */

/** A view that reverts (wrong status, uninitialised pool) yields null rather than a 500. */
async function safeRead<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

export interface AssetComponents {
  assetId: string;
  token: `0x${string}`;
  vault: `0x${string}`;
  offering: `0x${string}`;
  marketManager: `0x${string}`;
  revenueDistributor: `0x${string}`;
  redemptionController: `0x${string}`;
  pool: `0x${string}` | null;
}

export interface TokenSnapshot {
  name: string;
  symbol: string;
  decimals: number;
  maximumSupply: bigint;
  totalSupply: bigint;
  investorSupply: bigint;
  issuerAllocationSupply: bigint;
}

export interface VaultSnapshot {
  redemptionReserve: bigint;
  marketMakingAllocation: bigint;
  assetRevenue: bigint;
  issuerProceeds: bigint;
  protocolFees: bigint;
  totalAccounted: bigint;
  totalStablecoinBalance: bigint;
  minimumRequiredReserve: bigint;
  minimumReserveRatioBps: number;
  reserveRatioBps: bigint | null;
  isSolvent: boolean;
  availableRedemptionLiquidity: bigint;
  currentBacking: bigint | null;
  targetBackingNow: bigint | null;
  isBehindSchedule: boolean | null;
  isInEnforcedShortfall: boolean | null;
  shortfallStartedAt: bigint | null;
  schedule: {
    startBacking: bigint;
    targetBacking: bigint;
    startTime: bigint;
    maturity: bigint;
    graceSeconds: bigint;
  } | null;
}

export interface OfferingSnapshot {
  tokenPrice: bigint;
  fundraisingCap: bigint;
  walletPurchaseLimit: bigint;
  minimumPurchase: bigint;
  startsAt: bigint;
  endsAt: bigint;
  stablecoinRaised: bigint;
  tokensSold: bigint;
  availableTokenInventory: bigint;
  inventoryCap: bigint;
  paused: boolean;
}

export interface RevenueSnapshot {
  excludedSupply: bigint;
  yieldEligibleSupply: bigint;
  totalHolderRevenue: bigint;
  totalClaimed: bigint;
  operatorAccrued: bigint;
  operator: `0x${string}`;
}

export interface RedemptionSnapshot {
  normalPrice: bigint | null;
  maturityPrice: bigint | null;
  emergencyPrice: bigint | null;
  emergencySettlementPrice: bigint;
  periodStartedAt: bigint;
  periodDuration: bigint;
  periodLimitTokens: bigint;
  redeemedThisPeriod: bigint;
  totalRedeemedTokens: bigint;
  totalStablecoinPaid: bigint;
  outstandingTokenObligations: bigint;
  paused: boolean;
}

export interface MarketPosition {
  kind: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  configured: boolean;
}

export interface MarketSnapshot {
  spotPrice: bigint | null;
  twapPrice: bigint | null;
  meanTick: number | null;
  assetIsToken0: boolean;
  tickSpacing: number;
  twapWindow: number;
  rebalanceCooldown: number;
  lastRebalanceAt: bigint;
  maxSpotTwapDeviationBps: number;
  maxMarketNAVDeviationBps: number;
  maxTickShift: number;
  paused: boolean;
  positions: MarketPosition[];
  safety: { failure: number; spot: bigint; twap: bigint; nav: bigint } | null;
  /**
   * False when the pool is `MockUniswapV3Pool`. Every price derived from a non-canonical
   * pool is served with `mock` provenance, never `onchain` (D-019).
   */
  poolIsCanonical: boolean;
}

export interface RegistrySnapshot {
  status: number;
  nav: bigint;
  navTimestamp: bigint;
  maturity: bigint;
  issuer: `0x${string}`;
  isNAVStale: boolean;
}

export interface AssetSnapshot {
  blockNumber: bigint;
  token: TokenSnapshot;
  vault: VaultSnapshot;
  offering: OfferingSnapshot;
  revenue: RevenueSnapshot;
  redemption: RedemptionSnapshot;
  market: MarketSnapshot | null;
  registry: RegistrySnapshot;
}

/**
 * `MockUniswapV3Pool` carries test-only setters a real Uniswap V3 pool does not. Probing the
 * deployed bytecode for one of their selectors identifies the mock without a configuration
 * flag that someone could set wrongly — and getting this wrong means publishing a fabricated
 * price as if it were market data.
 */
const MOCK_POOL_MARKERS = ['setOracleForTest', 'setSwapOutputBpsForTest'] as const;

export async function poolIsCanonical(
  client: ArcPublicClient,
  pool: `0x${string}`,
): Promise<boolean> {
  const code = await client.getCode({ address: getAddress(pool) });
  if (code === undefined || code === '0x') return false;

  const mockAbi = loadAbi('MockUniswapV3Pool');
  const markers = MOCK_POOL_MARKERS.map((name) => {
    const item = mockAbi.find((entry) => entry.type === 'function' && entry.name === name);
    return item === undefined ? null : toFunctionSelector(item as never).slice(2);
  }).filter((selector): selector is string => selector !== null);

  return !markers.some((selector) => code.includes(selector));
}

interface ReadOptions {
  address: string;
  abi: ContractName;
  blockNumber: bigint;
}

function reader(client: ArcPublicClient) {
  return <T>(options: ReadOptions, functionName: string, args: unknown[] = []): Promise<T> =>
    client.readContract({
      address: getAddress(options.address),
      abi: loadAbi(options.abi),
      functionName,
      args,
      blockNumber: options.blockNumber,
    }) as Promise<T>;
}

export async function readAssetSnapshot(
  client: ArcPublicClient,
  registryAddress: `0x${string}`,
  components: AssetComponents,
  blockNumber: bigint,
): Promise<AssetSnapshot> {
  const read = reader(client);
  const at = (address: string, abi: ContractName): ReadOptions => ({ address, abi, blockNumber });

  const token = at(components.token, 'AssetToken');
  const vault = at(components.vault, 'AssetVault');
  const offering = at(components.offering, 'PrimaryOffering');
  const revenue = at(components.revenueDistributor, 'RevenueDistributor');
  const redemption = at(components.redemptionController, 'RedemptionController');
  const registry = at(registryAddress, 'AssetRegistry');

  const [
    tokenSnapshot,
    vaultSnapshot,
    offeringSnapshot,
    revenueSnapshot,
    redemptionSnapshot,
    registrySnapshot,
    market,
  ] = await Promise.all([
    readToken(read, token),
    readVault(read, vault),
    readOffering(read, offering),
    readRevenue(read, revenue),
    readRedemption(read, redemption),
    readRegistry(read, registry, components.assetId),
    components.pool === null
      ? Promise.resolve(null)
      : readMarket(client, read, at(components.marketManager, 'AssetMarketManager'), components.pool),
  ]);

  return {
    blockNumber,
    token: tokenSnapshot,
    vault: vaultSnapshot,
    offering: offeringSnapshot,
    revenue: revenueSnapshot,
    redemption: redemptionSnapshot,
    market,
    registry: registrySnapshot,
  };
}

type Read = ReturnType<typeof reader>;

async function readToken(read: Read, at: ReadOptions): Promise<TokenSnapshot> {
  const [name, symbol, decimals, maximumSupply, totalSupply, investorSupply, issuerAllocationSupply] =
    await Promise.all([
      read<string>(at, 'name'),
      read<string>(at, 'symbol'),
      read<number>(at, 'decimals'),
      read<bigint>(at, 'maximumSupply'),
      read<bigint>(at, 'totalSupply'),
      read<bigint>(at, 'investorSupply'),
      read<bigint>(at, 'issuerAllocationSupply'),
    ]);
  return { name, symbol, decimals, maximumSupply, totalSupply, investorSupply, issuerAllocationSupply };
}

async function readVault(read: Read, at: ReadOptions): Promise<VaultSnapshot> {
  const [
    redemptionReserve,
    marketMakingAllocation,
    assetRevenue,
    issuerProceeds,
    protocolFees,
    totalAccounted,
    totalStablecoinBalance,
    minimumRequiredReserve,
    minimumReserveRatioBps,
    reserveRatioBps,
    isSolvent,
    availableRedemptionLiquidity,
  ] = await Promise.all([
    read<bigint>(at, 'redemptionReserve'),
    read<bigint>(at, 'marketMakingAllocation'),
    read<bigint>(at, 'assetRevenue'),
    read<bigint>(at, 'issuerProceeds'),
    read<bigint>(at, 'protocolFees'),
    read<bigint>(at, 'totalAccounted'),
    read<bigint>(at, 'totalStablecoinBalance'),
    read<bigint>(at, 'minimumRequiredReserve'),
    read<number>(at, 'minimumReserveRatioBps'),
    safeRead(() => read<bigint>(at, 'reserveRatioBps')),
    read<boolean>(at, 'isSolvent'),
    read<bigint>(at, 'availableRedemptionLiquidity'),
  ]);

  // D-023. Absent on a chain deployed before the reserve schedule landed.
  const [currentBacking, targetBackingNow, isBehindSchedule, isInEnforcedShortfall, shortfallStartedAt, scheduleTuple] =
    await Promise.all([
      safeRead(() => read<bigint>(at, 'currentBacking')),
      safeRead(() => read<bigint>(at, 'targetBackingNow')),
      safeRead(() => read<boolean>(at, 'isBehindSchedule')),
      safeRead(() => read<boolean>(at, 'isInEnforcedShortfall')),
      safeRead(() => read<bigint>(at, 'shortfallStartedAt')),
      safeRead(() => read<readonly [bigint, bigint, bigint, bigint, bigint]>(at, 'reserveSchedule')),
    ]);

  return {
    redemptionReserve,
    marketMakingAllocation,
    assetRevenue,
    issuerProceeds,
    protocolFees,
    totalAccounted,
    totalStablecoinBalance,
    minimumRequiredReserve,
    minimumReserveRatioBps: Number(minimumReserveRatioBps),
    reserveRatioBps,
    isSolvent,
    availableRedemptionLiquidity,
    currentBacking,
    targetBackingNow,
    isBehindSchedule,
    isInEnforcedShortfall,
    shortfallStartedAt,
    schedule:
      scheduleTuple === null || scheduleTuple[3] === 0n
        ? null
        : {
            startBacking: scheduleTuple[0],
            targetBacking: scheduleTuple[1],
            startTime: scheduleTuple[2],
            maturity: scheduleTuple[3],
            graceSeconds: scheduleTuple[4],
          },
  };
}

async function readOffering(read: Read, at: ReadOptions): Promise<OfferingSnapshot> {
  const [
    tokenPrice,
    fundraisingCap,
    walletPurchaseLimit,
    minimumPurchase,
    startsAt,
    endsAt,
    stablecoinRaised,
    tokensSold,
    availableTokenInventory,
    inventoryCap,
    paused,
  ] = await Promise.all([
    read<bigint>(at, 'tokenPrice'),
    read<bigint>(at, 'fundraisingCap'),
    read<bigint>(at, 'walletPurchaseLimit'),
    read<bigint>(at, 'minimumPurchase'),
    read<bigint>(at, 'startsAt'),
    read<bigint>(at, 'endsAt'),
    read<bigint>(at, 'stablecoinRaised'),
    read<bigint>(at, 'tokensSold'),
    read<bigint>(at, 'availableTokenInventory'),
    read<bigint>(at, 'inventoryCap'),
    read<boolean>(at, 'paused'),
  ]);
  return {
    tokenPrice,
    fundraisingCap,
    walletPurchaseLimit,
    minimumPurchase,
    startsAt,
    endsAt,
    stablecoinRaised,
    tokensSold,
    availableTokenInventory,
    inventoryCap,
    paused,
  };
}

async function readRevenue(read: Read, at: ReadOptions): Promise<RevenueSnapshot> {
  const [excludedSupply, yieldEligibleSupply, totalHolderRevenue, totalClaimed, operatorAccrued, operator] =
    await Promise.all([
      read<bigint>(at, 'excludedSupply'),
      read<bigint>(at, 'yieldEligibleSupply'),
      read<bigint>(at, 'totalHolderRevenue'),
      read<bigint>(at, 'totalClaimed'),
      read<bigint>(at, 'operatorAccrued'),
      read<`0x${string}`>(at, 'operator'),
    ]);
  return {
    excludedSupply,
    yieldEligibleSupply,
    totalHolderRevenue,
    totalClaimed,
    operatorAccrued,
    operator,
  };
}

async function readRedemption(read: Read, at: ReadOptions): Promise<RedemptionSnapshot> {
  const [
    normalPrice,
    maturityPrice,
    emergencyPrice,
    emergencySettlementPrice,
    periodStartedAt,
    periodDuration,
    periodLimitTokens,
    redeemedThisPeriod,
    totalRedeemedTokens,
    totalStablecoinPaid,
    outstandingTokenObligations,
    paused,
  ] = await Promise.all([
    // Mode-specific prices revert outside their lifecycle state; null is the honest answer.
    safeRead(() => read<bigint>(at, 'redemptionPrice', [0])),
    safeRead(() => read<bigint>(at, 'redemptionPrice', [1])),
    safeRead(() => read<bigint>(at, 'redemptionPrice', [2])),
    read<bigint>(at, 'emergencySettlementPrice'),
    read<bigint>(at, 'periodStartedAt'),
    read<bigint>(at, 'periodDuration'),
    read<bigint>(at, 'periodLimitTokens'),
    read<bigint>(at, 'redeemedThisPeriod'),
    read<bigint>(at, 'totalRedeemedTokens'),
    read<bigint>(at, 'totalStablecoinPaid'),
    read<bigint>(at, 'outstandingTokenObligations'),
    read<boolean>(at, 'paused'),
  ]);

  return {
    normalPrice,
    maturityPrice,
    emergencyPrice,
    emergencySettlementPrice,
    periodStartedAt,
    periodDuration,
    periodLimitTokens,
    redeemedThisPeriod,
    totalRedeemedTokens,
    totalStablecoinPaid,
    outstandingTokenObligations,
    paused,
  };
}

async function readMarket(
  client: ArcPublicClient,
  read: Read,
  at: ReadOptions,
  pool: `0x${string}`,
): Promise<MarketSnapshot> {
  const [
    prices,
    assetIsToken0,
    tickSpacing,
    twapWindow,
    rebalanceCooldown,
    lastRebalanceAt,
    maxSpotTwapDeviationBps,
    maxMarketNAVDeviationBps,
    maxTickShift,
    paused,
    safety,
    canonical,
  ] = await Promise.all([
    safeRead(() => read<readonly [bigint, bigint, number]>(at, 'marketPrices')),
    read<boolean>(at, 'assetIsToken0'),
    read<number>(at, 'tickSpacing'),
    read<number>(at, 'twapWindow'),
    read<number>(at, 'rebalanceCooldown'),
    read<bigint>(at, 'lastRebalanceAt'),
    read<number>(at, 'maxSpotTwapDeviationBps'),
    read<number>(at, 'maxMarketNAVDeviationBps'),
    read<number>(at, 'maxTickShift'),
    read<boolean>(at, 'paused'),
    safeRead(() => read<readonly [number, bigint, bigint, bigint]>(at, 'safetyState', [true])),
    poolIsCanonical(client, pool),
  ]);

  const positions = await Promise.all(
    [0, 1, 2, 3].map(async (kind) => {
      const position = await safeRead(() =>
        read<readonly [number, number, bigint, boolean]>(at, 'positions', [kind]),
      );
      return position === null
        ? { kind, tickLower: 0, tickUpper: 0, liquidity: 0n, configured: false }
        : {
            kind,
            tickLower: position[0],
            tickUpper: position[1],
            liquidity: position[2],
            configured: position[3],
          };
    }),
  );

  return {
    spotPrice: prices === null ? null : prices[0],
    twapPrice: prices === null ? null : prices[1],
    meanTick: prices === null ? null : prices[2],
    assetIsToken0,
    tickSpacing: Number(tickSpacing),
    twapWindow: Number(twapWindow),
    rebalanceCooldown: Number(rebalanceCooldown),
    lastRebalanceAt,
    maxSpotTwapDeviationBps: Number(maxSpotTwapDeviationBps),
    maxMarketNAVDeviationBps: Number(maxMarketNAVDeviationBps),
    maxTickShift: Number(maxTickShift),
    paused,
    positions,
    safety:
      safety === null
        ? null
        : { failure: Number(safety[0]), spot: safety[1], twap: safety[2], nav: safety[3] },
    poolIsCanonical: canonical,
  };
}

async function readRegistry(read: Read, at: ReadOptions, assetId: string): Promise<RegistrySnapshot> {
  const [status, navResult, maturity, issuer, isNAVStale] = await Promise.all([
    read<number>(at, 'statusOf', [assetId]),
    read<readonly [bigint, bigint]>(at, 'navOf', [assetId]),
    read<bigint>(at, 'maturityOf', [assetId]),
    read<`0x${string}`>(at, 'issuerOf', [assetId]),
    read<boolean>(at, 'isNAVStale', [assetId]),
  ]);

  return {
    status: Number(status),
    nav: navResult[0],
    navTimestamp: navResult[1],
    maturity,
    issuer,
    isNAVStale,
  };
}
