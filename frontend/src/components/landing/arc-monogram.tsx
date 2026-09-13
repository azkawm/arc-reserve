/**
 * The ArcReserve monogram, as a local, self-contained SVG.
 *
 * The Stitch reference sources its header logo from a remote content host
 * (`lh3.googleusercontent.com`); the concept-landing-page spec requires the shipped page to load
 * no third-party image ("The page loads no third-party assets"). This is that logo, ported from
 * `stitch-ui/arcreserve_monogram_wordmark/code.html` with its hardcoded fill colours replaced by
 * the app's own `dusk` and `signal-blue` theme tokens so it stays in step with the palette
 * instead of carrying a second, frozen copy of it.
 */
export function ArcMonogram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 32"
      fill="none"
      className={className}
      role="img"
      aria-label="ArcReserve"
    >
      <path
        d="M6 24C6 14.0589 14.0589 6 24 6C27.5 6 30.7 7.0 33.4 8.7L29.8 12.8C28.1 11.7 26.1 11 24 11C16.8203 11 11 16.8203 11 24H6Z"
        className="fill-dusk"
      />
      <circle cx="24" cy="18" r="3.5" className="fill-signal-blue" />
      <path
        d="M16 24C16 19.5817 19.5817 16 24 16"
        className="stroke-signal-blue"
        strokeWidth="1.5"
        strokeDasharray="2 2"
      />
      <text
        x="42"
        y="21"
        fontFamily="Newsreader, serif"
        fontSize="17"
        fontWeight={500}
        letterSpacing="-0.02em"
        className="fill-ink"
      >
        ArcReserve
      </text>
    </svg>
  );
}
