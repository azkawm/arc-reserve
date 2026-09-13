// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";

interface IV3FactoryCheck {
    function feeAmountTickSpacing(uint24 fee) external view returns (int24);
    function owner() external view returns (address);
    function setOwner(address owner_) external;
}

/// @title DeployUniswapFactory
/// @notice Deploys ONLY the canonical `UniswapV3Factory`, for a chain that has no Uniswap V3.
///
/// @dev    Hedera testnet (296) is the reason this exists. `DeployTestnet` gives Hedera the MOCK
///         factory, which is a callback harness with no curve — the engine runs, but the D-035
///         flywheel can never turn because nothing converts a position's inventory. Deploying a
///         real factory there and passing it as `UNISWAP_V3_FACTORY` fixes that.
///
///         WHY ONE CONTRACT AND NOT THE NINE the `oprek-uniswap` kit deploys: ArcReserve uses no
///         periphery. `AssetFactory` calls `getPool`/`createPool`, and `AssetMarketManager` drives
///         the pool through mint/burn/collect/swap callbacks. So there is no `SwapRouter`, no
///         `NonfungiblePositionManager` (which the kit's own docs flag as huge and near the 24KB
///         limit — the most likely thing to fail on a new chain), no `NFTDescriptor` library
///         linking, no `Quoter`, and no WETH9. Deploying them would cost 15-20M gas for contracts
///         nothing in this system calls.
///
///         Equally, there is no `PoolAddress.POOL_INIT_CODE_HASH` anywhere in ArcReserve's path,
///         so the init-code-hash trap that breaks most fresh V3 deployments cannot affect it.
///
///         The bytecode is the canonical mainnet build, vendored at `vendor/UniswapV3Factory.json`
///         from the v3-core 1.0.1 npm package. Its pool init code hash is `0xe34f199b…`, the same
///         constant Uniswap's own periphery hardcodes — verified, not assumed.
///
///         Measured cost: **5,440,656 gas**, which fits under Hedera's 15,000,000 per-transaction
///         cap and EIP-7825's 16,777,216.
///
///         KNOWN RISK ON HEDERA, unresolved until it is tried with a funded account: the factory's
///         initcode is 24,939 bytes. Hedera's `EthereumTransaction` has historically capped
///         calldata far below that, with larger deployments needing the HFS call-data path or
///         jumbo-transaction support. Gas is not the binding constraint here; transaction SIZE may
///         be. Nothing in a simulation enforces that — the same shape as the EIP-7825 lesson that
///         forced D-033.
///
///         Usage:
///           PRIVATE_KEY=0x… forge script script/DeployUniswapFactory.s.sol:DeployUniswapFactory \
///             --rpc-url $HEDERA_TESTNET_RPC_URL --broadcast --slow
contract DeployUniswapFactory is Script {
    uint256 private constant CHAIN_HEDERA_TESTNET = 296;
    uint256 private constant CHAIN_ANVIL = 31_337;
    uint256 private constant CHAIN_BASE_SEPOLIA = 84_532;
    /// @dev Circle's Arc testnet. Like Hedera it has no canonical Uniswap V3, so it needs this.
    uint256 private constant CHAIN_ARC_TESTNET = 5_042_002;

    /// @dev Canonical Uniswap V3 factory on Base Sepolia. Only used to refuse redeployment there.
    address private constant BASE_SEPOLIA_V3_FACTORY = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;

    // NO `setUp()` FORK, DELIBERATELY. A `setUp` that calls `vm.createSelectFork` on a hardcoded
    // endpoint OVERRIDES `--rpc-url` for execution: the script then runs, and broadcasts, against
    // the forked chain while the operator believes it is targeting the one they passed. That
    // happened on 2026-09-12 — a factory intended for Arc testnet was deployed to Hedera instead,
    // and the only reason it was caught is that the script logs `block.chainid` and it read 296.
    // This script targets whatever `--rpc-url` says, and nothing else.

    function run() external returns (address factory) {
        // D-027: testnets only. Base Sepolia is refused outright rather than merely warned about —
        // it ALREADY has canonical Uniswap V3, and a second instance splits liquidity between two
        // pools for the same pair, which is unrecoverable without redeploying the asset system.
        require(
            block.chainid == CHAIN_HEDERA_TESTNET || block.chainid == CHAIN_ANVIL
                || block.chainid == CHAIN_ARC_TESTNET,
            "DeployUniswapFactory: only Hedera (296), Arc testnet (5042002) or Anvil (31337)"
        );
        if (block.chainid == CHAIN_BASE_SEPOLIA) {
            revert("DeployUniswapFactory: Base Sepolia already has canonical V3");
        }

        uint256 privateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        require(privateKey != 0, "DeployUniswapFactory: PRIVATE_KEY is required");

        vm.startBroadcast(privateKey);
        factory = deployCode("vendor/UniswapV3Factory.json");
        vm.stopBroadcast();

        _verify(factory);

        console2.log("UniswapV3Factory deployed");
        console2.log("  chainId:", block.chainid);
        console2.log("  address:", factory);
        console2.log("Pass it to DeployTestnet as UNISWAP_V3_FACTORY.");
    }

    /// @dev A factory that deployed but registered no fee tiers would produce `createPool`
    ///      reverts much later, at asset-deployment time, where the cause is far from obvious.
    ///      The constructor sets these three, so checking them proves the deploy actually ran.
    function _verify(address factory) private view {
        require(factory.code.length > 20_000, "DeployUniswapFactory: runtime too small");
        IV3FactoryCheck f = IV3FactoryCheck(factory);
        require(f.feeAmountTickSpacing(500) == 10, "DeployUniswapFactory: 0.05% tier missing");
        require(f.feeAmountTickSpacing(3_000) == 60, "DeployUniswapFactory: 0.30% tier missing");
        require(f.feeAmountTickSpacing(10_000) == 200, "DeployUniswapFactory: 1% tier missing");
    }
}
