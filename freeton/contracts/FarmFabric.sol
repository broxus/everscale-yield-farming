pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;

import './TonFarmPool.sol';
import "./interfaces/IFabric.sol";
import './UserData.sol';

contract FarmFabric is IFabric {
    event NewFarmPool(
        address pool,
        address pool_owner,
        TonFarmPool.RewardRound[] reward_rounds,
        address tokenRoot,
        address[] rewardTokenRoot,
        uint32 vestingPeriod,
        uint32 vestingRatio
    );

    uint64 public pools_count = 0;
    address public owner;

    TvmCell public static FarmPoolUserDataCode;
    TvmCell public static FarmPoolCode;

    // fabric deployment seed
    uint128 public static nonce;

    uint8 public constant WRONG_PUBKEY = 101;
    uint8 public constant NOT_OWNER = 102;
    uint8 public constant NOT_POOL = 103;
    uint128 public constant FARM_POOL_DEPLOY_VALUE = 5 ton;
    uint128 constant CONTRACT_MIN_BALANCE = 1 ton;

    constructor(address _owner) public {
        require (tvm.pubkey() == msg.pubkey(), WRONG_PUBKEY);
        tvm.accept();

        owner = _owner;
    }

    function deployFarmPool(
        address pool_owner,
        TonFarmPool.RewardRound[] reward_rounds,
        address tokenRoot,
        address[] rewardTokenRoot,
        uint32 vestingPeriod,
        uint32 vestingRatio
    ) public {
        tvm.rawReserve(math.max(address(this).balance - msg.value, CONTRACT_MIN_BALANCE), 2);

        TvmCell stateInit = tvm.buildStateInit({
            contr: TonFarmPool,
            varInit: { userDataCode: FarmPoolUserDataCode, deploy_nonce: pools_count, fabric: address(this) },
            pubkey: tvm.pubkey(),
            code: FarmPoolCode
        });
        pools_count += 1;

        address farm_pool = new TonFarmPool{
            stateInit: stateInit,
            value: FARM_POOL_DEPLOY_VALUE,
            wid: address(this).wid,
            flag: 1
        }(pool_owner, reward_rounds, tokenRoot, rewardTokenRoot, vestingPeriod, vestingRatio);
    }

    function onPoolDeploy(
        uint64 pool_deploy_nonce,
        address pool_owner,
        TonFarmPool.RewardRound[] reward_rounds,
        address tokenRoot,
        address[] rewardTokenRoot,
        uint32 vestingPeriod,
        uint32 vestingRatio
    ) external override {
        TvmCell stateInit = tvm.buildStateInit({
            contr: TonFarmPool,
            varInit: { userDataCode: FarmPoolUserDataCode, deploy_nonce: pool_deploy_nonce, fabric: address(this) },
            pubkey: tvm.pubkey(),
            code: FarmPoolCode
        });
        address pool_address = address(tvm.hash(stateInit));
        require (msg.sender == pool_address, NOT_POOL);

        tvm.rawReserve(math.max(address(this).balance - msg.value, CONTRACT_MIN_BALANCE), 2);

        emit NewFarmPool(pool_address, pool_owner, reward_rounds, tokenRoot, rewardTokenRoot, vestingPeriod, vestingRatio);
    }


    function upgrade(TvmCell new_code) public {
        require (msg.sender == owner, NOT_OWNER);
        TvmBuilder builder;

        // storage vars
        builder.store(owner);
        builder.store(pools_count);
        builder.store(nonce);
        builder.store(FarmPoolUserDataCode); // ref
        builder.store(FarmPoolCode); // ref

        tvm.setcode(new_code);
        tvm.setCurrentCode(new_code);

        onCodeUpgrade(builder.toCell());
    }

    function onCodeUpgrade(TvmCell data) internal {}
}