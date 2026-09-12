import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import App from "@/App";

/**
 * No `VITE_API_URL` is set under test, so the app is in configured fixture mode. That is
 * exactly the state worth asserting: the panel must render, and it must admit that its numbers
 * are fixtures (D-019).
 */
function renderApp(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<App />, { wrapper });
}

describe("App", () => {
  it("renders the product heading", () => {
    renderApp();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Real assets. Programmable liquidity.",
    );
  });

  it("says it is a testnet demo", () => {
    renderApp();
    expect(screen.getByText("Testnet demo")).toBeInTheDocument();
  });

  it("reports fixture mode instead of implying a live backend", () => {
    renderApp();
    expect(screen.getByText(/No VITE_API_URL is configured/i)).toBeInTheDocument();
    expect(screen.getByText("Fixture (configured)")).toBeInTheDocument();
  });

  it("badges the asset panel Mock and lists the fixture series", async () => {
    renderApp();

    expect(await screen.findByText("Solar Indonesia 01")).toBeInTheDocument();
    expect(screen.getByText("Jakarta Invoice Pool")).toBeInTheDocument();

    // The badge is the point: fixture rows must not be presentable as live market data.
    expect(screen.getByTitle(/Demo fixture/i)).toHaveTextContent("Mock");
  });

  it("keeps spot, floor, and backing in separate columns", async () => {
    renderApp();
    const table = await screen.findByRole("table");

    for (const column of ["Spot", "Floor", "Backing"]) {
      expect(within(table).getByRole("columnheader", { name: column })).toBeInTheDocument();
    }

    // Solar is the live fixture row; the verification-stage row has no spot price to show.
    const solarRow = within(table).getByText("Solar Indonesia 01").closest("tr");
    expect(solarRow).not.toBeNull();
    expect(within(solarRow as HTMLElement).getByText("1.018")).toBeInTheDocument();
  });
});
