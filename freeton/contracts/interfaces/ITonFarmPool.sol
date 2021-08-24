pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;

interface ITonFarmPool {
    struct Details {
        uint32 lastRewardTime;
        uint32 farmStartTime;
        uint32 farmEndTime;
        address tokenRoot;
        address tokenWallet;
        uint128 tokenBalance;
        uint128[] rewardPerSecond;
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
        uint128 prevAmount,
        uint128[] prevRewardDebt,
        uint256[] accTonPerShare
    ) external;
    function finishWithdraw(
        address user,
        uint128 prevAmount,
        uint128[] prevRewardDebt,
        uint128 withdrawAmount,
        uint256[] accTonPerShare,
        address send_gas_to
    ) external;
    function finishSafeWithdraw(address user, uint128 amount, address send_gas_to) external;
}
