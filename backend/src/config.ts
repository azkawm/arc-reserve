import { z } from 'zod';
import { getAddress, isAddress } from 'viem';
import { StartupError } from './lib/errors.js';

/**
 * Configuration is validated once, at startup, and the process refuses to run if anything
 * is wrong. An indexer that starts with a plausible-but-wrong address silently produces a
 * believable-but-wrong read model, which is the failure mode D-019 exists to prevent.
 */

/** D-027: testnets only. A mainnet chain id is a product decision, not a config value. */
export const SUPPORTED_CHAINS = {
  31337: { name: 'Anvil', shortName: 'anvil' },
  84532: { name: 'Base Sepolia', shortName: 'base-sepolia' },
  296: { name: 'Hedera Testnet', shortName: 'hedera-testnet' },
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

export const SUPPORTED_CHAIN_IDS = Object.keys(SUPPORTED_CHAINS).map(Number) as SupportedChainId[];

const addressSchema = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), 'must be a 20-byte hex address')
  .transform((value) => getAddress(value));

const nonZeroAddressSchema = addressSchema.refine(
  (value) => value !== '0x0000000000000000000000000000000000000000',
  'must not be the zero address — fill it from contracts/deployments/<chainId>.json',
);

const booleanSchema = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:/.test(value), 'must be an http(s) URL');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().min(1).default('127.0.0.1'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().min(1).refine((v) => v.startsWith('postgres'), 'must be a postgres URL'),

    CHAIN_ID: z.coerce.number().int(),
    RPC_HTTP_URL: httpUrlSchema,
    RPC_WS_URL: z
      .string()
      .refine((value) => value === '' || /^wss?:/.test(value), 'must be a ws(s) URL')
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    START_BLOCK: z.coerce.bigint().nonnegative().default(0n),
    CONFIRMATIONS: z.coerce.number().int().nonnegative().default(0),
    POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
    MAX_BLOCK_RANGE: z.coerce.number().int().min(1).max(10_000).default(2000),

    REGISTRY_ADDRESS: nonZeroAddressSchema,
    FACTORY_ADDRESS: nonZeroAddressSchema,
    MUSD_ADDRESS: nonZeroAddressSchema,
    COMPANY_VESTING_ADDRESS: z
      .string()
      .optional()
      .transform((value) => (value === undefined || value === '' ? undefined : value))
      .pipe(addressSchema.optional()),

    STALE_AFTER_SECONDS: z.coerce.number().int().min(1).max(86_400).default(60),
    ALLOW_MOCK_MARKET_DATA: booleanSchema.default('false'),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
  })
  .superRefine((env, ctx) => {
    if (!SUPPORTED_CHAIN_IDS.includes(env.CHAIN_ID as SupportedChainId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CHAIN_ID'],
        message:
          `unsupported chain ${env.CHAIN_ID}. ArcReserve is testnet only (D-027): ` +
          `${SUPPORTED_CHAIN_IDS.join(', ')}`,
      });
    }
    // A zero-confirmation indexer serves the unfinalised tip as if it were settled.
    // Acceptable on Anvil, never in a deployment that calls itself production.
    if (env.NODE_ENV === 'production' && env.CONFIRMATIONS === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CONFIRMATIONS'],
        message: 'CONFIRMATIONS=0 is refused when NODE_ENV=production',
      });
    }
  });

export type RawEnv = z.infer<typeof envSchema>;

export interface Config extends Omit<RawEnv, 'CHAIN_ID'> {
  CHAIN_ID: SupportedChainId;
  chainName: string;
  /** Lowercase forms, for database keys and log-address comparison. */
  addresses: {
    registry: `0x${string}`;
    factory: `0x${string}`;
    stablecoin: `0x${string}`;
    companyVesting?: `0x${string}`;
  };
  /**
   * RPC per chain. The process indexes `CHAIN_ID` with `RPC_HTTP_URL`; the API can also serve
   * other chains already in the database (`?chainId=`), and reading their live contract state
   * needs their own endpoint, given as `RPC_HTTP_URL_<chainId>`. A chain with rows but no URL
   * is reported as unavailable, never served from the configured chain's RPC.
   */
  rpcUrls: Partial<Record<SupportedChainId, string>>;
  corsOrigins: string[] | true;
  isProduction: boolean;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new StartupError(
      `invalid configuration:\n${detail}`,
      'copy backend/.env.example to backend/.env and fill it in',
    );
  }

  const env = parsed.data;
  const chainId = env.CHAIN_ID as SupportedChainId;

  const rpcUrls: Partial<Record<SupportedChainId, string>> = {};
  for (const id of SUPPORTED_CHAIN_IDS) {
    const raw = source[`RPC_HTTP_URL_${id}`];
    if (raw === undefined || raw.trim() === '') continue;
    const url = httpUrlSchema.safeParse(raw);
    if (!url.success) {
      throw new StartupError(
        `invalid RPC_HTTP_URL_${id}: ${url.error.issues.map((issue) => issue.message).join(', ')}`,
        'it must be an http(s) URL for that chain, or unset',
      );
    }
    rpcUrls[id] = url.data;
  }
  // The indexed chain's own endpoint wins: it is the one this process is verified against.
  rpcUrls[chainId] = env.RPC_HTTP_URL;
  const corsOrigins =
    env.CORS_ORIGIN.trim() === '*'
      ? true
      : env.CORS_ORIGIN.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean);

  return {
    ...env,
    CHAIN_ID: chainId,
    chainName: SUPPORTED_CHAINS[chainId].name,
    addresses: {
      registry: env.REGISTRY_ADDRESS.toLowerCase() as `0x${string}`,
      factory: env.FACTORY_ADDRESS.toLowerCase() as `0x${string}`,
      stablecoin: env.MUSD_ADDRESS.toLowerCase() as `0x${string}`,
      ...(env.COMPANY_VESTING_ADDRESS
        ? { companyVesting: env.COMPANY_VESTING_ADDRESS.toLowerCase() as `0x${string}` }
        : {}),
    },
    rpcUrls,
    corsOrigins,
    isProduction: env.NODE_ENV === 'production',
  };
}
