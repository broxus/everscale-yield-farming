pragma ton-solidity ^0.41.0;
pragma AbiHeader expire;


interface IUserData {
    function processDeposit(uint128 _amount, uint128 _accTonPerShare, address send_gas_to) external;
    function processWithdraw(uint128 _amount, uint128 _accTonPerShare, address send_gas_to) external;
}
