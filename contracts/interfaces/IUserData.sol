pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;


interface IUserData {
    struct UserDataDetails {
        uint128 amount;
        uint128 rewardDebt;
        address farmPool;
        address user;
    }

    function getDetails() external responsible view returns (UserDataDetails);
    function processDeposit(uint64 nonce, uint128 _amount, uint128 _accTonPerShare, address send_gas_to) external;
    function processWithdraw(uint128 _amount, uint128 _accTonPerShare, address send_gas_to) external;
    function processSafeWithdraw(address send_gas_to) external;
}
