pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;

interface ITonFarmPool {
    function finishDeposit(uint64 _nonce, uint128 prevAmount, uint128 prevRewardDebt) external;
    function finishWithdraw(address user, uint128 prevAmount, uint128 prevRewardDebt, uint128 withdrawAmount, address send_gas_to) external;
    function finishSafeWithdraw(address user, uint128 amount, address send_gas_to) external;
}
