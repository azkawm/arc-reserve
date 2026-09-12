import { describe, expect, it } from 'vitest';
import { BaseError, ContractFunctionRevertedError } from 'viem';
import { isColdOracle } from '../../src/chain/snapshot.js';

/**
 * For the first `twapWindow` seconds after a pool is initialised, its observation history does
 * not cover the window and `observe` reverts with the string `OLD` — so every price view that
 * consults the TWAP reverts with it. That is a deployment warming up on a timer, and it clears
 * itself; a UI that renders it as an error sends someone debugging a healthy chain. Every other
 * revert has to stay "unavailable", because those do not clear on their own.
 */
describe('isColdOracle', () => {
  it('recognises the pool oracle revert in a wrapped viem error', () => {
    const reverted = new ContractFunctionRevertedError({
      abi: [],
      functionName: 'marketPrices',
      message: 'execution reverted: OLD',
    });
    const wrapped = new BaseError('call failed', { cause: reverted });

    expect(isColdOracle(wrapped)).toBe(true);
  });

  it('recognises it from the message alone, whatever wrapper it arrived in', () => {
    expect(isColdOracle(new Error('execution reverted: OLD'))).toBe(true);
    expect(isColdOracle(new Error('The contract function reverted.\n\nReason: OLD'))).toBe(true);
  });

  it('does not claim a warm-up for any other failure', () => {
    expect(isColdOracle(new Error('execution reverted: NOT_INITIALIZED'))).toBe(false);
    expect(isColdOracle(new Error('HTTP request failed: over rate limit'))).toBe(false);
    expect(isColdOracle(new Error('execution reverted'))).toBe(false);
    expect(isColdOracle(null)).toBe(false);
    expect(isColdOracle('OLD')).toBe(false);
  });

  it('does not match a longer word that merely contains OLD', () => {
    expect(isColdOracle(new Error('execution reverted: THRESHOLD'))).toBe(false);
    expect(isColdOracle(new Error('execution reverted: OLDEST_OBSERVATION'))).toBe(false);
  });
});
