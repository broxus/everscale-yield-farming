pragma solidity ^0.40.0;
pragma AbiHeader expire;

import "./ITonFarmPool.sol";
import "./IUserData.sol";

contract UserData is IUserData {
    uint128 public amount;
    uint128 public rewardDebt;
    address public farmPool;
    address public static user; // setup from initData
    uint8 constant NOT_FARM_POOL = 101;


    constructor() {
        tvm.accept();
        farmPool = msg.sender;
    }

    function processDeposit(uint128 _amount, uint128 _accTonPerShare, address send_gas_to) external {
        require(msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(address(this).balance - msg.value, 2);

        uint128 prevAmount = amount;
        uint128 prevRewardDebt = rewardDebt;

        amount += _amount;
        rewardDebt = (amount * _accTonPerShare) / 1e12;

        ITonFarmPool(msg.sender).finishDeposit{value: 0, flag: 128}(user, prevAmount, prevRewardDebt, _amount, send_gas_to);
    }

    function processWithdraw(uint128 _amount, uint128 _accTonPerShare, address send_gas_to) external {
        require (msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(address(this).balance - msg.value, 2);

        // bad input. User does not have enough staked balance. At least we can return some gas
        if (_amount > amount) {
            send_gas_to.transfer(0, false, 128);
            return;
        }

        uint128 prevAmount = amount;
        uint128 prevRewardDebt = rewardDebt;

        amount -= _amount;
        rewardDebt = (amount * _accTonPerShare) / 1e12;

        ITonFarmPool(msg.sender).finishWithdraw{value: 0, flag: 128}(user, prevAmount, prevRewardDebt, _amount, send_gas_to);
    }
}

