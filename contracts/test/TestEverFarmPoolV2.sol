pragma ton-solidity ^0.57.1;
pragma AbiHeader expire;

import "../v1/base/EverFarmPoolBase.sol";
import "../v1/interfaces/IEverFarmPool.sol";


contract TestEverFarmPoolV2 is EverFarmPoolBase {
    event PoolUpdated(uint32 prev_version, uint32 new_version);

    constructor(
        address _owner,
        RewardRound[] _rewardRounds,
        address _tokenRoot,
        address[] _rewardTokenRoot,
        uint32 _vestingPeriod,
        uint32 _vestingRatio,
        uint32 _withdrawAllLockPeriod
    ) public {
        require (_rewardRounds.length > 0, BAD_REWARD_ROUNDS_INPUT);
        require ((_vestingPeriod == 0 && _vestingRatio == 0) || (_vestingPeriod > 0 && _vestingRatio > 0), BAD_VESTING_SETUP);
        for (uint i = 0; i < _rewardRounds.length; i++) {
            if (i > 0) {
                require(_rewardRounds[i].startTime > _rewardRounds[i - 1].startTime, BAD_REWARD_ROUNDS_INPUT);
            }
            require(_rewardRounds[i].rewardPerSecond.length == _rewardTokenRoot.length, BAD_REWARD_ROUNDS_INPUT);
        }
        require (msg.sender == fabric, NOT_FABRIC);
        tvm.accept();

        rewardRounds = _rewardRounds;
        tokenRoot = _tokenRoot;
        rewardTokenRoot = _rewardTokenRoot;
        owner = _owner;
        vestingRatio = _vestingRatio;
        vestingPeriod = _vestingPeriod;
        withdrawAllLockPeriod = _withdrawAllLockPeriod;

        setUp();

        IFabric(fabric).onPoolDeploy{value: FABRIC_DEPLOY_CALLBACK_VALUE}(
            deploy_nonce, _owner, _rewardRounds, _tokenRoot, _rewardTokenRoot, vestingPeriod, vestingRatio, withdrawAllLockPeriod
        );
    }

    // we dont need it for testing
    function upgrade(TvmCell new_code, uint32 new_version, address send_gas_to) external override {
        require (msg.sender == fabric, NOT_FABRIC);

        if (new_version == pool_version) {
            tvm.rawReserve(_reserve(), 0);
            send_gas_to.transfer({ value: 0, bounce: false, flag: MsgFlag.ALL_NOT_RESERVED });
            return;
        }

        TvmBuilder main_builder;
        main_builder.store(new_version); // 32
        main_builder.store(send_gas_to); // 267

        TvmBuilder builder_1;
        builder_1.store(withdrawAllLockPeriod); // 32
        builder_1.store(lastRewardTime); // 32
        builder_1.store(farmEndTime); // 32
        builder_1.store(vestingPeriod); // 32
        builder_1.store(vestingRatio); // 32
        builder_1.store(tokenRoot); // 267
        builder_1.store(tokenWallet); // 267
        builder_1.store(tokenBalance); // 128
        builder_1.store(rewardRounds); // 33 + ref
        builder_1.store(accRewardPerShare); // 33 + ref
        builder_1.store(rewardTokenRoot); // 33 + ref
        // 1017 + 3 ref

        TvmBuilder builder_2;
        builder_2.store(rewardTokenWallet); // 33 + ref
        builder_2.store(rewardTokenBalance); // 33 + ref
        builder_2.store(rewardTokenBalanceCumulative); // 33 + ref
        builder_2.store(unclaimedReward); // 33 + ref
        builder_2.store(owner); // 267
        builder_2.store(deposit_nonce); // 64
        // 463 + 4 ref

        TvmBuilder builder_3;
        builder_3.store(deposits); // 33 + ref
        builder_3.store(platformCode); // 33 + ref
        builder_3.store(userDataCode); // 33 + ref
        builder_3.store(fabric); // 267
        builder_3.store(deploy_nonce); // 64
        builder_3.store(user_data_version); // 32
        builder_3.store(pool_version); // 32
        // 494 + 3 ref

        main_builder.storeRef(builder_1);
        main_builder.storeRef(builder_2);
        main_builder.storeRef(builder_3);
        // 299 + 3 ref

        // set code after complete this method
        tvm.setcode(new_code);

        // run onCodeUpgrade from new code
        tvm.setCurrentCode(new_code);
        onCodeUpgrade(main_builder.toCell());
    }

    function onCodeUpgrade(TvmCell upgrade_data) private {
        tvm.resetStorage();
        tvm.rawReserve(_reserve(), 0);

        TvmSlice s = upgrade_data.toSlice();
        pool_version = s.decode(uint32);
        address send_gas_to = s.decode(address);

        TvmSlice data_1 = s.loadRefAsSlice();
        withdrawAllLockPeriod = data_1.decode(uint32);
        lastRewardTime = data_1.decode(uint32);
        farmEndTime = data_1.decode(uint32);
        vestingPeriod = data_1.decode(uint32);
        vestingRatio = data_1.decode(uint32);
        tokenRoot = data_1.decode(address);
        tokenWallet = data_1.decode(address);
        tokenBalance = data_1.decode(uint128);
        rewardRounds = data_1.decode(RewardRound[]);
        accRewardPerShare = data_1.decode(uint256[]);
        rewardTokenRoot = data_1.decode(address[]);

        TvmSlice data_2 = s.loadRefAsSlice();
        rewardTokenWallet = data_2.decode(address[]);
        rewardTokenBalance = data_2.decode(uint128[]);
        rewardTokenBalanceCumulative = data_2.decode(uint128[]);
        unclaimedReward = data_2.decode(uint128[]);
        owner = data_2.decode(address);
        deposit_nonce = data_2.decode(uint64);

        TvmSlice data_3 = s.loadRefAsSlice();
        deposits = data_3.decode(mapping (uint64 => PendingDeposit));
        platformCode = data_3.loadRef();
        userDataCode = data_3.loadRef();
        fabric = data_3.decode(address);
        deploy_nonce = data_3.decode(uint64);
        user_data_version = data_3.decode(uint32);
        uint32 prev_version = data_3.decode(uint32);

        emit PoolUpdated(prev_version, pool_version);
        send_gas_to.transfer({value: 0, flag: MsgFlag.ALL_NOT_RESERVED, bounce: false});
    }
}