import { persistWatched } from '../watched.js';
import { addr, big, num, type LogContext, type ProjectionDeps, type Projector } from './types.js';

/**
 * IdentityRegistry, ModularCompliance and the compliance modules.
 *
 * `isVerified` is deliberately never stored. It is `registered && (expiresAt == 0 ||
 * expiresAt > now)` — a function of the current time, not of the last event. A projected
 * boolean would be correct at index time and wrong the moment a claim expired, which is the
 * same class of lie as serving a mock number as live.
 */

async function ensureIdentityRow(
  tx: ProjectionDeps['tx'],
  ctx: LogContext,
  investor: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO identities (chain_id, registry, investor, updated_block)
     VALUES ($1, $2, $3, $4) ON CONFLICT (chain_id, registry, investor) DO NOTHING`,
    [ctx.chainId, ctx.address, investor, ctx.blockNumber.toString()],
  );
}

const identityRegistered: Projector = async (ctx, args, { tx }) => {
  const investor = addr(args, 'investorAddress');
  await ensureIdentityRow(tx, ctx, investor);
  await tx.query(
    `UPDATE identities SET identity = $4, registered = TRUE, updated_block = $5
      WHERE chain_id = $1 AND registry = $2 AND investor = $3`,
    [ctx.chainId, ctx.address, investor, addr(args, 'identity'), ctx.blockNumber.toString()],
  );
};

const identityRemoved: Projector = async (ctx, args, { tx }) => {
  const investor = addr(args, 'investorAddress');
  await ensureIdentityRow(tx, ctx, investor);
  // The row is kept: history of a removed identity still matters for an activity feed.
  await tx.query(
    `UPDATE identities SET registered = FALSE, updated_block = $4
      WHERE chain_id = $1 AND registry = $2 AND investor = $3`,
    [ctx.chainId, ctx.address, investor, ctx.blockNumber.toString()],
  );
};

const identityUpdated: Projector = async (ctx, args, { tx }) => {
  const investor = addr(args, 'investorAddress');
  await ensureIdentityRow(tx, ctx, investor);
  await tx.query(
    `UPDATE identities SET identity = $4, updated_block = $5
      WHERE chain_id = $1 AND registry = $2 AND investor = $3`,
    [ctx.chainId, ctx.address, investor, addr(args, 'newIdentity'), ctx.blockNumber.toString()],
  );
};

function identityField(column: 'country' | 'investor_class' | 'claim_expires_at', argName: string): Projector {
  return async (ctx, args, { tx }) => {
    const investor = addr(args, 'investorAddress');
    await ensureIdentityRow(tx, ctx, investor);
    // Column comes from this closure's literal union, never from event data.
    await tx.query(
      `UPDATE identities SET ${column} = $4, updated_block = $5
        WHERE chain_id = $1 AND registry = $2 AND investor = $3`,
      [
        ctx.chainId,
        ctx.address,
        investor,
        column === 'claim_expires_at' ? big(args, argName).toString() : num(args, argName),
        ctx.blockNumber.toString(),
      ],
    );
  };
}

async function ensureComplianceRow(
  tx: ProjectionDeps['tx'],
  ctx: LogContext,
  compliance: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO compliance_config (chain_id, compliance, updated_block)
     VALUES ($1, $2, $3) ON CONFLICT (chain_id, compliance) DO NOTHING`,
    [ctx.chainId, compliance, ctx.blockNumber.toString()],
  );
}

const tokenBound: Projector = async (ctx, args, { tx }) => {
  await ensureComplianceRow(tx, ctx, ctx.address);
  await tx.query(
    `UPDATE compliance_config SET token = $3, updated_block = $4
      WHERE chain_id = $1 AND compliance = $2`,
    [ctx.chainId, ctx.address, addr(args, 'token'), ctx.blockNumber.toString()],
  );
};

/**
 * Set semantics for a jsonb array: remove the value, then append it if it belongs.
 *
 * `jsonb - integer` deletes by *index*, not by value, so removing country 360 with the
 * obvious operator would delete the 361st element. Filtering by value avoids that and makes
 * re-adding idempotent rather than duplicating.
 */
