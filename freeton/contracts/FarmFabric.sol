pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;

import './TonFarmPool.sol';
import './UserData.sol';

contract FarmFabric {
    uint64 public pools_count = 0;
    address public owner;

    TvmCell public static FarmPoolUserDataCode;
    TvmCell public static FarmPoolCode;

    // fabric deployment seed
    uint128 public static nonce;

    uint8 public constant WRONG_PUBKEY = 101;
    uint8 public constant NOT_OWNER = 102;
    uint128 public constant FARM_POOL_DEPLOY_VALUE = 5 ton;
    uint128 constant CONTRACT_MIN_BALANCE = 1 ton;

    constructor(address _owner) public {
        require (tvm.pubkey() == msg.pubkey(), WRONG_PUBKEY);
        tvm.accept();

        owner = _owner;
    }

    function deployFarmPool(
        address pool_owner,
        uint256 rewardPerSecond,
        uint256 farmStartTime,
        uint256 farmEndTime,
        address tokenRoot,
        address rewardTokenRoot
    ) public returns (address, address, uint256, uint256, uint256, address, address) {
        tvm.rawReserve(math.max(address(this).balance - msg.value, CONTRACT_MIN_BALANCE), 2);

        TvmCell stateInit = tvm.buildStateInit({
            contr: TonFarmPool,
            varInit: { userDataCode: FarmPoolUserDataCode, deploy_nonce: pools_count },
            pubkey: tvm.pubkey(),
            code: FarmPoolCode
        });
        pools_count += 1;

        address farm_pool = new TonFarmPool{
            stateInit: stateInit,
            value: FARM_POOL_DEPLOY_VALUE,
            wid: address(this).wid,
            flag: 1
        }(pool_owner, rewardPerSecond, farmStartTime, farmEndTime, tokenRoot, rewardTokenRoot);

        return (farm_pool, pool_owner, rewardPerSecond, farmStartTime, farmEndTime, tokenRoot, rewardTokenRoot);
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