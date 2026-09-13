import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ValueReferences } from "@/components/landing/value-references";

describe("ValueReferences", () => {
  it("keeps the five references as five distinct, separately labelled entries", () => {
    render(<ValueReferences />);
    const table = screen.getByRole("table");
    for (const label of [
      "Market Spot",
      "30-Minute TWAP",
      "Verified NAV",
      "Published Floor",
      "Redemption Price",
    ]) {
      // getByText would throw on a duplicate; each label appearing exactly once in the table is
      // the concrete form of "never collapsed into one number".
      expect(within(table).getByText(new RegExp(label))).toBeInTheDocument();
    }
  });

  it("never calls redemption instant or continuous", () => {
    render(<ValueReferences />);
    expect(screen.queryByText(/instant redemption/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/real-time continuous/i)).not.toBeInTheDocument();
  });

  it("carries no audit or named third-party attestation claim", () => {
    render(<ValueReferences />);
    for (const term of [/bureau veritas/i, /audit/i, /attested/i, /certified/i]) {
      expect(screen.queryByText(term)).not.toBeInTheDocument();
    }
  });

  it("does not call the structural relationship a guarantee", () => {
    render(<ValueReferences />);
    expect(screen.queryByText(/guarantee/i)).not.toBeInTheDocument();
    expect(screen.getByText(/structural invariant/i)).toBeInTheDocument();
  });

  it("is marked as a concept panel", () => {
    render(<ValueReferences />);
    expect(screen.getByText("Concept")).toBeInTheDocument();
  });
});
