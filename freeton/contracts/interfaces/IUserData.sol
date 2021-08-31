pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;


interface IUserData {
    struct UserDataDetails {
        uint128[] pool_debt;
        uint128[] entitled;
        uint32 vestingTime;
        uint128 amount;
        uint128[] rewardDebt;
        address farmPool;
        address user;
    }

    function getDetails() external responsible view returns (UserDataDetails);
    function processDeposit(uint64 nonce, uint128 _amount, uint256[] _accTonPerShare, uint32 poolLastRewardTime) external;
    function processWithdraw(uint128 _amount, uint256[] _accTonPerShare, uint32 poolLastRewardTime, address send_gas_to, TvmCell callback_payload) external;
    function processSafeWithdraw(address send_gas_to) external;
    function processWithdrawAll(uint256[] _accTonShare, uint32 poolLastRewardTime, address send_gas_to, TvmCell callback_payload) external;
    function processClaimReward(uint256[] _accTonShare, uint32 poolLastRewardTime, address send_gas_to, TvmCell callback_payload) external;
    function increasePoolDebt(uint128[] _pool_debt, address send_gas_to) external;
}
