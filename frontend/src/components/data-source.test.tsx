import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataPanel, DataSourceBadge, PanelError } from "@/components/data-source";
import { ApiError, type ResponseMeta } from "@/lib/api";

const meta: ResponseMeta = {
  chainId: 296,
  indexedBlock: 42,
  indexedBlockHash: null,
  asOf: 1_700_000_000,
  provenance: "onchain",
  stale: false,
  lagBlocks: 0,
};

describe("DataSourceBadge", () => {
  it("uses a field's own provenance over the envelope's", () => {
    render(<DataSourceBadge meta={meta} provenance="mock" />);
    expect(screen.getByText("Mock")).toBeInTheDocument();
  });

  it("labels the envelope provenance when the field has none", () => {
    render(<DataSourceBadge meta={meta} />);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });
});

describe("DataPanel not-indexed state", () => {
  it("says not indexed for a live response with asOf null", () => {
    const query = {
      data: { data: {}, meta: { ...meta, asOf: null } },
      error: null,
      isPending: false,
      refetch: () => {},
    };
    render(<DataPanel query={query}>{() => <span>payload</span>}</DataPanel>);
    expect(screen.getByText(/not indexed yet/i)).toBeInTheDocument();
    expect(screen.queryByText("payload")).not.toBeInTheDocument();
  });

  it("still renders a mock fixture that carries asOf null", () => {
    const query = {
      data: { data: {}, meta: { ...meta, asOf: null, provenance: "mock" as const } },
      error: null,
      isPending: false,
      refetch: () => {},
    };
    render(<DataPanel query={query}>{() => <span>payload</span>}</DataPanel>);
    expect(screen.getByText("payload")).toBeInTheDocument();
  });
});

describe("PanelError", () => {
  it("explains chain-unavailable rather than showing a generic failure", () => {
    render(<PanelError error={new ApiError("CHAIN_UNAVAILABLE", "nope", 503)} />);
    expect(screen.getByText(/cannot serve that network/i)).toBeInTheDocument();
  });

  it("explains no-trades separately from an error", () => {
    render(<PanelError error={new ApiError("MOCK_DISABLED", "off", 503)} />);
    expect(screen.getByText(/no canonical market data/i)).toBeInTheDocument();
  });
});
