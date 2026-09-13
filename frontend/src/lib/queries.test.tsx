import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ChainProvider } from "@/components/chain-provider";

/**
 * The two rules a chain-aware client must not get wrong (INTEGRATION_GUIDE §2.1):
 *  - every request carries the active chain, and the chain is in the query key;
 *  - a response for a different chain is an error, not data.
 *
 * `queries` is imported dynamically in `beforeAll`, after `VITE_API_URL` is stubbed, because
 * `api.ts` captures fixture mode at module load. Importing the API module statically would lock
 * the suite into fixture mode.
 */
let queries: Awaited<ReturnType<typeof loadQueries>>;

async function loadQueries() {
  return import("@/lib/queries");
}

beforeAll(async () => {
  vi.stubEnv("VITE_API_URL", "http://127.0.0.1:4000");
  queries = await loadQueries();
});

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ChainProvider>{children}</ChainProvider>
    </QueryClientProvider>
  );
}

function envelopeFor(chainId: number) {
  return JSON.stringify({
    data: [],
    meta: {
      chainId,
      indexedBlock: 1,
      indexedBlockHash: null,
      asOf: 1,
      provenance: "onchain",
      stale: false,
      lagBlocks: 0,
    },
  });
}

function mockResponse(chainId: number) {
  return new Response(envelopeFor(chainId), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("query paths carry the active chain", () => {
  it("requests the active chain and reports success", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(mockResponse(296)));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => queries.useAssets(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("chainId=296");
  });

  it("errors with CHAIN_MISMATCH when the response names another chain", async () => {
    // A fresh Response per call: a retry cannot re-read a consumed body.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(mockResponse(5042002)));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => queries.useMetrics("0xasset"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 4_000 });

    const error = result.current.error as { code?: string } | null;
    expect(error?.code).toBe("CHAIN_MISMATCH");
  });
});
