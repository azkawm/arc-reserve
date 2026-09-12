import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import { formatFixed, mulDiv, parseFixed, STABLE_DECIMALS, TOKEN_DECIMALS } from '../../lib/decimal.js';
import { priceAtTick } from '../../lib/tick.js';
import { buildMeta, respond, type Provenance } from '../envelope.js';
import {
  displayAddress,
  paginationSchema,
  positionKindName,
  redemptionModeName,
  safetyFailureName,
  slugify,
  statusName,
  ASSET_STATUS,
  assetIdParamSchema,
  chainQuerySchema,
} from '../schemas/common.js';
import {
  activitySchema,
  assetDetailSchema,
  assetListSchema,
  metricsSchema,
  navHistorySchema,
  positionsSchema,
  redemptionsSchema,
  revenueSchema,
} from '../schemas/assets.js';
import { toActivityItem } from '../activity.js';
import * as repo from '../repository.js';
import { readAssetSnapshot, type AssetSnapshot } from '../../chain/snapshot.js';
import type { ApiDeps } from './context.js';

const stable = (raw: bigint | string): string => formatFixed(BigInt(raw), STABLE_DECIMALS);
const token = (raw: bigint | string): string => formatFixed(BigInt(raw), TOKEN_DECIMALS);

export async function registerAssetRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { db, config, chains } = deps;

  /**
   * Everything a handler needs, resolved per request, because the chain is per request:
   * `?chainId=` picks it (Boundary C section 2) and the client, the registry address and every
   * projection query follow from it. Nothing here is cached across requests — a value read for
   * one chain must never be reachable from another.
   */
  async function forRequest(request: FastifyRequest) {
    const query = chainQuerySchema.safeParse(request.query);
    if (!query.success) throw ApiError.badRequest('invalid chainId', query.error.issues);
    const { chainId, client, registry } = await chains.resolve(query.data.chainId);

    /** Cursor and head, shared by every response envelope on this router. */
    async function envelopeInputs() {
      const cursor = await repo.loadCursor(db, chainId);
      const latestBlock = await client.getBlockNumber().catch(() => null);
      return { cursor, latestBlock };
    }

    function meta(
      inputs: Awaited<ReturnType<typeof envelopeInputs>>,
      provenance: Provenance,
    ): ReturnType<typeof buildMeta> {
      return buildMeta({
        chainId,
        provenance,
        staleAfterSeconds: config.STALE_AFTER_SECONDS,
        cursor: inputs.cursor,
        latestBlock: inputs.latestBlock,
      });
    }

    /**
     * Resolve an asset and read its contract state at the **indexed** block, so projections and
     * views in one response describe the same moment.
     */
    async function resolve(assetId: string) {
      const asset = await repo.getAssetRow(db, chainId, assetId.toLowerCase());
      if (asset === null) throw ApiError.notFound(`no asset ${assetId} on chain ${chainId}`);

      const deployment = await repo.getDeployment(db, chainId, asset.asset_id);
      const cursor = await repo.loadCursor(db, chainId);
      if (cursor === null) {
        throw new ApiError('INDEXER_BEHIND', 'nothing has been indexed yet');
      }

      return { asset, deployment, cursor };
    }

    /**
     * Signed percent change against the hourly close 24 hours ago.
     *
     * Null — not zero — whenever it cannot be computed: no pool, no candle that old, or a spot
     * price we would not vouch for. "Unchanged" and "unknown" are different statements, and a
     * dash is the honest rendering of the second.
     */
    async function change24h(
      deployment: repo.DeploymentRow | null,
      spot: { value: string; provenance: Provenance } | null,
    ): Promise<string | null> {
      if (deployment?.pool == null || spot === null) return null;

      const dayAgo = Math.floor(Date.now() / 1000) - 86_400;
      const previous = await repo.getCloseAt(db, chainId, deployment.pool, 3600, dayAgo);
      if (previous === null || previous === 0n) return null;

      const current = parseFixed(spot.value, STABLE_DECIMALS);
      // Two decimal places of percent, computed in integers: (current - previous) / previous.
      const scaled = mulDiv(current - previous, 10_000n, previous);
      return formatFixed(scaled, 2);
    }

    async function snapshotFor(
      deployment: repo.DeploymentRow,
      assetId: string,
      blockNumber: bigint,
    ): Promise<AssetSnapshot> {
      return readAssetSnapshot(
        client,
        registry,
        {
          assetId,
          token: deployment.token as `0x${string}`,
          vault: deployment.vault as `0x${string}`,
          offering: deployment.offering as `0x${string}`,
          marketManager: deployment.market_manager as `0x${string}`,
          revenueDistributor: deployment.revenue_distributor as `0x${string}`,
          redemptionController: deployment.redemption_controller as `0x${string}`,
          pool: deployment.pool as `0x${string}` | null,
          floorController: deployment.floor_controller as `0x${string}` | null,
        },
        blockNumber,
      );
    }

    return { chainId, registry, envelopeInputs, meta, resolve, change24h, snapshotFor };
  }

  // --- GET /v1/assets ------------------------------------------------------

  app.get('/v1/assets', async (request, reply) => {
    const ctx = await forRequest(request);
    const query = paginationSchema
      .extend({ status: z.enum(ASSET_STATUS).optional() })
      .safeParse(request.query);
    if (!query.success) throw ApiError.badRequest('invalid query', query.error.issues);

    const statusIndex =
      query.data.status === undefined ? undefined : ASSET_STATUS.indexOf(query.data.status);

    const rows = await repo.listAssetRows(db, ctx.chainId, {
      ...(statusIndex === undefined ? {} : { status: statusIndex }),
      limit: query.data.limit,
      ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }),
    });

    const inputs = await ctx.envelopeInputs();
    const deployments = await repo.getDeployments(
      db,
      ctx.chainId,
      rows.map((row) => row.asset_id),
    );

    const items = await Promise.all(
      rows.map(async (row) => {
        const deployment = deployments.get(row.asset_id) ?? null;
        const balances =
          deployment === null
            ? null
            : await repo.getVaultBalances(db, ctx.chainId, deployment.vault);

        let spot: { value: string; provenance: Provenance } | null = null;
        let floor: string | null = null;
        let symbol = row.symbol ?? '';

        if (deployment !== null && inputs.cursor !== null) {
          const snapshot = await ctx.snapshotFor(deployment, row.asset_id, inputs.cursor.blockNumber);
          symbol = snapshot.token.symbol;
          floor = snapshot.redemption.normalPrice === null
            ? null
            : stable(snapshot.redemption.normalPrice);
          spot = marketSpot(snapshot);
        }

        return {
          assetId: row.asset_id,
          slug: slugify(row.name),
          name: row.name,
          symbol,
          category: row.category,
          status: statusName(row.status),
          issuer: displayAddress(row.issuer),
          spot,
          floor,
          reserve: balances === null ? null : stable(balances.redemption_reserve ?? '0'),
          change24h: await ctx.change24h(deployment, spot),
          contracts: deployment === null ? null : contractsOf(deployment),
        };
      }),
    );

    return respond(reply, assetListSchema, items, ctx.meta(inputs, 'onchain'));
  });

  // --- GET /v1/assets/:assetId --------------------------------------------

  app.get('/v1/assets/:assetId', async (request, reply) => {
    const ctx = await forRequest(request);
    const params = assetIdParamSchema.safeParse(request.params);
    if (!params.success) throw ApiError.badRequest('invalid assetId', params.error.issues);

    const { asset, deployment } = await ctx.resolve(params.data.assetId);
    const inputs = await ctx.envelopeInputs();

    let symbol = asset.symbol ?? '';
    if (deployment !== null && inputs.cursor !== null) {
      const snapshot = await ctx.snapshotFor(deployment, asset.asset_id, inputs.cursor.blockNumber);
      symbol = snapshot.token.symbol;
    }

    return respond(
      reply,
      assetDetailSchema,
      {
        assetId: asset.asset_id,
        slug: slugify(asset.name),
        name: asset.name,
        symbol,
        category: asset.category,
        status: statusName(asset.status),
        issuer: displayAddress(asset.issuer),
        metadataURI: asset.metadata_uri,
        metadataHash: asset.metadata_hash,
        maturity: Number(asset.maturity_timestamp),
        submittedAt: Number(asset.submitted_at),
        termsHash: asset.terms_hash,
        contracts: deployment === null ? null : contractsOf(deployment),
      },
      ctx.meta(inputs, 'onchain'),
    );
  });

  // --- GET /v1/assets/:assetId/metrics ------------------------------------

  app.get('/v1/assets/:assetId/metrics', async (request, reply) => {
    const ctx = await forRequest(request);
    const params = assetIdParamSchema.safeParse(request.params);
    if (!params.success) throw ApiError.badRequest('invalid assetId', params.error.issues);

    const { asset, deployment, cursor } = await ctx.resolve(params.data.assetId);
    if (deployment === null) {
      throw ApiError.notFound(`asset ${asset.asset_id} has no deployed system yet`);
    }

    const inputs = await ctx.envelopeInputs();
    const snapshot = await ctx.snapshotFor(deployment, asset.asset_id, cursor.blockNumber);
    const now = Math.floor(Date.now() / 1000);

    const floorRaw =
      snapshot.redemption.normalPrice ??
      minBigint(snapshot.registry.nav, backingPerToken(snapshot));

    const payload = {
      nav: {
        value: stable(snapshot.registry.nav),
        raw: snapshot.registry.nav.toString(),
        timestamp: Number(snapshot.registry.navTimestamp),
        // Recomputed by the registry at this block, never a stored boolean.
        stale: snapshot.registry.isNAVStale,
        // A NAV expires on a timer, and every keeper and liquidity path is blocked once it
        // does. Publishing the deadline lets a UI warn before that, not after.
        staleAfterSeconds: snapshot.registry.navStaleAfter,
        expiresAt:
          snapshot.registry.navStaleAfter === null
            ? null
            : Number(snapshot.registry.navTimestamp) + snapshot.registry.navStaleAfter,
      },
      marketStatus: marketStatusOf(snapshot),
      spot: spotField(snapshot, Number(cursor.blockNumber)),
      twap: twapField(snapshot),
      floorReference: {
        value: stable(floorRaw),
        raw: floorRaw.toString(),
        formula: 'min(nav, redemptionReserve / investorSupply)',
      },
      redemptionPrice: {
        normal: nullableStable(snapshot.redemption.normalPrice),
        maturity: nullableStable(snapshot.redemption.maturityPrice),
        emergency: nullableStable(snapshot.redemption.emergencyPrice),
      },
      reserve: {
        redemptionReserve: stable(snapshot.vault.redemptionReserve),
        marketMakingAllocation: stable(snapshot.vault.marketMakingAllocation),
        assetRevenue: stable(snapshot.vault.assetRevenue),
        issuerProceeds: stable(snapshot.vault.issuerProceeds),
        protocolFees: stable(snapshot.vault.protocolFees),
        totalAccounted: stable(snapshot.vault.totalAccounted),
        vaultBalance: stable(snapshot.vault.totalStablecoinBalance),
        reserveRatioBps:
          snapshot.vault.reserveRatioBps === null ? null : snapshot.vault.reserveRatioBps.toString(),
        minimumReserveRatioBps: snapshot.vault.minimumReserveRatioBps,
        minimumRequiredReserve: stable(snapshot.vault.minimumRequiredReserve),
        isSolvent: snapshot.vault.isSolvent,
        availableRedemptionLiquidity: stable(snapshot.vault.availableRedemptionLiquidity),
      },
      reserveSchedule:
        snapshot.vault.schedule === null
          ? null
          : {
              startBacking: stable(snapshot.vault.schedule.startBacking),
              targetBacking: stable(snapshot.vault.schedule.targetBacking),
              // Rises with time, so it is read now rather than projected from an event.
              targetBackingNow: stable(snapshot.vault.targetBackingNow ?? 0n),
              currentBacking: stable(snapshot.vault.currentBacking ?? 0n),
              startTime: Number(snapshot.vault.schedule.startTime),
              maturity: Number(snapshot.vault.schedule.maturity),
              graceSeconds: Number(snapshot.vault.schedule.graceSeconds),
              behindSchedule: snapshot.vault.isBehindSchedule ?? false,
              inEnforcedShortfall: snapshot.vault.isInEnforcedShortfall ?? false,
              shortfallStartedAt:
                snapshot.vault.shortfallStartedAt === null ||
                snapshot.vault.shortfallStartedAt === 0n
                  ? null
                  : Number(snapshot.vault.shortfallStartedAt),
            },
      supply: {
        maximum: token(snapshot.token.maximumSupply),
        issued: token(snapshot.token.totalSupply),
        excluded: token(snapshot.revenue.excludedSupply),
        investor: token(snapshot.token.investorSupply),
        eligibleCirculating: token(snapshot.revenue.yieldEligibleSupply),
        headroom: token(snapshot.token.maximumSupply - snapshot.token.totalSupply),
        // D-031 removed the company allocation; no vesting wallet is deployed.
        vesting: null,
      },
      offering: {
        price: stable(snapshot.offering.tokenPrice),
        raised: stable(snapshot.offering.stablecoinRaised),
        cap: stable(snapshot.offering.fundraisingCap),
        sold: token(snapshot.offering.tokensSold),
        inventory: token(snapshot.offering.availableTokenInventory),
        walletLimit: stable(snapshot.offering.walletPurchaseLimit),
        minimumPurchase: stable(snapshot.offering.minimumPurchase),
        startsAt: Number(snapshot.offering.startsAt),
        endsAt: Number(snapshot.offering.endsAt),
        // A function of now(), so computed per request rather than stored.
        open:
          !snapshot.offering.paused &&
          now >= Number(snapshot.offering.startsAt) &&
          now <= Number(snapshot.offering.endsAt) &&
          snapshot.offering.stablecoinRaised < snapshot.offering.fundraisingCap,
      },
      redemption: {
        periodStartedAt: Number(snapshot.redemption.periodStartedAt),
        periodDuration: Number(snapshot.redemption.periodDuration),
        redeemedThisPeriod: token(snapshot.redemption.redeemedThisPeriod),
        periodLimit: token(snapshot.redemption.periodLimitTokens),
        totalRedeemedTokens: token(snapshot.redemption.totalRedeemedTokens),
        totalStablecoinPaid: stable(snapshot.redemption.totalStablecoinPaid),
      },
      floor:
        snapshot.floor === null
          ? null
          : {
              controller: displayAddress(snapshot.floor.controller),
              tick: snapshot.floor.floorTick,
              price: stable(snapshot.floor.floorPrice),
              // Read live at the indexed block, never derived from FloorLevelUp history.
              covered: snapshot.floor.covered,
              canLevelUp: snapshot.floor.canLevelUp,
              nextTick: snapshot.floor.nextTick,
              cooldownSeconds: snapshot.floor.cooldownSeconds,
              lastLevelUpAt: Number(snapshot.floor.lastLevelUpAt),
            },
      maturity: Number(snapshot.registry.maturity),
      safety:
        snapshot.market === null || snapshot.market.safety === null
          ? null
          : {
              failure: safetyFailureName(snapshot.market.safety.failure),
              checkedWithCooldown: true,
              lastRebalanceAt: Number(snapshot.market.lastRebalanceAt),
              cooldownSeconds: snapshot.market.rebalanceCooldown,
            },
    };

    return respond(reply, metricsSchema, payload, ctx.meta(inputs, 'onchain'));
  });

  // --- GET /v1/assets/:assetId/nav-history --------------------------------

  app.get('/v1/assets/:assetId/nav-history', async (request, reply) => {
    const ctx = await forRequest(request);
    const params = assetIdParamSchema.safeParse(request.params);
    if (!params.success) throw ApiError.badRequest('invalid assetId', params.error.issues);

    const query = z
      .object({
        from: z.coerce.number().int().optional(),
        to: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(500),
      })
      .safeParse(request.query);
    if (!query.success) throw ApiError.badRequest('invalid query', query.error.issues);

    const { asset } = await ctx.resolve(params.data.assetId);
    const inputs = await ctx.envelopeInputs();

    const rows = await repo.getNavHistory(db, ctx.chainId, asset.asset_id, {
      ...(query.data.from === undefined ? {} : { from: query.data.from }),
      ...(query.data.to === undefined ? {} : { to: query.data.to }),
      limit: query.data.limit,
    });

    return respond(
      reply,
      navHistorySchema,
      rows.map((row) => ({
        timestamp: Number(row.nav_timestamp),
        nav: stable(row.new_nav),
        previousNav: stable(row.previous_nav),
        txHash: row.transaction_hash,
      })),
      ctx.meta(inputs, 'onchain'),
    );
  });

  // --- GET /v1/assets/:assetId/positions ----------------------------------

  app.get('/v1/assets/:assetId/positions', async (request, reply) => {
    const ctx = await forRequest(request);
    const params = assetIdParamSchema.safeParse(request.params);
    if (!params.success) throw ApiError.badRequest('invalid assetId', params.error.issues);

    const { asset, deployment, cursor } = await ctx.resolve(params.data.assetId);
    if (deployment === null) throw ApiError.notFound('asset has no deployed system yet');

    const inputs = await ctx.envelopeInputs();
    const snapshot = await ctx.snapshotFor(deployment, asset.asset_id, cursor.blockNumber);
    const lastActions = await repo.getLastPositionActions(
      db,
      ctx.chainId,
      deployment.market_manager,
    );

    if (snapshot.market === null) throw ApiError.notFound('asset has no market manager');
    const market = snapshot.market;

    const positions = market.positions.map((position) => {
      const action = lastActions.get(position.kind) ?? null;
      const priceOptions = {
        assetIsToken0: market.assetIsToken0,
        assetDecimals: TOKEN_DECIMALS,
        stableDecimals: STABLE_DECIMALS,
      };

      // Ticks map to price monotonically, but the direction flips with token order: when the
      // asset is token1, the lower tick is the *higher* stable price.
      const lower = priceAtTick(position.tickLower, priceOptions);
      const upper = priceAtTick(position.tickUpper, priceOptions);
      const [priceLower, priceUpper] = lower <= upper ? [lower, upper] : [upper, lower];

      return {
        kind: positionKindName(position.kind),
        configured: position.configured,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        priceLower: position.configured ? stable(priceLower) : null,
        priceUpper: position.configured ? stable(priceUpper) : null,
        liquidity: position.liquidity.toString(),
        lastAction:
          action === null
            ? null
            : {
                type: action.action,
                timestamp: Number(action.block_timestamp),
                txHash: action.transaction_hash,
              },
      };
    });

    return respond(
      reply,
      positionsSchema,
      {
        assetIsToken0: market.assetIsToken0,
        tickSpacing: market.tickSpacing,
        currentTick: market.meanTick,
        positions,
      },
      ctx.meta(inputs, 'onchain'),
    );
  });

  // --- GET /v1/assets/:assetId/activity -----------------------------------

  app.get('/v1/assets/:assetId/activity', async (request, reply) => {
    const ctx = await forRequest(request);
    const params = assetIdParamSchema.safeParse(request.params);
    if (!params.success) throw ApiError.badRequest('invalid assetId', params.error.issues);

    const query = paginationSchema
      .extend({ type: z.string().max(40).optional() })
      .safeParse(request.query);
    if (!query.success) throw ApiError.badRequest('invalid query', query.error.issues);

    const { asset, deployment } = await ctx.resolve(params.data.assetId);
    const inputs = await ctx.envelopeInputs();

    const addresses =
      deployment === null
        ? [ctx.registry]
        : [
            ctx.registry,
            deployment.token,
            deployment.vault,
            deployment.offering,
            deployment.market_manager,
            deployment.revenue_distributor,
            deployment.redemption_controller,
          ];

    const rows = await repo.getAssetLogs(db, ctx.chainId, addresses, {
      // Over-fetch: registry logs cover every asset and some events map to no activity type.
      limit: query.data.limit * 4,
    });

    const items = rows
      .map(toActivityItem)
      .filter((item): item is NonNullable<typeof item> => item !== null)
      // Registry events cover every asset on the chain; keep only this one's.
      .filter((item) => {
        const itemAssetId = item.summary.assetId;
        return itemAssetId === undefined || String(itemAssetId).toLowerCase() === asset.asset_id;
      })
      .filter((item) => query.data.type === undefined || item.type === query.data.type)
      .slice(0, query.data.limit);

    return respond(reply, activitySchema, items, ctx.meta(inputs, 'onchain'));
  });

  // --- GET /v1/assets/:assetId/revenue ------------------------------------

  app.get('/v1/assets/:assetId/revenue', async (request, reply) => {
    const ctx = await forRequest(request);
    const params = assetIdParamSchema.safeParse(request.params);
    if (!params.success) throw ApiError.badRequest('invalid assetId', params.error.issues);

    const { asset, deployment, cursor } = await ctx.resolve(params.data.assetId);
    if (deployment === null) throw ApiError.notFound('asset has no deployed system yet');

    const inputs = await ctx.envelopeInputs();
    const [totals, deposits, snapshot] = await Promise.all([
      repo.getRevenueTotals(db, ctx.chainId, asset.asset_id),
      repo.getRevenueDeposits(db, ctx.chainId, asset.asset_id, 200),
      ctx.snapshotFor(deployment, asset.asset_id, cursor.blockNumber),
    ]);

    return respond(
      reply,
      revenueSchema,
      {
        totalDeposited: stable(totals.gross ?? '0'),
        totalHolder: stable(totals.holder ?? '0'),
        totalReserve: stable(totals.reserve ?? '0'),
        totalOperator: stable(totals.operator ?? '0'),
        totalProtocol: stable(totals.protocol ?? '0'),
        totalClaimed: stable(snapshot.revenue.totalClaimed),
        operatorAccrued: stable(snapshot.revenue.operatorAccrued),
        deposits: deposits.map((row) => ({
          timestamp: Number(row.block_timestamp),
          txHash: row.transaction_hash,
          periodId: row.period_id,
          reportHash: row.report_hash,
          behindSchedule: row.behind_schedule,
          gross: stable(row.gross_amount),
          holder: stable(row.holder_amount),
          reserve: stable(row.reserve_amount),
          operator: stable(row.operator_amount),
          protocol: stable(row.protocol_amount),
        })),
      },
      ctx.meta(inputs, 'onchain'),
    );
  });

  // --- GET /v1/assets/:assetId/redemptions --------------------------------

  app.get('/v1/assets/:assetId/redemptions', async (request, reply) => {
    const ctx = await forRequest(request);
    const params = assetIdParamSchema.safeParse(request.params);
    if (!params.success) throw ApiError.badRequest('invalid assetId', params.error.issues);

    const { asset, deployment, cursor } = await ctx.resolve(params.data.assetId);
    if (deployment === null) throw ApiError.notFound('asset has no deployed system yet');

    const inputs = await ctx.envelopeInputs();
    const [history, snapshot] = await Promise.all([
      repo.getRedemptions(db, ctx.chainId, asset.asset_id, 200),
      ctx.snapshotFor(deployment, asset.asset_id, cursor.blockNumber),
    ]);

    const remaining =
      snapshot.redemption.periodLimitTokens > snapshot.redemption.redeemedThisPeriod
        ? snapshot.redemption.periodLimitTokens - snapshot.redemption.redeemedThisPeriod
        : 0n;

    return respond(
      reply,
      redemptionsSchema,
      {
        totalRedeemedTokens: token(snapshot.redemption.totalRedeemedTokens),
        totalStablecoinPaid: stable(snapshot.redemption.totalStablecoinPaid),
        emergencySettlementPrice: stable(snapshot.redemption.emergencySettlementPrice),
        currentPeriod: {
          startedAt: Number(snapshot.redemption.periodStartedAt),
          duration: Number(snapshot.redemption.periodDuration),
          redeemed: token(snapshot.redemption.redeemedThisPeriod),
          limit: token(snapshot.redemption.periodLimitTokens),
          remaining: token(remaining),
        },
        history: history.map((row) => ({
          timestamp: Number(row.block_timestamp),
          txHash: row.transaction_hash,
          holder: displayAddress(row.holder),
          mode: redemptionModeName(row.mode),
          tokenAmount: token(row.token_amount),
          stablecoinAmount: stable(row.stablecoin_amount),
          nav: stable(row.nav),
          price: stable(row.redemption_price),
        })),
      },
      ctx.meta(inputs, 'onchain'),
    );
  });
}

