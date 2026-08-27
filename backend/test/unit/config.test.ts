import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { StartupError } from '../../src/lib/errors.js';

const BASE = {
  DATABASE_URL: 'postgresql://arcreserve:arcreserve@127.0.0.1:5450/arcreserve',
  CHAIN_ID: '31337',
  RPC_HTTP_URL: 'http://127.0.0.1:8545',
  REGISTRY_ADDRESS: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  FACTORY_ADDRESS: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
  MUSD_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
} satisfies NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('accepts the local Anvil configuration and applies documented defaults', () => {
    const config = loadConfig({ ...BASE });
    expect(config.CHAIN_ID).toBe(31337);
    expect(config.chainName).toBe('Anvil');
    expect(config.PORT).toBe(4000);
    expect(config.CONFIRMATIONS).toBe(0);
    expect(config.MAX_BLOCK_RANGE).toBe(2000);
    expect(config.STALE_AFTER_SECONDS).toBe(60);
    expect(config.START_BLOCK).toBe(0n);
    expect(config.ALLOW_MOCK_MARKET_DATA).toBe(false);
  });

  it('keeps checksummed addresses for display and lowercase for lookups', () => {
    const config = loadConfig({ ...BASE });
    expect(config.REGISTRY_ADDRESS).toBe('0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512');
    expect(config.addresses.registry).toBe('0xe7f1725e7734ce288f8367e1bb143e90bb3f0512');
  });

  it('normalises an all-lowercase address to its checksummed form', () => {
    const config = loadConfig({ ...BASE, REGISTRY_ADDRESS: BASE.REGISTRY_ADDRESS.toLowerCase() });
    expect(config.REGISTRY_ADDRESS).toBe('0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512');
  });

  it('serves the three supported testnets', () => {
    for (const [chainId, name] of [
      ['31337', 'Anvil'],
      ['84532', 'Base Sepolia'],
      ['296', 'Hedera Testnet'],
    ] as const) {
      expect(loadConfig({ ...BASE, CHAIN_ID: chainId }).chainName).toBe(name);
    }
  });

  it('refuses mainnet and any other chain (D-027)', () => {
    for (const chainId of ['1', '8453', '137', '295']) {
      expect(() => loadConfig({ ...BASE, CHAIN_ID: chainId })).toThrow(/testnet only/);
    }
  });

  it('refuses a zero root address rather than indexing an empty deployment', () => {
    expect(() =>
      loadConfig({ ...BASE, REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000000' }),
    ).toThrow(/zero address/);
  });

  it('refuses a malformed address', () => {
    expect(() => loadConfig({ ...BASE, FACTORY_ADDRESS: '0x1234' })).toThrow(StartupError);
  });

  it('refuses zero confirmations when NODE_ENV=production', () => {
    expect(() =>
      loadConfig({ ...BASE, NODE_ENV: 'production', CONFIRMATIONS: '0' }),
    ).toThrow(/CONFIRMATIONS=0 is refused/);
    expect(loadConfig({ ...BASE, NODE_ENV: 'production', CONFIRMATIONS: '5' }).CONFIRMATIONS).toBe(5);
  });

  it('requires a postgres connection string', () => {
    expect(() => loadConfig({ ...BASE, DATABASE_URL: 'mysql://localhost/x' })).toThrow(
      /postgres URL/,
    );
  });

  it('gates synthetic market data explicitly', () => {
    expect(loadConfig({ ...BASE, ALLOW_MOCK_MARKET_DATA: 'true' }).ALLOW_MOCK_MARKET_DATA).toBe(true);
    expect(loadConfig({ ...BASE, ALLOW_MOCK_MARKET_DATA: 'false' }).ALLOW_MOCK_MARKET_DATA).toBe(
      false,
    );
    expect(() => loadConfig({ ...BASE, ALLOW_MOCK_MARKET_DATA: 'yes' })).toThrow(StartupError);
  });

  it('parses the CORS allowlist and treats * as open', () => {
    expect(loadConfig({ ...BASE, CORS_ORIGIN: 'http://a.test, http://b.test' }).corsOrigins).toEqual(
      ['http://a.test', 'http://b.test'],
    );
    expect(loadConfig({ ...BASE, CORS_ORIGIN: '*' }).corsOrigins).toBe(true);
  });

  it('treats an empty optional address as absent', () => {
    expect(loadConfig({ ...BASE, COMPANY_VESTING_ADDRESS: '' }).addresses.companyVesting).toBeUndefined();
    expect(
      loadConfig({ ...BASE, COMPANY_VESTING_ADDRESS: '0x09635F643e140090A9A8Dcd712eD6285858ceBef' })
        .addresses.companyVesting,
    ).toBe('0x09635f643e140090a9a8dcd712ed6285858cebef');
  });

  it('reports every invalid field at once, with the variable name', () => {
    try {
      loadConfig({ ...BASE, CHAIN_ID: '1', PORT: '0' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(StartupError);
      expect((error as StartupError).message).toContain('CHAIN_ID');
      expect((error as StartupError).message).toContain('PORT');
      expect((error as StartupError).hint).toContain('.env');
    }
  });
});
