import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SafetyLadder } from "@/components/landing/safety-ladder";

describe("SafetyLadder", () => {
  it("renders all four stages in their real order", () => {
    render(<SafetyLadder />);
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Behind Schedule",
      "Automatic Shortfall",
      "Verifier Default",
      "Lien Enforcement",
    ]);
  });

  it("does not call the escalation trigger a guarantee, at any stage", async () => {
    const user = userEvent.setup();
    render(<SafetyLadder />);

    // Only the selected stage's detail panel is in the DOM at a time, so the absence check has
    // to visit all four — checking only the default (stage 1) would miss a forbidden word
    // planted in stage 2, 3, or 4's description alone.
    for (const name of [
      "Behind Schedule",
      "Automatic Shortfall",
      "Verifier Default",
      "Lien Enforcement",
    ]) {
      await user.click(screen.getByRole("button", { name: new RegExp(name) }));
      expect(screen.queryByText(/guarantee/i)).not.toBeInTheDocument();
    }
  });

  it("shifts the split to the real 40/45/10/5 figures, not the reference's invented 85/15", async () => {
    const user = userEvent.setup();
    render(<SafetyLadder />);

    // The split figures live in stage 2's detail panel, only shown once selected.
    await user.click(screen.getByRole("button", { name: /Automatic Shortfall/ }));

    expect(screen.getByText(/40\/45\/10\/5/)).toBeInTheDocument();
    expect(screen.queryByText(/85\/15/)).not.toBeInTheDocument();
  });

  it("does not invent a specific enforcement jurisdiction, at any stage", async () => {
    const user = userEvent.setup();
    render(<SafetyLadder />);

    for (const name of [
      "Behind Schedule",
      "Automatic Shortfall",
      "Verifier Default",
      "Lien Enforcement",
    ]) {
      await user.click(screen.getByRole("button", { name: new RegExp(name) }));
      expect(screen.queryByText(/singapore/i)).not.toBeInTheDocument();
    }
  });

  it("switches the detail panel when a different stage is selected", async () => {
    const user = userEvent.setup();
    render(<SafetyLadder />);

    expect(screen.getByText(/Stage 01 — Behind Schedule/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Automatic Shortfall/ }));

    expect(screen.getByText(/Stage 02 — Automatic Shortfall/)).toBeInTheDocument();
    expect(screen.queryByText(/Stage 01 — Behind Schedule/)).not.toBeInTheDocument();
  });

  it("marks the selected stage for assistive technology", async () => {
    const user = userEvent.setup();
    render(<SafetyLadder />);

    const firstStage = screen.getByRole("button", { name: /Behind Schedule/ });
    expect(firstStage).toHaveAttribute("aria-pressed", "true");

    const secondStage = screen.getByRole("button", { name: /Automatic Shortfall/ });
    expect(secondStage).toHaveAttribute("aria-pressed", "false");

    await user.click(secondStage);
    expect(secondStage).toHaveAttribute("aria-pressed", "true");
    expect(firstStage).toHaveAttribute("aria-pressed", "false");
  });
});
