# Uniswap Developer Feedback



## What we built with Uniswap

`AssetMarketManager.sol` is a guarded wrapper around real Uniswap V3 concentrated liquidity. It
holds up to four Uniswap V3 positions (a market-floor range, an anchor around fair value, a
discovery range, and an optional intermediary range) and uses them to create and grow a locked
price floor for a tokenized real-world asset. It talks to the pool directly through
`mint`/`burn`/`collect`/`swap` and implements `uniswapV3MintCallback` and `uniswapV3SwapCallback`
itself — there is no router and no position-manager NFT in our path.

We run this on three chains. Base Sepolia already has the canonical Uniswap V3 factory, so we use
it as-is. Hedera Testnet and Circle's Arc Testnet don't have an official Uniswap V3 deployment, so
we deployed the real `UniswapV3Factory` ourselves on both, using the canonical v3-core 1.0.1
bytecode (not a rewrite or a mock).

## What worked well

- **Deploying just the factory, and nothing else, was the right call.** Because our
  `AssetMarketManager` calls the pool directly, we never needed `SwapRouter`,
  `NonfungiblePositionManager`, `NFTDescriptor`, `Quoter`, or WETH9 — the full periphery kit most
  guides assume you need. Skipping them saved roughly 15–20M gas of contracts we'd never call, and
  sidestepped `NonfungiblePositionManager` being close to the 24KB contract-size limit, which we'd
  read is the most common thing to break a fresh V3 deployment on a new chain.
- **No `PoolAddress.POOL_INIT_CODE_HASH` anywhere in our code.** Since we don't use periphery, we
  never had to compute or match a pool-address init-code hash — the classic trap that breaks most
  non-canonical V3 deployments (the periphery's hardcoded hash silently stops matching your actual
  deployed bytecode). Worth knowing this trap only exists if you *use* periphery; going core-only
  makes it a non-issue.
- **The three default fee tiers came for free.** `UniswapV3Factory`'s constructor already enables
  0.05% / 0.30% / 1% tiers, so `createPool` just worked once the factory was live — no separate
  setup step.
- **Concentrated liquidity is genuinely the right primitive for a price floor.** Being able to park
  capital in a narrow, specific range (rather than spreading it across every price the way a
  constant-product pool does) is what makes a capital-efficient floor possible at all. This was the
  main reason we picked V3 over an older AMM design.

## What was confusing or hard

- **Deploying a full asset system that also creates its Uniswap V3 pool did not fit in one
  transaction, on either testnet.** On a Base Sepolia fork against the canonical factory it measured
  18,424,318 gas — about 9.8% over EIP-7825's 16,777,216 per-transaction cap that Base Sepolia
  enforces at precheck. Against our own factory the mock path measured 15,294,153 gas — about 2%
  over Hedera's separate, harder 15,000,000 cap. Local Anvil forks don't enforce either cap, so every
  rehearsal on Anvil passed and the problem only showed up against the real chains. We ended up
  splitting the deployment in two at the pool-creation boundary. This felt like something worth
  surfacing more clearly for anyone deploying a full system (factory + pool + app contracts) rather
  than just the core Uniswap contracts alone.
- **Deploying our own factory just to reach Hedera's 15,000,000 gas cap took some tuning too** — the
  factory alone measured 5,440,656 gas, which is fine on its own, but it still meant treating
  Hedera's cap as a hard constraint from the start rather than an edge case.
- No Clear support on self deploy on new chain, so we use ai instead to help us.


## What we'd want Uniswap to improve or document better

- A short, explicit "deploying V3 core (no periphery) to a brand-new chain" guide — covering the
  fee-tier constructor behavior, the periphery-vs-core init-code-hash trap (and that it disappears
  if you skip periphery), and realistic gas figures for the factory alone, would have saved us some
  guessing.
- More visibility into per-transaction gas caps on popular L2/alt-L1 testnets (Base Sepolia's
  EIP-7825 cap, Hedera's 15M cap) in the context of "deploying a Uniswap V3 pool as part of a larger
  transaction" — this is a chain-level constraint, not a Uniswap one, but it directly affects anyone
  bootstrapping V3 alongside their own contracts in one deploy step.
- More chain suppport natively like hedera and arc

