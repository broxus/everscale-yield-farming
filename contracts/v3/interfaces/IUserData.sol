pragma ton-solidity ^0.57.1;
pragma AbiHeader expire;


interface IUserData {
    event UserDataUpdated(uint32 prev_version, uint32 new_version);

    struct UserDataDetails {
        uint128[] pool_debt;
        uint128[] entitled;
        uint32[] vestingTime;
        uint128 amount;
        uint128[] rewardDebt;
        address farmPool;
        address user;
        uint32 current_version;
    }

    function getDetails() external responsible view returns (UserDataDetails);
    function processDeposit(uint64 nonce, uint128 _amount, uint256[] _accTonPerShare, uint32 poolLastRewardTime, uint32 farmEndTime, uint32 code_version) external;
    function processWithdraw(uint128 _amount, uint256[] _accTonPerShare, uint32 poolLastRewardTime, uint32 farmEndTime, address send_gas_to, uint32 nonce, uint32 code_version) external;
    function processSafeWithdraw(address send_gas_to, uint32 code_version) external;
    function processWithdrawAll(uint256[] _accTonShare, uint32 poolLastRewardTime, uint32 farmEndTime, address send_gas_to, uint32 nonce, uint32 code_version) external;
    function processClaimReward(uint256[] _accTonShare, uint32 poolLastRewardTime, uint32 farmEndTime, address send_gas_to, uint32 nonce, uint32 code_version) external;
    function increasePoolDebt(uint128[] _pool_debt, address send_gas_to, uint32 code_version) external;
    function upgrade(TvmCell new_code, uint32 new_version, address send_gas_to) external;
}
