import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Abi } from 'viem';

/**
 * ABIs are read from the committed backend/abis snapshot, produced by `npm run sync-abis`
 * from contracts/out. The backend never reaches into the Foundry cache at runtime, and a
 * contract interface change is therefore a visible diff in this workspace.
 */
const abiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'abis');

const cache = new Map<string, Abi>();

export type ContractName =
  | 'AssetRegistry'
  | 'AssetFactory'
  | 'AssetToken'
  | 'AssetVault'
  | 'PrimaryOffering'
  | 'RevenueDistributor'
  | 'RedemptionController'
  | 'AssetMarketManager'
  | 'FloorController'
  | 'CompanyVestingWallet'
  | 'IdentityRegistry'
  | 'ModularCompliance'
  | 'CountryAllowModule'
  | 'TransferLockModule'
  | 'AtsExternalKycList'
  | 'MockUSD'
  | 'MockUniswapV3Pool'
  | 'IUniswapV3Pool'
  /**
   * Hand-written from the published Uniswap V3 signatures, NOT synced from contracts/out:
   * the local IUniswapV3Pool.sol is a functions-only stub with no events, so without this
   * the canonical OHLC path would decode nothing at all. Verified by topic0 in the tests.
   */
  | 'UniswapV3PoolEvents';

export function loadAbi(name: ContractName): Abi {
  const cached = cache.get(name);
  if (cached) return cached;
  const parsed = JSON.parse(readFileSync(join(abiDir, `${name}.json`), 'utf8')) as Abi;
  cache.set(name, parsed);
  return parsed;
}

export const abiDirectory = abiDir;
