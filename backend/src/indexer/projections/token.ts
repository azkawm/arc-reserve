import { persistWatched } from '../watched.js';
import {
  addr,
  big,
  bool,
  ZERO_ADDRESS,
  type LogContext,
  type ProjectionDeps,
  type Projector,
} from './types.js';

/**
 * AssetToken: balances, the three supply denominators, and holder restrictions.
 *
 * The arithmetic here is incremental, which is safe only because a log is projected exactly
 * once: the ingester inserts into `raw_logs` with the `(chain_id, transaction_hash,
 * log_index)` key and projects only when that insert actually created a row.
 *
 * Three denominators are maintained, and they are not interchangeable:
 *   total_supply              every minted token
 *   investor_supply           total_supply - issuer_allocation_supply  (backing, redemption)
 *   yield_eligible_supply     total_supply - excluded_supply           (revenue)
 *
 * Both flag events move a denominator with **no** Transfer, so each adjusts its aggregate
 * directly using the balance the contract reports at that moment.
 */

const transfer: Projector = async (ctx, args, { tx }) => {
  const from = addr(args, 'from');
  const to = addr(args, 'to');
  const value = big(args, 'value');

  await tx.query(
    `INSERT INTO token_transfers (chain_id, token, block_number, transaction_hash, log_index,
                                  from_address, to_address, value, block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      ctx.chainId,
      ctx.address,
      ctx.blockNumber.toString(),
      ctx.transactionHash,
      ctx.logIndex,
      from,
      to,
      value.toString(),
      ctx.blockTimestamp.toString(),
    ],
  );

  const minting = from === ZERO_ADDRESS;
  const burning = to === ZERO_ADDRESS;

  // Flags belong to the holder, so the aggregates move only when a flagged holder's balance
  // moves. Read before the balance update.
  const fromFlags = minting ? null : await flagsOf(tx, ctx, from);
  const toFlags = burning ? null : await flagsOf(tx, ctx, to);

  if (!minting) {
    await tx.query(
      `UPDATE token_balances SET balance = balance - $4, updated_block = $5
        WHERE chain_id = $1 AND token = $2 AND holder = $3`,
      [ctx.chainId, ctx.address, from, value.toString(), ctx.blockNumber.toString()],
    );
  }

  if (!burning) {
    await ensureBalanceRow(tx, ctx, to);
    await tx.query(
      `UPDATE token_balances SET balance = balance + $4, updated_block = $5
        WHERE chain_id = $1 AND token = $2 AND holder = $3`,
      [ctx.chainId, ctx.address, to, value.toString(), ctx.blockNumber.toString()],
    );
  }

  const supplyDelta = minting ? value : burning ? -value : 0n;
  const excludedDelta =
    (toFlags?.yield_excluded ? value : 0n) - (fromFlags?.yield_excluded ? value : 0n);
  const issuerDelta =
    (toFlags?.issuer_allocation ? value : 0n) - (fromFlags?.issuer_allocation ? value : 0n);

  await tx.query(
    `UPDATE token_supply
        SET total_supply = total_supply + $3,
            excluded_supply = excluded_supply + $4,
            issuer_allocation_supply = issuer_allocation_supply + $5,
            updated_block = $6
      WHERE chain_id = $1 AND token = $2`,
    [
      ctx.chainId,
      ctx.address,
      supplyDelta.toString(),
      excludedDelta.toString(),
      issuerDelta.toString(),
      ctx.blockNumber.toString(),
    ],
  );
};

/**
 * D-024. Flagging an address moves it out of the backing denominator without any token
 * moving, so the aggregate is adjusted from the balance the event reports rather than
 * inferred from transfers.
 */
const issuerAllocationChanged: Projector = async (ctx, args, { tx }) => {
  const account = addr(args, 'account');
  const flagged = bool(args, 'flagged');
  const balance = big(args, 'accountBalance');

  await ensureBalanceRow(tx, ctx, account);
  await tx.query(
    `UPDATE token_balances SET issuer_allocation = $4, updated_block = $5
      WHERE chain_id = $1 AND token = $2 AND holder = $3`,
    [ctx.chainId, ctx.address, account, flagged, ctx.blockNumber.toString()],
  );
  await tx.query(
    `UPDATE token_supply SET issuer_allocation_supply = issuer_allocation_supply + $3,
                             updated_block = $4
      WHERE chain_id = $1 AND token = $2`,
    [
      ctx.chainId,
      ctx.address,
      (flagged ? balance : -balance).toString(),
      ctx.blockNumber.toString(),
    ],
  );
};

const complianceExemptionChanged: Projector = async (ctx, args, { tx }) => {
  const account = addr(args, 'account');
  await ensureBalanceRow(tx, ctx, account);
  await tx.query(
    `UPDATE token_balances SET compliance_exempt = $4, updated_block = $5
      WHERE chain_id = $1 AND token = $2 AND holder = $3`,
    [ctx.chainId, ctx.address, account, bool(args, 'exempt'), ctx.blockNumber.toString()],
  );
};

const addressFrozen: Projector = async (ctx, args, { tx }) => {
  const account = addr(args, 'userAddress');
  await ensureBalanceRow(tx, ctx, account);
  await tx.query(
    `UPDATE token_balances SET frozen = $4, updated_block = $5
      WHERE chain_id = $1 AND token = $2 AND holder = $3`,
    [ctx.chainId, ctx.address, account, bool(args, 'isFrozen'), ctx.blockNumber.toString()],
  );
};

function frozenTokens(sign: 1n | -1n): Projector {
  return async (ctx, args, { tx }) => {
    const account = addr(args, 'userAddress');
    await ensureBalanceRow(tx, ctx, account);
    await tx.query(
      `UPDATE token_balances SET frozen_tokens = frozen_tokens + $4, updated_block = $5
        WHERE chain_id = $1 AND token = $2 AND holder = $3`,
      [
        ctx.chainId,
        ctx.address,
        account,
        (sign * big(args, 'amount')).toString(),
        ctx.blockNumber.toString(),
      ],
    );
  };
}

/** The token announces its own compliance wiring; that is how those addresses are discovered. */
function discoverFromToken(kind: 'identityRegistry' | 'compliance', argName: string): Projector {
  return async (ctx, args, { tx, watched }) => {
    const address = addr(args, argName);
    if (address === ZERO_ADDRESS) return; // compliance removed
    const entry = { address, kind, assetId: ctx.assetId };
    watched.add(entry);
    await persistWatched(tx, ctx.chainId, entry, ctx.blockNumber);
  };
}

interface HolderFlags {
  yield_excluded: boolean;
  issuer_allocation: boolean;
}

async function flagsOf(
  tx: ProjectionDeps['tx'],
  ctx: LogContext,
  holder: string,
): Promise<HolderFlags | null> {
  const { rows } = await tx.query<HolderFlags>(
    `SELECT yield_excluded, issuer_allocation FROM token_balances
      WHERE chain_id = $1 AND token = $2 AND holder = $3`,
    [ctx.chainId, ctx.address, holder],
  );
  return rows[0] ?? null;
}

async function ensureBalanceRow(
  tx: ProjectionDeps['tx'],
  ctx: LogContext,
  holder: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO token_balances (chain_id, token, holder, updated_block)
     VALUES ($1, $2, $3, $4) ON CONFLICT (chain_id, token, holder) DO NOTHING`,
    [ctx.chainId, ctx.address, holder, ctx.blockNumber.toString()],
  );
}

