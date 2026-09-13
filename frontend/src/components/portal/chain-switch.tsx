import { ARC_CHAIN_ID, HEDERA_CHAIN_ID, chainName, chainShortName } from "@/lib/chains";
import { useChain } from "@/lib/chain-context";
import { cn } from "@/lib/utils";

const OPTIONS = [HEDERA_CHAIN_ID, ARC_CHAIN_ID] as const;

/**
 * The chain switch. Defaults to Hedera; switching moves the whole portal, because every read and
 * write takes its chain from the context this control sets.
 *
 * Labels shorten below `sm` so the header does not overflow on a phone; the full name is kept at
 * wider widths and in the button's accessible name.
 */
export function ChainSwitch() {
  const { chainId, setChainId } = useChain();

  return (
    <div
      role="group"
      aria-label="Network"
      className="border-mist bg-linen inline-flex items-center gap-0.5 rounded-full border p-0.5"
    >
      {OPTIONS.map((id) => {
        const active = chainId === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            aria-label={chainName(id)}
            title={chainName(id)}
            onClick={() => setChainId(id)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors sm:px-3",
              active ? "bg-dusk text-paper" : "text-charcoal hover:text-ink",
            )}
          >
            <span className="hidden sm:inline">{chainName(id)}</span>
            <span className="sm:hidden">{chainShortName(id)}</span>
          </button>
        );
      })}
    </div>
  );
}
