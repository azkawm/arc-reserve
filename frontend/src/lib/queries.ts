import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  ApiError,
  fetchJson,
  fixtureMode,
  type AccountPosition,
  type ActivityItem,
  type AssetDetail,
  type AssetListItem,
  type AssetMetrics,
  type CandleInterval,
  type Candles,
  type Envelope,
  type HealthPayload,
  type NavPoint,
  type Positions,
  type Redemptions,
  type Revenue,
  type SwapQuote,
} from "@/lib/api";
import { useChain } from "@/lib/chain-context";
import {
  fixtureActivity,
  fixtureAssetDetail,
  fixtureAssets,
  fixtureCandles,
  fixtureMetrics,
  fixtureNavHistory,
  fixturePositions,
  fixtureRedemptions,
  fixtureRevenue,
} from "@/lib/fixtures";

/**
 * React Query bindings.
 *
 * Keys are namespaced `["api", route, ...params, chainId]` as Boundary C §4 requires, so a
 * confirmed transaction can invalidate a whole route family in one call. **The chain is part of
 * every key**: without it a chain switch would serve the previous chain's cache.
 *
 * `staleTime` is held below the backend's own staleness window (60s on Anvil). Serving a
 * cached value for longer than the backend is willing to call it fresh would put the UI in
 * the position of asserting freshness the API has already disclaimed.
 */

const STALE_TIME_MS = 15_000;

