pragma ton-solidity ^0.57.1;
pragma AbiHeader expire;

interface ITonFarmPool {
    struct RewardRound {
        uint32 startTime;
        uint128[] rewardPerSecond;
    }
    // Events
    event Deposit(address user, uint128 amount, uint128[] reward, uint128[] reward_debt);
    event Withdraw(address user, uint128 amount, uint128[] reward, uint128[] reward_debt);
    event Claim(address user, uint128[] reward, uint128[] reward_debt);

    event RewardDeposit(address token_root, uint128 amount);
    event RewardRoundAdded(RewardRound reward_round);
    event farmEndSet(uint32 time);
    event UserDataCodeUpdated(uint32 prev_version, uint32 new_version);

    struct Details {
        uint32 lastRewardTime;
        uint32 farmEndTime;
        uint32 vestingPeriod;
        uint32 vestingRatio;
        address tokenRoot;
        address tokenWallet;
        uint128 tokenBalance;
        RewardRound[] rewardRounds;
        uint256[] accTonPerShare;
        address[] rewardTokenRoot;
        address[] rewardTokenWallet;
        uint128[] rewardTokenBalance;
        uint128[] rewardTokenBalanceCumulative;
        uint128[] unclaimedReward;
        address owner;
        address fabric;
        uint32 user_data_version;
        uint32 pool_version;
    }
    function finishDeposit(
        uint64 _nonce,
        uint128[] vested
    ) external;
    function finishWithdraw(
        address user,
        uint128 withdrawAmount,
        uint128[] vested,
        address send_gas_to,
        uint32 nonce
    ) external;
    function finishSafeWithdraw(address user, uint128 amount, address send_gas_to) external;
    function upgrade(TvmCell new_code, uint32 new_version, address send_gas_to) external;
    function updateUserDataCode(TvmCell new_code, uint32 new_version, address send_gas_to) external;
}
