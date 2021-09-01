pragma ton-solidity ^0.49.0;
pragma AbiHeader expire;

interface ITonFarmPool {
    struct RewardRound {
        uint32 startTime;
        uint128[] rewardPerSecond;
    }
    // Events
    event Deposit(address user, uint128 amount);
    event Withdraw(address user, uint128 amount);
    event Reward(address user, uint128[] amount);
    event RewardDebt(address user, uint128[] amount);
    event RewardDeposit(address token_root, uint128 amount);
    event RewardRoundAdded(RewardRound reward_round);
    event farmEndSet(uint32 time);

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
        TvmCell callback_payload
    ) external;
    function finishSafeWithdraw(address user, uint128 amount, address send_gas_to) external;
}
