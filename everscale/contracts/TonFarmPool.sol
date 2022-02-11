pragma ton-solidity ^0.57.1;
pragma AbiHeader expire;

import "./base/TonFarmPoolBase.sol";
import "./interfaces/ITonFarmPool.sol";


contract TonFarmPool is TonFarmPoolBase {
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
        builder_1.store(accTonPerShare); // 33 + ref
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

    function onCodeUpgrade(TvmCell upgrade_data) private {}
}