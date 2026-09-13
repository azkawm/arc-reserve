import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The rule under test is D-019: fixture mode is a *configured* mode, and a failed live request
 * is an error state that must never decay into a believable mock number.
 *
 * `apiBaseUrl` and `fixtureMode` are module-level constants read from `import.meta.env`, so
 * each case stubs the environment and re-imports the module rather than mutating it.
 */
async function loadApi(apiUrl: string) {
  vi.resetModules();
  vi.stubEnv("VITE_API_URL", apiUrl);
  return import("@/lib/api");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("configuration", () => {
  it("treats an absent VITE_API_URL as configured fixture mode", async () => {
    const api = await loadApi("");
    expect(api.fixtureMode).toBe(true);
    expect(api.apiBaseUrl).toBe("");
  });

  it("strips a trailing slash so paths do not double up", async () => {
    const api = await loadApi("http://127.0.0.1:4000/");
    expect(api.apiBaseUrl).toBe("http://127.0.0.1:4000");
    expect(api.fixtureMode).toBe(false);
  });
});

describe("fetchJson", () => {
  it("returns the envelope untouched on success", async () => {
    const api = await loadApi("http://127.0.0.1:4000");
    const envelope = {
      data: [{ symbol: "SOLAR01" }],
      meta: { chainId: 31337, indexedBlock: 42, provenance: "onchain", stale: false },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.fetchJson<Array<{ symbol: string }>>("/v1/assets");

    expect(result).toEqual(envelope);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/v1/assets",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("surfaces the backend's own error code", async () => {
    const api = await loadApi("http://127.0.0.1:4000");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "MOCK_DISABLED", message: "synthetic feed off" } }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(api.fetchJson("/v1/assets/x/candles")).rejects.toMatchObject({
      name: "ApiError",
      code: "MOCK_DISABLED",
      status: 503,
    });
  });

  it("fails loudly when the response is not the { data, meta } envelope", async () => {
    const api = await loadApi("http://127.0.0.1:4000");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ assets: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(api.fetchJson("/v1/assets")).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("reports an unreachable backend as NETWORK rather than returning anything", async () => {
    const api = await loadApi("http://127.0.0.1:4000");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    await expect(api.fetchJson("/v1/assets")).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("refuses to reach the network at all in fixture mode", async () => {
    const api = await loadApi("");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.fetchJson("/v1/assets")).rejects.toMatchObject({ code: "NETWORK" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fixtureEnvelope", () => {
  it("labels fixture data as mock and stale, so no panel can claim it is live", async () => {
    const api = await loadApi("");
    const envelope = api.fixtureEnvelope({ symbol: "SOLAR01" });

    expect(envelope.meta.provenance).toBe("mock");
    expect(envelope.meta.stale).toBe(true);
    expect(envelope.data).toEqual({ symbol: "SOLAR01" });
  });
});
