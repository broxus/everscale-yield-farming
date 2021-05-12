pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;

interface ITonFarmPool {
    function finishDeposit(uint64 _nonce, uint256 prevAmount, uint256 prevRewardDebt, uint256 accTonPerShare) external;
    function finishWithdraw(address user, uint256 prevAmount, uint256 prevRewardDebt, uint256 withdrawAmount, uint256 accTonPerShare, address send_gas_to) external;
    function finishSafeWithdraw(address user, uint256 amount, address send_gas_to) external;
    function finishWithdrawAll(address user, uint256 _prevAmount, uint256 _prevRewardDebt, uint256 _accTonPerShare, address send_gas_to) external;
}