/** Append the active chain to a path, honouring an existing query string. */
function withChain(path: string, chainId: number): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}chainId=${chainId}`;
}

/** In fixture mode the query resolves the local adapter instead of hitting the network. */
function useApiQuery<T>(
  key: readonly unknown[],
  path: string,
  fixture?: () => Envelope<T>,
  options: { enabled?: boolean; refetchInterval?: number } = {},
): UseQueryResult<Envelope<T>, Error> {
  const { chainId } = useChain();

  return useQuery<Envelope<T>, Error>({
    // The chain is appended here once, so no caller can forget it (INTEGRATION_GUIDE §2.1).
    queryKey: [...key, chainId],
    queryFn: async ({ signal }) => {
      if (fixtureMode) {
        if (fixture === undefined) {
          throw new Error("no backend configured and no fixture for this panel");
        }
        return fixture();
      }
      const envelope = await fetchJson<T>(withChain(path, chainId), signal);
      // Never trust that the request was honoured: the response names its own chain.
      if (envelope.meta.chainId !== chainId) {
        throw new ApiError(
          "CHAIN_MISMATCH",
          `requested chain ${chainId} but the response was for ${envelope.meta.chainId}`,
        );
      }
      return envelope;
    },
    staleTime: STALE_TIME_MS,
    retry: 1,
    enabled: options.enabled ?? true,
    ...(options.refetchInterval === undefined
      ? {}
      : { refetchInterval: options.refetchInterval }),
  });
}

export function useAssets(status?: string) {
  const query = status === undefined ? "" : `?status=${encodeURIComponent(status)}`;
  return useApiQuery<AssetListItem[]>(["api", "assets", status ?? "all"], `/v1/assets${query}`, fixtureAssets);
}

export function useAsset(assetId: string | undefined) {
  return useApiQuery<AssetDetail>(
    ["api", "asset", assetId],
    `/v1/assets/${assetId}`,
    fixtureAssetDetail,
    { enabled: assetId !== undefined },
  );
}

export function useMetrics(assetId: string | undefined) {
  return useApiQuery<AssetMetrics>(
    ["api", "metrics", assetId],
    `/v1/assets/${assetId}/metrics`,
    fixtureMetrics,
    { enabled: assetId !== undefined },
  );
}

export function useCandles(assetId: string | undefined, interval: CandleInterval) {
  return useApiQuery<Candles>(
    ["api", "candles", assetId, interval],
    `/v1/assets/${assetId}/candles?interval=${interval}&limit=200`,
    fixtureCandles,
    { enabled: assetId !== undefined || fixtureMode },
  );
}

export function useNavHistory(assetId: string | undefined) {
  return useApiQuery<NavPoint[]>(
    ["api", "nav-history", assetId],
    `/v1/assets/${assetId}/nav-history?limit=200`,
    fixtureNavHistory,
    { enabled: assetId !== undefined },
  );
}

export function usePositions(assetId: string | undefined) {
  return useApiQuery<Positions>(
    ["api", "positions", assetId],
    `/v1/assets/${assetId}/positions`,
    fixturePositions,
    { enabled: assetId !== undefined || fixtureMode },
  );
}

export function useActivity(assetId: string | undefined, type?: string) {
  const query = type === undefined ? "?limit=25" : `?limit=25&type=${encodeURIComponent(type)}`;
  return useApiQuery<ActivityItem[]>(
    ["api", "activity", assetId, type ?? "all"],
    `/v1/assets/${assetId}/activity${query}`,
    fixtureActivity,
    { enabled: assetId !== undefined },
  );
}

export function useRevenue(assetId: string | undefined) {
  return useApiQuery<Revenue>(
    ["api", "revenue", assetId],
    `/v1/assets/${assetId}/revenue`,
    fixtureRevenue,
    { enabled: assetId !== undefined },
  );
}

export function useRedemptions(assetId: string | undefined) {
  return useApiQuery<Redemptions>(
    ["api", "redemptions", assetId],
    `/v1/assets/${assetId}/redemptions`,
    fixtureRedemptions,
    { enabled: assetId !== undefined },
  );
}

/**
 * A live quote for a swap. Not served in fixture mode, so the query is disabled there rather
 * than fabricating a price. `amountIn` is a decimal string in `tokenIn`'s own decimals.
 */
export function useSwapQuote(
  assetId: string | undefined,
  tokenIn: string | undefined,
  amountIn: string | undefined,
) {
  const params = new URLSearchParams();
  if (tokenIn !== undefined) params.set("tokenIn", tokenIn);
  if (amountIn !== undefined) params.set("amountIn", amountIn);
  return useApiQuery<SwapQuote>(
    ["api", "swap-quote", assetId, tokenIn, amountIn],
    `/v1/assets/${assetId}/swap-quote?${params.toString()}`,
    undefined,
    { enabled: assetId !== undefined && tokenIn !== undefined && amountIn !== undefined && !fixtureMode },
  );
}

export function useAccountPosition(address: string | undefined, assetId: string | undefined) {
  return useApiQuery<AccountPosition>(
    ["api", "account", address, assetId],
    `/v1/accounts/${address}/assets/${assetId}`,
    undefined,
    { enabled: address !== undefined && assetId !== undefined },
  );
}

/**
 * Service health, used for global degraded / backfill / risk-coverage states. It is the one
 * route that reports a chain it may not index, so the caller reads the row it needs by chainId.
 * Disabled in fixture mode, where there is no service to ask.
 */
export function useHealth(refetchInterval = 30_000) {
  return useApiQuery<HealthPayload>(["api", "health"], "/v1/health", undefined, {
    enabled: !fixtureMode,
    refetchInterval,
  });
}

/**
 * The first asset, which is what every single-asset panel on the demo wants. Returning the
 * list query's state unchanged keeps loading and error handling in one place.
 */
export function usePrimaryAsset(): {
  asset: AssetListItem | undefined;
  query: ReturnType<typeof useAssets>;
} {
  const query = useAssets();
  return { asset: query.data?.data[0], query };
}

/**
 * Resolve a URL slug to the indexed asset. The bytes32 assetId is the canonical key; the slug
 * is a routing convenience, so the lookup happens once here rather than in every panel.
 */
export function useAssetBySlug(slug: string) {
  const assets = useAssets();
  const asset = assets.data?.data.find((entry) => entry.slug === slug);
  return { asset, assetId: asset?.assetId, query: assets };
}
