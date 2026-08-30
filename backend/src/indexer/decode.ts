import { decodeEventLog, toEventSelector, type Abi, type AbiEvent, type Hex } from 'viem';
import { loadAbi, type ContractName } from '../chain/abis.js';

/**
 * Log decoding.
 *
 * Decoding is keyed by the *kind* of the emitting address, not by topic0 alone. `Transfer`
 * on the asset token and `Transfer` on mUSD share a selector, and so do `Paused`,
 * `RoleGranted` and half the AccessControl surface; resolving through the watched-address
 * set makes that ambiguity impossible rather than merely unlikely.
 *
 * A log whose topic0 is not in the ABI for its kind is kept raw with `eventName: null`. It
 * is evidence for diagnosis and is never projected as trusted state.
 */

export type AddressKind =
  | 'registry'
  | 'factory'
  | 'stablecoin'
  | 'identityRegistry'
  | 'token'
  | 'vault'
  | 'offering'
  | 'revenueDistributor'
  | 'redemptionController'
  | 'marketManager'
  | 'pool'
  | 'compliance'
  | 'complianceModule'
  | 'floorController'
  | 'companyVesting';

const CONTRACT_BY_KIND: Record<AddressKind, ContractName> = {
  registry: 'AssetRegistry',
  factory: 'AssetFactory',
  stablecoin: 'MockUSD',
  identityRegistry: 'IdentityRegistry',
  token: 'AssetToken',
  vault: 'AssetVault',
  offering: 'PrimaryOffering',
  revenueDistributor: 'RevenueDistributor',
  redemptionController: 'RedemptionController',
  marketManager: 'AssetMarketManager',
  pool: 'MockUniswapV3Pool',
  compliance: 'ModularCompliance',
  complianceModule: 'CountryAllowModule',
  companyVesting: 'CompanyVestingWallet',
  floorController: 'FloorController',
};

/**
 * The compliance modules are separate contracts with separate ABIs, but they are all
 * discovered as `complianceModule`. Their events are merged into one decoding surface so a
 * `HolderLocked` from the transfer-lock module decodes even though the kind maps to the
 * country module's ABI.
 */
const EXTRA_ABIS: Partial<Record<AddressKind, ContractName[]>> = {
  complianceModule: ['TransferLockModule'],
  pool: ['IUniswapV3Pool'],
};

export interface DecodedLog {
  contractName: ContractName | null;
  eventName: string | null;
  args: Record<string, unknown> | null;
}

export interface RawLogInput {
  topics: readonly Hex[];
  data: Hex;
}

const abiCache = new Map<AddressKind, Abi>();

function abiForKind(kind: AddressKind): Abi {
  const cached = abiCache.get(kind);
  if (cached) return cached;
  const merged = [
    ...loadAbi(CONTRACT_BY_KIND[kind]),
    ...(EXTRA_ABIS[kind] ?? []).flatMap((name) => loadAbi(name)),
  ] as Abi;
  abiCache.set(kind, merged);
  return merged;
}

export function decodeLog(kind: AddressKind, log: RawLogInput): DecodedLog {
  const contractName = CONTRACT_BY_KIND[kind];
  try {
    const decoded = decodeEventLog({
      abi: abiForKind(kind),
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
      strict: true,
    });
    return {
      contractName,
      // viem types this as possibly undefined for a non-literal ABI; null is our "unknown".
      eventName: decoded.eventName ?? null,
      args: normaliseArgs(decoded.args),
    };
  } catch {
    // Unknown selector, or an argument that does not match the committed ABI. Either way
    // the log is retained raw rather than guessed at.
    return { contractName: null, eventName: null, args: null };
  }
}

/**
 * viem returns positional args for anonymous parameters and a named object otherwise.
 * Projections read by name, so a positional result is rejected rather than mis-mapped.
 */
function normaliseArgs(args: unknown): Record<string, unknown> | null {
  if (args === undefined || args === null) return {};
  if (Array.isArray(args)) return null;
  return args as Record<string, unknown>;
}

/** Every topic0 this service knows how to decode, for building an `eth_getLogs` filter. */
export function knownTopics(kind: AddressKind): Hex[] {
  return abiForKind(kind)
    .filter((item): item is AbiEvent => item.type === 'event')
    .map((item) => toEventSelector(item));
}

/**
 * JSON form for `raw_logs.decoded`. bigints become decimal strings — a bigint is not
 * JSON-serialisable, and a Number conversion would silently lose a uint256.
 */
export function serialiseArgs(args: Record<string, unknown> | null): string | null {
  if (args === null) return null;
  const json = JSON.stringify(args, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  // JSON.stringify returns undefined for an unserialisable root; null keeps the column typed.
  return json ?? null;
}
