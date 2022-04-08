pragma ton-solidity ^0.57.1;
pragma AbiHeader expire;


import './EverFarmPoolV3.sol';
import "./interfaces/IFabric.sol";
import './interfaces/IEverFarmPool.sol';
import "@broxus/contracts/contracts/libraries/MsgFlag.sol";


contract FarmFabricV3 is IFabric {
    event NewFarmPool(
        address pool,
        address pool_owner,
        IEverFarmPool.RewardRound[] reward_rounds,
        address tokenRoot,
        address[] rewardTokenRoot,
        uint32 vestingPeriod,
        uint32 vestingRatio,
        uint32 withdrawAllLockPeriod
    );

    event FarmPoolCodeUpdated(uint32 prev_version, uint32 new_version);
    event UserDataCodeUpdated(uint32 prev_version, uint32 new_version);
    event FabricUpdated(uint32 prev_version, uint32 new_version);
    event NewOwner(address prev_owner, address new_owner);

    uint32 public fabric_version;
    uint32 public farm_pool_version;
    uint32 public user_data_version;
    uint64 public pools_count = 0;
    address public owner;

    TvmCell public static FarmPoolUserDataCode;
    TvmCell public static FarmPoolCode;
    TvmCell public static PlatformCode;

    // fabric deployment seed
    uint128 public static nonce;

    uint8 constant WRONG_PUBKEY = 101;
    uint8 constant NOT_OWNER = 102;
    uint8 constant NOT_POOL = 103;
    uint8 constant LOW_MSG_VALUE = 104;
    uint128 constant FARM_POOL_DEPLOY_VALUE = 5 ton;
    uint128 constant POOL_UPGRADE_VALUE = 1 ton;
    uint128 constant CONTRACT_MIN_BALANCE = 1 ton;

    constructor(address _owner) public {
        require (tvm.pubkey() == msg.pubkey(), WRONG_PUBKEY);
        tvm.accept();

        owner = _owner;
    }

    function _reserve() internal pure returns (uint128) {
        return math.max(address(this).balance - msg.value, CONTRACT_MIN_BALANCE);
    }

    function transferOwnership(address new_owner, address send_gas_to) external {
        require (msg.sender == owner, NOT_OWNER);
        tvm.rawReserve(_reserve(), 0);

        emit NewOwner(owner, new_owner);
        owner = new_owner;
        send_gas_to.transfer({ value: 0, bounce: false, flag: MsgFlag.ALL_NOT_RESERVED });
    }

    function installNewFarmPoolCode(TvmCell farm_pool_code, address send_gas_to) external {
        require (msg.sender == owner, NOT_OWNER);
        require (msg.value >= POOL_UPGRADE_VALUE, LOW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 0);

        FarmPoolCode = farm_pool_code;
        farm_pool_version++;
        emit FarmPoolCodeUpdated(farm_pool_version - 1, farm_pool_version);
        send_gas_to.transfer({ value: 0, bounce: false, flag: MsgFlag.ALL_NOT_RESERVED });
    }

    function installNewUserDataCode(TvmCell user_data_code, address send_gas_to) external {
        require (msg.sender == owner, NOT_OWNER);
        require (msg.value >= POOL_UPGRADE_VALUE, LOW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 0);

        FarmPoolUserDataCode = user_data_code;
        user_data_version++;
        emit UserDataCodeUpdated(user_data_version - 1, user_data_version);
        send_gas_to.transfer({ value: 0, bounce: false, flag: MsgFlag.ALL_NOT_RESERVED });
    }

    function upgradePools(address[] pools, address send_gas_to) external {
        require (msg.sender == owner, NOT_OWNER);
        require (msg.value >= POOL_UPGRADE_VALUE * (pools.length + 1), LOW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 0);

        for (uint i = 0; i < pools.length; i++) {
            IEverFarmPool(pools[i]).upgrade{value: POOL_UPGRADE_VALUE, flag: MsgFlag.SENDER_PAYS_FEES}(
                FarmPoolCode, farm_pool_version, send_gas_to
            );
        }
        send_gas_to.transfer({ value: 0, bounce: false, flag: MsgFlag.ALL_NOT_RESERVED });
}

    function updatePoolsUserDataCode(address[] pools, address send_gas_to) external {
        require (msg.sender == owner, NOT_OWNER);
        require (msg.value >= POOL_UPGRADE_VALUE * (pools.length + 1), LOW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 0);

        for (uint i = 0; i < pools.length; i++) {
            IEverFarmPool(pools[i]).updateUserDataCode{value: POOL_UPGRADE_VALUE, flag: MsgFlag.SENDER_PAYS_FEES}(
                FarmPoolUserDataCode, user_data_version, send_gas_to
            );
        }
        send_gas_to.transfer({ value: 0, bounce: false, flag: MsgFlag.ALL_NOT_RESERVED });
    }

    function forceUpdateUserData(address pool, address user, address send_gas_to) external {
        require (msg.sender == owner, NOT_OWNER);
        require (msg.value >= POOL_UPGRADE_VALUE, LOW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 0);

        IEverFarmPool(pool).forceUpgradeUserData{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(user, send_gas_to);
    }

    function processUpgradePoolRequest(address send_gas_to) external override {
        require (msg.value >= POOL_UPGRADE_VALUE, LOW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 0);

        IEverFarmPool(msg.sender).upgrade{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(
            FarmPoolCode, farm_pool_version, send_gas_to
        );
    }

    function processUpdatePoolUserDataRequest(address send_gas_to) external override {
        require (msg.value >= POOL_UPGRADE_VALUE, LOW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 0);

        IEverFarmPool(msg.sender).updateUserDataCode{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(
            FarmPoolUserDataCode, user_data_version, send_gas_to
        );
    }

    function deployFarmPool(
        address pool_owner,
        IEverFarmPool.RewardRound[] reward_rounds,
        address tokenRoot,
        address[] rewardTokenRoot,
        uint32 vestingPeriod,
        uint32 vestingRatio,
        uint32 withdrawAllLockPeriod
    ) external {
        tvm.rawReserve(_reserve(), 0);
        require (msg.value >= FARM_POOL_DEPLOY_VALUE, LOW_MSG_VALUE);

        TvmCell stateInit = tvm.buildStateInit({
            contr: EverFarmPoolV3,
            varInit: {
                userDataCode: FarmPoolUserDataCode,
                platformCode: PlatformCode,
                deploy_nonce: pools_count,
                fabric: address(this),
                user_data_version: user_data_version,
                pool_version: farm_pool_version
            },
            pubkey: tvm.pubkey(),
            code: FarmPoolCode
        });
        pools_count += 1;

        address farm_pool = new EverFarmPoolV3{
            stateInit: stateInit,
            value: 0,
            wid: address(this).wid,
            flag: MsgFlag.ALL_NOT_RESERVED
        }(pool_owner, reward_rounds, tokenRoot, rewardTokenRoot, vestingPeriod, vestingRatio, withdrawAllLockPeriod);
    }

    function onPoolDeploy(
        uint64 pool_deploy_nonce,
        address pool_owner,
        IEverFarmPool.RewardRound[] reward_rounds,
        address tokenRoot,
        address[] rewardTokenRoot,
        uint32 vestingPeriod,
        uint32 vestingRatio,
        uint32 withdrawAllLockPeriod
    ) external override {
        TvmCell stateInit = tvm.buildStateInit({
            contr: EverFarmPoolV3,
            varInit: {
                userDataCode: FarmPoolUserDataCode,
                platformCode: PlatformCode,
                deploy_nonce: pool_deploy_nonce,
                fabric: address(this),
                user_data_version: user_data_version,
                pool_version: farm_pool_version
            },
            pubkey: tvm.pubkey(),
            code: FarmPoolCode
        });
        address pool_address = address(tvm.hash(stateInit));
        require (msg.sender == pool_address, NOT_POOL);

        tvm.rawReserve(_reserve(), 0);

        emit NewFarmPool(pool_address, pool_owner, reward_rounds, tokenRoot, rewardTokenRoot, vestingPeriod, vestingRatio, withdrawAllLockPeriod);
    }

    function upgrade(TvmCell new_code, address send_gas_to) public {
        require (msg.sender == owner, NOT_OWNER);
        require (msg.value >= POOL_UPGRADE_VALUE, LOW_MSG_VALUE);

        TvmCell data = abi.encode(
            owner,
            pools_count,
            nonce,
            farm_pool_version,
            user_data_version,
            fabric_version,
            FarmPoolUserDataCode,
            FarmPoolCode,
            PlatformCode
        );

        tvm.setcode(new_code);
        tvm.setCurrentCode(new_code);

        onCodeUpgrade(data);
    }

    function onCodeUpgrade(TvmCell data) internal {
        tvm.resetStorage();
        // upgrading from v1
        TvmSlice _data = data.toSlice();

        owner = _data.decode(address);
        pools_count = _data.decode(uint64);
        nonce = _data.decode(uint128);
        farm_pool_version = _data.decode(uint32);
        user_data_version = _data.decode(uint32);

        FarmPoolUserDataCode = _data.loadRef();
        FarmPoolCode = _data.loadRef();
        PlatformCode = _data.loadRef();

        fabric_version = 1;

        emit FabricUpdated(0, fabric_version);
        owner.transfer({ value: 0, bounce: false, flag: MsgFlag.ALL_NOT_RESERVED });
    }
}