// ---------------------------------------------------------------------------

function contractsOf(deployment: repo.DeploymentRow) {
  return {
    token: displayAddress(deployment.token),
    vault: displayAddress(deployment.vault),
    offering: displayAddress(deployment.offering),
    marketManager: displayAddress(deployment.market_manager),
    revenueDistributor: displayAddress(deployment.revenue_distributor),
    redemptionController: displayAddress(deployment.redemption_controller),
    pool: deployment.pool === null ? null : displayAddress(deployment.pool),
    floorController:
      deployment.floor_controller === null ? null : displayAddress(deployment.floor_controller),
  };
}

/**
 * Market price provenance.
 *
 * `marketPrices()` is a real contract read, but on a `MockUniswapV3Pool` the number it
 * returns comes from a harness whose price does not move with trading. Serving that as
 * `onchain` would be exactly the silent mock-as-live substitution D-019 forbids, so the
 * pool's own bytecode decides the label.
 */
function marketSpot(snapshot: AssetSnapshot): { value: string; provenance: Provenance } | null {
  if (snapshot.market === null || snapshot.market.spotPrice === null) return null;
  return {
    value: formatFixed(snapshot.market.spotPrice, STABLE_DECIMALS),
    provenance: snapshot.market.poolIsCanonical ? 'onchain' : 'mock',
  };
}