/** Used by the revenue projector, whose YieldExclusionChanged targets this asset's token. */
export async function applyYieldExclusion(
  tx: ProjectionDeps['tx'],
  ctx: LogContext,
  token: `0x${string}`,
  account: `0x${string}`,
  excluded: boolean,
  accountBalance: bigint,
): Promise<void> {
  await tx.query(
    `INSERT INTO token_balances (chain_id, token, holder, updated_block)
     VALUES ($1, $2, $3, $4) ON CONFLICT (chain_id, token, holder) DO NOTHING`,
    [ctx.chainId, token, account, ctx.blockNumber.toString()],
  );
  await tx.query(
    `UPDATE token_balances SET yield_excluded = $4, updated_block = $5
      WHERE chain_id = $1 AND token = $2 AND holder = $3`,
    [ctx.chainId, token, account, excluded, ctx.blockNumber.toString()],
  );
  await tx.query(
    `UPDATE token_supply SET excluded_supply = excluded_supply + $3, updated_block = $4
      WHERE chain_id = $1 AND token = $2`,
    [
      ctx.chainId,
      token,
      (excluded ? accountBalance : -accountBalance).toString(),
      ctx.blockNumber.toString(),
    ],
  );
}

export const tokenProjectors: Record<string, Projector> = {
  Transfer: transfer,
  IssuerAllocationChanged: issuerAllocationChanged,
  ComplianceExemptionChanged: complianceExemptionChanged,
  AddressFrozen: addressFrozen,
  TokensFrozen: frozenTokens(1n),
  TokensUnfrozen: frozenTokens(-1n),
  IdentityRegistryAdded: discoverFromToken('identityRegistry', 'identityRegistry'),
  ComplianceAdded: discoverFromToken('compliance', 'compliance'),
};
