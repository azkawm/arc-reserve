import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TelemetryBand } from "@/components/landing/telemetry-band";

describe("TelemetryBand", () => {
  it("does not describe its own figures as live", () => {
    render(<TelemetryBand />);
    expect(screen.queryByText(/^live /i)).not.toBeInTheDocument();
    expect(screen.queryByText(/live institutional telemetry/i)).not.toBeInTheDocument();
  });

  it("carries no audit or attestation claim", () => {
    render(<TelemetryBand />);
    for (const term of [/halborn/i, /verisol/i, /audited/i, /attested/i, /sovereign attestation/i]) {
      expect(screen.queryByText(term)).not.toBeInTheDocument();
    }
  });

  it("does not describe the revenue split as fixed", () => {
    render(<TelemetryBand />);
    expect(screen.queryByText(/fixed contractual split/i)).not.toBeInTheDocument();
  });

  it("renders four metric cards, each carrying a concept marker", () => {
    render(<TelemetryBand />);
    expect(screen.getAllByText("Concept")).toHaveLength(4);
  });
});
