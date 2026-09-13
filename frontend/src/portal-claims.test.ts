import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The portal may not carry the Stitch reference's false claims (CLAUDE.md; guide §9). This scans
 * the portal's own source with comments stripped, so a claim is caught where it would actually
 * render — a comment explaining the removal must not fail the test.
 */
const DIRS = ["src/pages", "src/components/offerings", "src/components/asset", "src/components/portal"];

const FORBIDDEN: Array<[string, RegExp]> = [
  ["a named audit firm", /CertiK|Zellic|Halborn|VeriSol/i],
  ["a named verification firm", /\bJLL\b/],
  ["the parked network", /Base Sepolia/i],
  ["a regulatory regime", /Basel III|Reg S|144A/i],
  ["a forward APR", /\bAPR\b/],
  ["a yield figure from the reference", /14\.8%/],
  ["a protocol fee that does not exist", /0\.05%/],
  ["an impossible price impact", /0 price impact/i],
  ["a staking claim", /auto-staking/i],
  ["an instant-settlement claim", /instant settlement/i],
  ["a contractual guarantee", /contractually guaranteed/i],
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function readPortalSource(): string {
  const chunks: string[] = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(join(process.cwd(), dir))) {
      if (name.endsWith(".tsx") || name.endsWith(".ts")) {
        chunks.push(readFileSync(join(process.cwd(), dir, name), "utf8"));
      }
    }
  }
  return stripComments(chunks.join("\n"));
}

describe("portal copy", () => {
  const source = readPortalSource();

  it.each(FORBIDDEN)("contains no %s", (_label, pattern) => {
    expect(source).not.toMatch(pattern);
  });

  it("still states the honest disclaimer it should", () => {
    expect(source).toMatch(/not a guarantee/i);
    expect(source).toMatch(/min\(NAV, backing\)/);
  });
});
