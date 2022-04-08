pragma ton-solidity ^0.57.1;
pragma AbiHeader expire;

import "./base/EverFarmPoolBase.sol";
import "./interfaces/IEverFarmPool.sol";


contract EverFarmPoolV3 is EverFarmPoolBase {
    constructor(
        address _owner,
        RewardRound[] _rewardRounds,
        address _tokenRoot,
        address[] _rewardTokenRoot,
        uint32 _vestingPeriod,
        uint32 _vestingRatio,
        uint32 _withdrawAllLockPeriod
    ) public {
        require (_vestingRatio <= 1000, BAD_VESTING_SETUP);
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

        // should be unpacked in the same order!
        TvmCell data = abi.encode(
            new_version, // 32
            send_gas_to, // 267
            withdrawAllLockPeriod, // 32
            lastRewardTime, // 32
            farmEndTime, // 32
            vestingPeriod, // 32
            vestingRatio,// 32
            tokenRoot, // 267
            tokenWallet, // 267
            tokenBalance, // 128
            rewardRounds, // 33 + ref
            accRewardPerShare, // 33 + ref
            rewardTokenRoot, // 33 + ref
            rewardTokenWallet, // 33 + ref
            rewardTokenBalance, // 33 + ref
            rewardTokenBalanceCumulative, // 33 + ref
            unclaimedReward, // 33 + ref
            owner, // 267
            deposit_nonce, // 64
            deposits, // 33 + ref
            platformCode, // 33 + ref
            userDataCode, // 33 + ref
            fabric, // 267
            deploy_nonce, // 64
            user_data_version, // 32
            pool_version // 32
        );

        // set code after complete this method
        tvm.setcode(new_code);
        // run onCodeUpgrade from new code
        tvm.setCurrentCode(new_code);

        onCodeUpgrade(data);
    }

    // upgrade from v2
    function onCodeUpgrade(TvmCell upgrade_data) private {
        // no changes in storage, we dont need tvm.resetStorage()
        tvm.rawReserve(_reserve(), 0);

        TvmSlice s = upgrade_data.toSlice();
        uint32 prev_version = pool_version;
        pool_version = s.decode(uint32);
        address send_gas_to = s.decode(address);

        emit PoolUpdated(prev_version, pool_version);
        send_gas_to.transfer({value: 0, flag: MsgFlag.ALL_NOT_RESERVED, bounce: false});
    }
}