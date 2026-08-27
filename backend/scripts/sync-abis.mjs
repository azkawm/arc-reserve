#!/usr/bin/env node
/**
 * Copy ABIs out of the Foundry build into backend/abis/ so the backend never depends on the
 * Foundry cache at runtime. Run after any `forge build` that changes an interface, and
 * commit the result — the snapshot is what the indexer decodes with.
 *
 *   npm run sync-abis
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(here, '..');
const foundryOut = resolve(backendDir, '..', 'contracts', 'out');
const abiDir = join(backendDir, 'abis');

/** Every contract whose logs or views this service reads. */
const CONTRACTS = [
  'AssetRegistry',
  'AssetFactory',
  'AssetToken',
  'AssetVault',
  'PrimaryOffering',
  'RevenueDistributor',
  'RedemptionController',
  'AssetMarketManager',
  'CompanyVestingWallet',
  'IdentityRegistry',
  'ModularCompliance',
  'CountryAllowModule',
  'TransferLockModule',
  'AtsExternalKycList',
  'MockUSD',
  'MockUniswapV3Pool',
  'IUniswapV3Pool',
];

if (!existsSync(foundryOut)) {
  console.error(`contracts/out not found at ${foundryOut}\nRun \`forge build\` in contracts/ first.`);
  process.exit(1);
}

await mkdir(abiDir, { recursive: true });

let written = 0;
const missing = [];

for (const name of CONTRACTS) {
  const artifact = join(foundryOut, `${name}.sol`, `${name}.json`);
  if (!existsSync(artifact)) {
    missing.push(name);
    continue;
  }
  const { abi } = JSON.parse(await readFile(artifact, 'utf8'));
  if (!Array.isArray(abi)) {
    missing.push(name);
    continue;
  }
  await writeFile(join(abiDir, `${name}.json`), `${JSON.stringify(abi, null, 2)}\n`, 'utf8');
  written += 1;
}

console.log(`synced ${written} ABIs into backend/abis/`);
if (missing.length > 0) {
  console.error(`missing artifacts: ${missing.join(', ')}`);
  process.exit(1);
}