function marketStatusOf(snapshot: AssetSnapshot): 'ready' | 'warming_up' | 'unavailable' {
  if (snapshot.market === null) return 'unavailable';
  if (snapshot.market.spotPrice !== null && snapshot.market.twapPrice !== null) return 'ready';
  return snapshot.market.oracleWarmingUp ? 'warming_up' : 'unavailable';
}

function spotField(snapshot: AssetSnapshot, sourceBlock: number) {
  if (snapshot.market === null || snapshot.market.spotPrice === null) return null;
  return {
    value: {
      value: formatFixed(snapshot.market.spotPrice, STABLE_DECIMALS),
      raw: snapshot.market.spotPrice.toString(),
      sourceBlock,
    },
    provenance: (snapshot.market.poolIsCanonical ? 'onchain' : 'mock') as Provenance,
  };
}

function twapField(snapshot: AssetSnapshot) {
  if (snapshot.market === null || snapshot.market.twapPrice === null) return null;
  return {
    value: {
      value: formatFixed(snapshot.market.twapPrice, STABLE_DECIMALS),
      raw: snapshot.market.twapPrice.toString(),
      windowSeconds: snapshot.market.twapWindow,
    },
    provenance: (snapshot.market.poolIsCanonical ? 'onchain' : 'mock') as Provenance,
  };
}

function backingPerToken(snapshot: AssetSnapshot): bigint {
  if (snapshot.token.investorSupply === 0n) return 0n;
  return (
    (snapshot.vault.redemptionReserve * 10n ** BigInt(TOKEN_DECIMALS)) /
    snapshot.token.investorSupply
  );
}

function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function nullableStable(value: bigint | null): string | null {
  return value === null ? null : formatFixed(value, STABLE_DECIMALS);
}
