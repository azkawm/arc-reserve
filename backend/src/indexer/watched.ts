import type { Queryable } from '../db/client.js';
import type { Config } from '../config.js';
import type { AddressKind } from './decode.js';

/**
 * The watched-address set.
 *
 * The log filter is built from this set, never from configuration: only the three root
 * addresses are configured, and every component address is discovered from
 * `AssetSystemDeployed` / `AssetContractsSet` so a second asset series is indexed without
 * an env change (CONTRACTS_TO_BACKEND section 1).
 *
 * The set is mutated inside the same transaction as the log that grew it, so a component
 * deployed and used in one block is watched from that block onward, not the next one.
 */

export interface WatchedAddress {
  address: `0x${string}`;
  kind: AddressKind;
  assetId: string | null;
}

export class WatchedSet {
  private readonly byAddress = new Map<string, WatchedAddress>();

  constructor(entries: WatchedAddress[] = []) {
    for (const entry of entries) this.byAddress.set(entry.address, entry);
  }

  get(address: string): WatchedAddress | undefined {
    return this.byAddress.get(address.toLowerCase());
  }

  has(address: string): boolean {
    return this.byAddress.has(address.toLowerCase());
  }

  addresses(): `0x${string}`[] {
    return [...this.byAddress.keys()] as `0x${string}`[];
  }

  size(): number {
    return this.byAddress.size;
  }

  /** In-memory only; `persist` writes it. Both happen inside one transaction. */
  add(entry: WatchedAddress): void {
    const address = entry.address.toLowerCase() as `0x${string}`;
    const existing = this.byAddress.get(address);
    // A pool or module can be re-announced; keep the first assetId we learned.
    if (existing && existing.assetId !== null) return;
    this.byAddress.set(address, { ...entry, address });
  }
}

export async function loadWatchedSet(db: Queryable, chainId: number): Promise<WatchedSet> {
  const { rows } = await db.query<{ address: string; kind: string; asset_id: string | null }>(
    'SELECT address, kind, asset_id FROM watched_addresses WHERE chain_id = $1',
    [chainId],
  );
  return new WatchedSet(
    rows.map((row) => ({
      address: row.address as `0x${string}`,
      kind: row.kind as AddressKind,
      assetId: row.asset_id,
    })),
  );
}

export async function persistWatched(
  db: Queryable,
  chainId: number,
  entry: WatchedAddress,
  discoveredAtBlock: bigint | null,
): Promise<void> {
  await db.query(
    `INSERT INTO watched_addresses (chain_id, address, kind, asset_id, discovered_at_block)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (chain_id, address, kind)
     DO UPDATE SET asset_id = COALESCE(watched_addresses.asset_id, EXCLUDED.asset_id)`,
    [
      chainId,
      entry.address.toLowerCase(),
      entry.kind,
      entry.assetId,
      discoveredAtBlock === null ? null : discoveredAtBlock.toString(),
    ],
  );
}

/** Seed the three configured roots. Idempotent; safe on every startup. */
export async function seedRootAddresses(db: Queryable, config: Config): Promise<void> {
  const roots: WatchedAddress[] = [
    { address: config.addresses.registry, kind: 'registry', assetId: null },
    { address: config.addresses.factory, kind: 'factory', assetId: null },
    { address: config.addresses.stablecoin, kind: 'stablecoin', assetId: null },
  ];

  if (config.addresses.companyVesting) {
    // D-031 removed the vesting wallet from the demo deployment; the variable stays
    // supported for a chain deployed before that change.
    roots.push({ address: config.addresses.companyVesting, kind: 'companyVesting', assetId: null });
  }

  for (const root of roots) await persistWatched(db, config.CHAIN_ID, root, null);
}
