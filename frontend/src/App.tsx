import { Activity, ExternalLink } from "lucide-react";
import { DataPanel, DataSourceBadge } from "@/components/data-source";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiBaseUrl, fixtureMode } from "@/lib/api";
import { contractsConfigured } from "@/lib/contracts";
import { formatPrice } from "@/lib/format";
import { useAssets } from "@/lib/queries";

/**
 * The scaffold's landing page.
 *
 * It exists to prove the ported stack end to end — react-query and wagmi providers, the `/v1`
 * client, the fixture adapter, the provenance badge, and the shadcn primitives — on real data
 * rather than on placeholder markup. The issuer, verifier, engine, and asset routes from the
 * previous Next.js app are *not* ported yet; see `docs/FRONTEND.md`.
 */
export default function App() {
  const assets = useAssets();

  return (
    <div className="min-h-dvh">
      <header className="border-border/60 bg-background/80 sticky top-0 z-10 border-b backdrop-blur-lg">
        <div className="mx-auto flex h-18 max-w-6xl items-center justify-between gap-6 px-6">
          <div className="flex items-center gap-2.5">
            <span className="border-ring/70 bg-secondary text-primary grid size-8 place-items-center rounded-full border">
              <Activity size={15} aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold tracking-wide">
              Arc<span className="text-primary">Reserve</span>
            </span>
          </div>
          <Badge variant="outline" className="text-muted-foreground">
            Testnet demo
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-14 pb-24">
        <p className="text-primary text-[10px] font-bold tracking-[0.17em] uppercase">
          Asset participation markets
        </p>
        <h1 className="mt-3 max-w-3xl text-5xl leading-none sm:text-6xl">
          Real assets. <span className="text-primary">Programmable liquidity.</span>
        </h1>
        <p className="text-muted-foreground mt-5 max-w-2xl text-sm leading-relaxed">
          A capped asset token, a category-accounted stablecoin vault, reserve-limited
          redemption, and a guarded liquidity engine. This is the React + Vite frontend
          scaffold: the backend client is wired, the product routes are not yet ported.
        </p>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Data source</CardTitle>
              <CardDescription>
                {fixtureMode
                  ? "No VITE_API_URL is configured, so every panel reads local fixtures and says so."
                  : `Reading /v1 from ${apiBaseUrl}. A failed request renders an error, never a fixture.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground grid gap-2 text-xs">
              <Row label="Mode" value={fixtureMode ? "Fixture (configured)" : "Live API"} />
              <Separator />
              <Row label="Backend" value={fixtureMode ? "—" : apiBaseUrl} />
              <Separator />
              <Row
                label="Contract addresses"
                value={contractsConfigured ? "Configured" : "Not configured"}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Scope</CardTitle>
              <CardDescription>
                Hackathon MVP. Anvil, Base Sepolia, and Hedera testnet only, with a mock
                stablecoin.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground space-y-2 text-xs leading-relaxed">
              <p>
                A SOLAR01 token is a capped participation claim. It is not equity, not legal
                title, not a guaranteed return, and not a price peg.
              </p>
              <p className="text-dim">
                No audit has been performed. No real funds move on any target chain.
              </p>
            </CardContent>
          </Card>
        </div>

        <section className="mt-14">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-primary text-[10px] font-bold tracking-[0.17em] uppercase">
                Indexed
              </p>
              <h2 className="mt-1.5 text-2xl">Asset series</h2>
            </div>
            <DataSourceBadge {...(assets.data ? { meta: assets.data.meta } : {})} />
          </div>

          <Card>
            <CardContent>
              <DataPanel query={assets} loadingLabel="Loading asset series">
                {(rows) =>
                  rows.length === 0 ? (
                    <p className="text-muted-foreground py-6 text-xs">
                      The index holds no asset series yet.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Series</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Spot</TableHead>
                          <TableHead className="text-right">Floor</TableHead>
                          <TableHead className="text-right">Backing</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((asset) => (
                          <TableRow key={asset.assetId}>
                            <TableCell>
                              <span className="text-foreground font-medium">{asset.name}</span>
                              <span className="text-dim ml-2 text-[10px] tracking-wide uppercase">
                                {asset.symbol}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-muted-foreground">
                                {asset.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatPrice(asset.spot?.value)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatPrice(asset.floor)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatPrice(asset.reserve)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )
                }
              </DataPanel>
            </CardContent>
          </Card>
          <p className="text-dim mt-3 text-[10px] leading-relaxed">
            Spot, floor, and backing are four distinct references in this system and are never
            collapsed into one number. Redemption pays{" "}
            <code className="text-muted-foreground">min(NAV, reserve ÷ investor supply)</code>,
            subject to the period limit.
          </p>
        </section>
      </main>

      <footer className="border-border/60 border-t">
        <div className="text-dim mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-8 text-[10px]">
          <span>ArcReserve — hackathon submission, testnet only.</span>
          <a
            className="hover:text-primary inline-flex items-center gap-1.5 transition-colors"
            href="https://github.com"
            rel="noreferrer noopener"
            target="_blank"
          >
            Source <ExternalLink size={10} aria-hidden="true" />
          </a>
        </div>
      </footer>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <span className="text-foreground overflow-wrap-anywhere font-medium">{value}</span>
    </div>
  );
}
