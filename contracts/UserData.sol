pragma solidity ^0.40.0;
pragma AbiHeader expire;

import "./ITonFarmPool.sol";
import "./IUserData.sol";

contract UserData is IUserData {
    uint128 public amount;
    uint128 public rewardDebt;
    address public farmPool;
    address public static user;

    constructor() {
        tvm.accept();
        farmPool = msg.sender;
    }

    // TODO: onbounce?

    function processDeposit(uint128 _amount, uint128 _accTonPerShare, address send_gas_to) external {
        require(msg.sender == farmPool);
        tvm.rawReserve(address(this).balance - msg.value, 2);

        uint128 prevAmount = amount;
        uint128 prevRewardDebt = rewardDebt;

        amount += _amount;
        rewardDebt = amount * _accTonPerShare / 1e12;

        ITonFarmPool(msg.sender).finishDeposit{value: 0, flag: 128}(user, prevAmount, prevRewardDebt, _amount, send_gas_to);
    }

    function processWithdraw(uint128 _amount, uint128 _accTonPerShare, address send_gas_to) external {
        require(msg.sender == farmPool);
        tvm.rawReserve(address(this).balance - msg.value, 2);

        uint128 prevAmount = amount;
        uint128 prevRewardDebt = rewardDebt;

        amount -= _amount;
        rewardDebt = amount * _accTonPerShare / 1e12;

        ITonFarmPool(msg.sender).finishWithdraw{value: 0, flag: 128}(user, prevAmount, prevRewardDebt, _amount, send_gas_to);
    }
}

