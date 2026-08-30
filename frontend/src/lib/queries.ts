"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
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
  type NavPoint,
  type Positions,
} from "@/lib/api";
import { fixtureAssets, fixtureCandles, fixturePositions } from "@/lib/fixtures";

/**
 * React Query bindings.
 *
 * Keys are namespaced `["api", route, ...params]` as Boundary C §4 requires, so a confirmed
 * transaction can invalidate a whole route family in one call.
 *
 * `staleTime` is held below the backend's own staleness window (60s on Anvil). Serving a
 * cached value for longer than the backend is willing to call it fresh would put the UI in
 * the position of asserting freshness the API has already disclaimed.
 */

const STALE_TIME_MS = 15_000;

/** In fixture mode the query resolves the local adapter instead of hitting the network. */
function useApiQuery<T>(
  key: readonly unknown[],
  path: string,
  fixture?: () => Envelope<T>,
  options: { enabled?: boolean; refetchInterval?: number } = {},
): UseQueryResult<Envelope<T>, Error> {
  return useQuery<Envelope<T>, Error>({
    queryKey: key,
    queryFn: ({ signal }) => {
      if (fixtureMode) {
        if (fixture === undefined) {
          throw new Error("no backend configured and no fixture for this panel");
        }
        return Promise.resolve(fixture());
      }
      return fetchJson<T>(path, signal);
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
    undefined,
    { enabled: assetId !== undefined },
  );
}

export function useMetrics(assetId: string | undefined) {
  return useApiQuery<AssetMetrics>(
    ["api", "metrics", assetId],
    `/v1/assets/${assetId}/metrics`,
    undefined,
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
    undefined,
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
    undefined,
    { enabled: assetId !== undefined },
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
