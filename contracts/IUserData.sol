pragma solidity ^0.40.0;
pragma AbiHeader expire;


contract IUserData {
    function processDeposit(uint128 _amount, uint128 _accTonPerShare, address send_gas_to) external;
    function processWithdraw(uint128 _amount, uint128 _accTonPerShare, address send_gas_to) external;
}
