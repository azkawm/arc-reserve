/**
 * The ArcReserve logo mark plus wordmark, used in the header and footer.
 *
 * The mark is `/logo.png`, a static asset served from this app's own origin (`frontend/public/`).
 * It ships inside the build like every other local asset, so it still satisfies the
 * concept-landing-page spec's "the page loads no third-party assets" requirement — nothing is
 * fetched from a remote host such as `lh3.googleusercontent.com`, which is what that requirement
 * guards against.
 */
export function ArcMonogram({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <img src="/logo.png" alt="ArcReserve" className="h-full w-auto" />
      <span className="font-display text-ink text-lg font-medium tracking-tight">ArcReserve</span>
    </span>
  );
}
