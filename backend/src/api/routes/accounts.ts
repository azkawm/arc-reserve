import type { FastifyInstance } from 'fastify';
import { getAddress } from 'viem';
import { ApiError } from '../../lib/errors.js';
import { formatFixed, STABLE_DECIMALS, TOKEN_DECIMALS } from '../../lib/decimal.js';
import { buildMeta, respond } from '../envelope.js';
import { accountParamsSchema, displayAddress } from '../schemas/common.js';
import { accountPositionSchema } from '../schemas/assets.js';
import { toActivityItem } from '../activity.js';
import * as repo from '../repository.js';
import { loadAbi } from '../../chain/abis.js';
import type { ApiDeps } from './context.js';

const stable = (raw: bigint | string): string => formatFixed(BigInt(raw), STABLE_DECIMALS);
const token = (raw: bigint | string): string => formatFixed(BigInt(raw), TOKEN_DECIMALS);

/**
 * `GET /v1/accounts/:address/assets/:assetId`
 *
 * Display and history only. Boundary C §3.7 is explicit that the UI still reads
 * `balanceOf` / `allowance` / `claimableRevenue` directly from chain before it transacts:
 * an indexed balance is a statement about a past block, and signing against a past block is
 * how a user ends up with a reverted transaction.
 */
export async function registerAccountRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { db, client, config } = deps;

  app.get('/v1/accounts/:address/assets/:assetId', async (request, reply) => {
    const params = accountParamsSchema.safeParse(request.params);
    if (!params.success) throw ApiError.badRequest('invalid parameters', params.error.issues);

    const address = params.data.address.toLowerCase() as `0x${string}`;
    const assetId = params.data.assetId.toLowerCase();

    const asset = await repo.getAssetRow(db, config.CHAIN_ID, assetId);
    if (asset === null) throw ApiError.notFound(`no asset ${assetId} on chain ${config.CHAIN_ID}`);

    const deployment = await repo.getDeployment(db, config.CHAIN_ID, assetId);
    if (deployment === null) throw ApiError.notFound('asset has no deployed system yet');

    const cursor = await repo.loadCursor(db, config.CHAIN_ID);
    if (cursor === null) throw new ApiError('INDEXER_BEHIND', 'nothing has been indexed yet');

    const latestBlock = await client.getBlockNumber().catch(() => null);

    const [holder, identity, purchased, logs] = await Promise.all([
      repo.getHolder(db, config.CHAIN_ID, deployment.token, address),
      repo.getIdentity(db, config.CHAIN_ID, address),
      repo.getPurchasedByWallet(db, config.CHAIN_ID, assetId, address),
      repo.getAssetLogs(
        db,
        config.CHAIN_ID,
        [
          deployment.token,
          deployment.offering,
          deployment.revenue_distributor,
          deployment.redemption_controller,
        ],
        { limit: 100, actor: address },
      ),
    ]);

    // Claimable revenue and the wallet limit are read from chain at the indexed block: both
    // depend on accumulator state the events do not carry.
    const [claimable, remainingAllowance, redemptionPrice] = await Promise.all([
      readOrNull<bigint>(() =>
        client.readContract({
          address: getAddress(deployment.revenue_distributor),
          abi: loadAbi('RevenueDistributor'),
          functionName: 'claimableRevenue',
          args: [getAddress(address)],
          blockNumber: cursor.blockNumber,
        }) as Promise<bigint>,
      ),
      /**
       * D-028. `remainingAllowance` folds the effective wallet cap, the class aggregate cap
       * and the remaining raise into one number. The flat `walletPurchaseLimit` it replaces
       * is wrong the moment any class is configured — and the demo now configures three.
       */
      readOrNull<bigint>(() =>
        client.readContract({
          address: getAddress(deployment.offering),
          abi: loadAbi('PrimaryOffering'),
          functionName: 'remainingAllowance',
          args: [getAddress(address)],
          blockNumber: cursor.blockNumber,
        }) as Promise<bigint>,
      ),
      readOrNull<bigint>(() =>
        client.readContract({
          address: getAddress(deployment.redemption_controller),
          abi: loadAbi('RedemptionController'),
          functionName: 'redemptionPrice',
          args: [0],
          blockNumber: cursor.blockNumber,
        }) as Promise<bigint>,
      ),
    ]);

    const balance = BigInt(holder?.balance ?? '0');
    const purchasedRaw = BigInt(purchased);
    // Read whole from the contract, not derived by subtracting purchases from a flat cap:
    // the class aggregate and the remaining raise can bind before the wallet cap does.
    const remainingLimit = remainingAllowance ?? 0n;

    // isVerified is a function of now(), so it is recomputed here from the stored claim
    // rather than read from a column that was correct only when it was written.
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expiry = identity?.claim_expires_at ?? null;
    const verified =
      identity !== null && identity.registered && (expiry === null || expiry === 0n || expiry > now);

    const history = logs
      .map(toActivityItem)
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const payload = {
      address: displayAddress(address),
      assetId,
      tokenBalance: token(balance),
      yieldExcluded: holder?.yield_excluded ?? false,
      issuerAllocation: holder?.issuer_allocation ?? false,
      // Excluded balances are not eligible, so the eligible figure is not simply the balance.
      yieldEligibleBalance: token(holder?.yield_excluded === true ? 0n : balance),
      claimable: stable(claimable ?? 0n),
      frozen: holder?.frozen ?? false,
      frozenTokens: token(holder?.frozen_tokens ?? '0'),
      complianceExempt: holder?.compliance_exempt ?? false,
      verified,
      identity:
        identity === null
          ? null
          : {
              country: identity.country,
              investorClass: identity.investor_class,
              claimExpiresAt:
                identity.claim_expires_at === null || identity.claim_expires_at === 0n
                  ? null
                  : Number(identity.claim_expires_at),
              registered: identity.registered,
            },
      purchasedThisOffering: stable(purchasedRaw),
      remainingWalletLimit: stable(remainingLimit),
      redemptionQuote:
        redemptionPrice === null
          ? null
          : {
              mode: 'Normal' as const,
              price: stable(redemptionPrice),
              maxTokensThisPeriod: token(balance),
            },
      history,
    };

    return respond(
      reply,
      accountPositionSchema,
      payload,
      buildMeta({
        chainId: config.CHAIN_ID,
        provenance: 'onchain',
        staleAfterSeconds: config.STALE_AFTER_SECONDS,
        cursor,
        latestBlock,
      }),
    );
  });
}

async function readOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}
