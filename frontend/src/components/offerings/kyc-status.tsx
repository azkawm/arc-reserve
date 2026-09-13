import { BadgeCheck, ShieldQuestion } from "lucide-react";
import { useEffect } from "react";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { Button } from "@/components/ui/button";
import { useChain } from "@/lib/chain-context";
import { addressesFor, demoRegistrarAbi, identityAbi } from "@/lib/contracts";
import { describeRevert } from "@/lib/revert";

/**
 * KYC state for the connected wallet, and the one path a fresh wallet has to becoming able to
 * hold SOLAR01: `DemoRegistrar.selfRegister()`.
 *
 * The token is permissioned, so this is a gate, not decoration. The "Verify me" control is
 * offered only when `canSelfRegister(wallet) && isActive()` — on a chain whose registrar is not
 * working that pair reads false, so the button hides itself instead of offering a revert
 * (INTEGRATION_GUIDE §2.4). `IdentityRegistry.isVerified` is the source of the badge.
 */
export function KycStatus() {
  const { chainId } = useChain();
  const { address, isConnected } = useAccount();
  const deployment = addressesFor(chainId);

  const verified = useReadContract({
    address: deployment.identityRegistry,
    abi: identityAbi,
    functionName: "isVerified",
    args: address === undefined ? undefined : [address],
    query: { enabled: isConnected && address !== undefined },
  });

  const needsRegistration = verified.data === false;
  const canRegister = useReadContract({
    address: deployment.demoRegistrar,
    abi: demoRegistrarAbi,
    functionName: "canSelfRegister",
    args: address === undefined ? undefined : [address],
    query: { enabled: isConnected && address !== undefined && needsRegistration },
  });
  const registrarActive = useReadContract({
    address: deployment.demoRegistrar,
    abi: demoRegistrarAbi,
    functionName: "isActive",
    query: { enabled: isConnected && needsRegistration },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const refetchVerified = verified.refetch;

  useEffect(() => {
    if (receipt.isSuccess) void refetchVerified();
  }, [receipt.isSuccess, refetchVerified]);

  if (!isConnected) {
    return (
      <span className="border-mist text-ash inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
        <ShieldQuestion size={12} aria-hidden="true" />
        Connect wallet to check verification
      </span>
    );
  }

  if (verified.data === true) {
    return (
      <span className="bg-provenance-live/10 text-provenance-live inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium">
        <BadgeCheck size={13} aria-hidden="true" />
        KYC Verified
      </span>
    );
  }

  const offerRegistration =
    verified.data === false && canRegister.data === true && registrarActive.data === true;

  if (offerRegistration) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={isPending || receipt.isLoading}
          onClick={() =>
            writeContract({
              address: deployment.demoRegistrar,
              abi: demoRegistrarAbi,
              functionName: "selfRegister",
            })
          }
        >
          {isPending || receipt.isLoading ? "Registering…" : "Verify me"}
        </Button>
        <span className="text-ash text-[11px]">Anyone can self-verify on this testnet.</span>
        {error !== null && <span className="text-destructive text-[10px]">{describeRevert(error)}</span>}
      </div>
    );
  }

  return (
    <span className="border-mist text-ash inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
      <ShieldQuestion size={12} aria-hidden="true" />
      Not verified
    </span>
  );
}
