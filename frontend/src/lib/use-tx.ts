import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";

/**
 * Shared write plumbing: submit, wait for the receipt, and refresh the read family on success.
 *
 * Receipt-first is the rule (plan §W): a broadcast hash is not success. The indexer becomes the
 * source only after `/v1/health` catches up, which the caller can check separately; refreshing
 * here is what makes the panels catch up once it has.
 */
export function useTx() {
  const queryClient = useQueryClient();
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });

  useEffect(() => {
    if (receipt.isSuccess) void queryClient.invalidateQueries({ queryKey: ["api"] });
  }, [receipt.isSuccess, queryClient]);

  return { ...write, receipt };
}