const JSONB_SET_UPDATE = `
  COALESCE(
    (SELECT jsonb_agg(element)
       FROM jsonb_array_elements($COLUMN$) AS element
      WHERE element <> $VALUE$),
    '[]'::jsonb
  ) || CASE WHEN $PRESENT$ THEN jsonb_build_array($VALUE$) ELSE '[]'::jsonb END
`;

function jsonbSetExpression(column: string, valueExpression: string, presentParam: string): string {
  return JSONB_SET_UPDATE.replaceAll('$COLUMN$', column)
    .replaceAll('$VALUE$', valueExpression)
    .replaceAll('$PRESENT$', presentParam);
}

/** Modules are discovered here, which is how their own events become decodable. */
function moduleChange(added: boolean): Projector {
  return async (ctx, args, deps) => {
    const module = addr(args, 'module');
    await ensureComplianceRow(deps.tx, ctx, ctx.address);
    await deps.tx.query(
      `UPDATE compliance_config
          SET modules = ${jsonbSetExpression('modules', 'to_jsonb($4::text)', '$3')},
              updated_block = $5
        WHERE chain_id = $1 AND compliance = $2`,
      [ctx.chainId, ctx.address, added, module, ctx.blockNumber.toString()],
    );

    if (added) {
      const entry = { address: module, kind: 'complianceModule' as const, assetId: ctx.assetId };
      deps.watched.add(entry);
      await persistWatched(deps.tx, ctx.chainId, entry, ctx.blockNumber);
    }
  };
}

function countryChange(allowed: boolean): Projector {
  return async (ctx, args, { tx }) => {
    const compliance = addr(args, 'compliance');
    await ensureComplianceRow(tx, ctx, compliance);
    await tx.query(
      `UPDATE compliance_config
          SET allowed_countries = ${jsonbSetExpression('allowed_countries', 'to_jsonb($4::int)', '$3')},
              updated_block = $5
        WHERE chain_id = $1 AND compliance = $2`,
      [ctx.chainId, compliance, allowed, num(args, 'country'), ctx.blockNumber.toString()],
    );
  };
}

const holdPeriodSet: Projector = async (ctx, args, { tx }) => {
  const compliance = addr(args, 'compliance');
  await ensureComplianceRow(tx, ctx, compliance);
  await tx.query(
    `UPDATE compliance_config SET hold_period_seconds = $3, updated_block = $4
      WHERE chain_id = $1 AND compliance = $2`,
    [ctx.chainId, compliance, big(args, 'holdPeriod').toString(), ctx.blockNumber.toString()],
  );
};

const holderLocked: Projector = async (ctx, args, { tx }) => {
  await tx.query(
    `INSERT INTO holder_locks (chain_id, compliance, holder, locked_until, updated_block)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (chain_id, compliance, holder)
     DO UPDATE SET locked_until = EXCLUDED.locked_until, updated_block = EXCLUDED.updated_block`,
    [
      ctx.chainId,
      addr(args, 'compliance'),
      addr(args, 'holder'),
      big(args, 'lockedUntil').toString(),
      ctx.blockNumber.toString(),
    ],
  );
};

export const identityProjectors: Record<string, Projector> = {
  IdentityRegistered: identityRegistered,
  IdentityRemoved: identityRemoved,
  IdentityUpdated: identityUpdated,
  CountryUpdated: identityField('country', 'country'),
  InvestorClassUpdated: identityField('investor_class', 'investorClass'),
  ClaimExpiryUpdated: identityField('claim_expires_at', 'expiresAt'),
};

export const complianceProjectors: Record<string, Projector> = {
  TokenBound: tokenBound,
  ModuleAdded: moduleChange(true),
  ModuleRemoved: moduleChange(false),
};

export const complianceModuleProjectors: Record<string, Projector> = {
  CountryAllowed: countryChange(true),
  CountryDisallowed: countryChange(false),
  HoldPeriodSet: holdPeriodSet,
  HolderLocked: holderLocked,
};
