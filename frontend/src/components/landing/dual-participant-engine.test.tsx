import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DualParticipantEngine } from "@/components/landing/dual-participant-engine";

describe("DualParticipantEngine", () => {
  it("renders both participant pathways", () => {
    render(<DualParticipantEngine />);
    expect(screen.getByText("For Qualified Investors")).toBeInTheDocument();
    expect(screen.getByText(/For Utility/)).toBeInTheDocument();
  });

  it("does not promise an unconditional or instant exit", () => {
    render(<DualParticipantEngine />);
    expect(screen.queryByText(/exit immediately/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/exit guarantees/i)).not.toBeInTheDocument();
  });

  it("carries no audit claim or invented regulatory framework", () => {
    render(<DualParticipantEngine />);
    expect(screen.queryByText(/audit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/basel/i)).not.toBeInTheDocument();
  });

  it("renders no link — the reference's two links each pointed at a page that does not exist", () => {
    render(<DualParticipantEngine />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
