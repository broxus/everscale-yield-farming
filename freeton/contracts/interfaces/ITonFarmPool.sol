pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;

interface ITonFarmPool {
    struct Details {
        uint256 lastRewardTime;
        uint256 farmStartTime;
        uint256 farmEndTime;
        address tokenRoot;
        address tokenWallet;
        uint256 tokenBalance;
        uint256[] rewardPerSecond;
        uint256[] accTonPerShare;
        address[] rewardTokenRoot;
        address[] rewardTokenWallet;
        uint256[] rewardTokenBalance;
        uint256[] rewardTokenBalanceCumulative;
        uint256[] unclaimedReward;
        address owner;
        address fabric;
}
    function finishDeposit(uint64 _nonce, uint256 prevAmount, uint256[] prevRewardDebt, uint256[] accTonPerShare) external;
    function finishWithdraw(address user, uint256 prevAmount, uint256[] prevRewardDebt, uint256 withdrawAmount, uint256[] accTonPerShare, address send_gas_to) external;
    function finishSafeWithdraw(address user, uint256 amount, address send_gas_to) external;
}
