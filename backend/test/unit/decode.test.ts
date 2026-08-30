import { describe, expect, it } from 'vitest';
import { encodeEventTopics, toEventSelector, zeroAddress, type Hex } from 'viem';
import { decodeLog, knownTopics, serialiseArgs } from '../../src/indexer/decode.js';
import { bytes32ToString } from '../../src/indexer/projections/types.js';
import { loadAbi } from '../../src/chain/abis.js';

const HOLDER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

/** encodeEventTopics types unindexed positions as null; a real log never carries them. */
const ZERO_WORD: Hex = `0x${'0'.repeat(64)}`;

const topicsOf = (topics: readonly (Hex | Hex[] | null)[]): Hex[] =>
  topics.filter((topic): topic is Hex => typeof topic === 'string');

describe('decodeLog', () => {
  it('decodes an asset-token Transfer into named arguments', () => {
    const topics = encodeEventTopics({
      abi: loadAbi('AssetToken'),
      eventName: 'Transfer',
      args: { from: zeroAddress, to: HOLDER },
    });

    const decoded = decodeLog('token', {
      topics: topicsOf(topics),
      data: `0x${(1_000n * 10n ** 18n).toString(16).padStart(64, '0')}`,
    });

    expect(decoded.eventName).toBe('Transfer');
    expect(decoded.contractName).toBe('AssetToken');
    expect(decoded.args?.from).toBe(zeroAddress);
    expect(decoded.args?.value).toBe(1_000n * 10n ** 18n);
  });

  it('resolves the shared Transfer selector by address kind, not by topic0', () => {
    // AssetToken and MockUSD emit byte-identical Transfer selectors. Decoding on topic0
    // alone would make an 18-decimal asset movement indistinguishable from a 6-decimal mUSD
    // one — the exact confusion the kind-keyed lookup exists to prevent.
    const assetSelector = toEventSelector(
      loadAbi('AssetToken').find(
        (item) => item.type === 'event' && item.name === 'Transfer',
      ) as never,
    );
    const stableSelector = toEventSelector(
      loadAbi('MockUSD').find((item) => item.type === 'event' && item.name === 'Transfer') as never,
    );

    expect(assetSelector).toBe(stableSelector);
    expect(knownTopics('token')).toContain(assetSelector);
    expect(knownTopics('stablecoin')).toContain(stableSelector);

    const topics = encodeEventTopics({
      abi: loadAbi('MockUSD'),
      eventName: 'Transfer',
      args: { from: zeroAddress, to: HOLDER },
    });

    expect(decodeLog('token', { topics: topicsOf(topics), data: ZERO_WORD }).contractName).toBe(
      'AssetToken',
    );
    expect(decodeLog('stablecoin', { topics: topicsOf(topics), data: ZERO_WORD }).contractName).toBe(
      'MockUSD',
    );
  });

  it('returns a null event rather than guessing at an unknown selector', () => {
    const decoded = decodeLog('vault', {
      topics: [`0x${'11'.repeat(32)}`],
      data: '0x',
    });
    expect(decoded).toEqual({ contractName: null, eventName: null, args: null });
  });

  it('merges the transfer-lock module ABI into the compliance-module surface', () => {
    // Both modules are discovered as `complianceModule`; HolderLocked lives only on the
    // transfer-lock one and must still decode.
    const topics = encodeEventTopics({
      abi: loadAbi('TransferLockModule'),
      eventName: 'HolderLocked',
      args: { compliance: zeroAddress, holder: HOLDER },
    });
    const decoded = decodeLog('complianceModule', {
      topics: topicsOf(topics),
      data: `0x${(1_800n).toString(16).padStart(64, '0')}`,
    });
    expect(decoded.eventName).toBe('HolderLocked');
    expect(decoded.args?.lockedUntil).toBe(1_800n);
  });
});

describe('serialiseArgs', () => {
  it('writes bigints as decimal strings so a uint256 survives JSON', () => {
    const json = serialiseArgs({ value: 2n ** 200n, who: HOLDER });
    expect(json).toContain((2n ** 200n).toString());
    expect(JSON.parse(json ?? '{}').value).toBe((2n ** 200n).toString());
  });
});

describe('bytes32ToString', () => {
  it('reads the left-aligned category literals the vault emits', () => {
    const encode = (text: string): string =>
      `0x${Buffer.from(text, 'ascii').toString('hex').padEnd(64, '0')}`;

    for (const category of [
      'REDEMPTION_RESERVE',
      'MARKET_ALLOCATION',
      'ASSET_REVENUE',
      'ISSUER_PROCEEDS',
      'PROTOCOL_FEES',
    ]) {
      expect(bytes32ToString(encode(category))).toBe(category);
    }
  });

  it('stops at the first zero byte rather than trailing padding', () => {
    expect(bytes32ToString(`0x${'53'}${'00'.repeat(31)}`)).toBe('S');
  });
});

describe('canonical pool events', () => {
  it('decodes a Swap whose selector matches the published Uniswap V3 topic0', () => {
    // The guard that matters: the ABI is synced from contracts/out, so a wrong argument order
    // on the contracts side would change this selector and fail here rather than quietly
    // producing candles from misread amounts.
    const swap = loadAbi('IUniswapV3Pool').find(
      (item) => item.type === 'event' && item.name === 'Swap',
    );
    expect(swap).toBeDefined();
    expect(toEventSelector(swap as never)).toBe(
      '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
    );
    expect(knownTopics('pool')).toContain(
      '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
    );
  });

  it('decodes Initialize, which seeds the first price but is never a candle', () => {
    const initialize = loadAbi('IUniswapV3Pool').find(
      (item) => item.type === 'event' && item.name === 'Initialize',
    );
    expect(initialize).toBeDefined();
    expect(knownTopics('pool')).toContain(toEventSelector(initialize as never));
  });
});
