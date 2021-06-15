pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;

import "./interfaces/ITonFarmPool.sol";
import "./interfaces/IUserData.sol";

contract UserData is IUserData {
    uint256 public amount;
    uint256[] public rewardDebt;
    address public static farmPool;
    address public static user; // setup from initData
    uint8 constant NOT_FARM_POOL = 101;
    uint128 constant CONTRACT_MIN_BALANCE = 0.1 ton;


    constructor(uint256 reward_tokens_count) public {
        require (farmPool == msg.sender, NOT_FARM_POOL);
        tvm.accept();
        for (uint i = 0; i < reward_tokens_count; i++) {
            rewardDebt.push(0);
        }
    }

    function _reserve() internal pure returns (uint128) {
        return math.max(address(this).balance - msg.value, CONTRACT_MIN_BALANCE);
    }

    function getDetails() external responsible view override returns (UserDataDetails) {
        return { value: 0, bounce: false, flag: 64 }UserDataDetails(amount, rewardDebt, farmPool, user);
    }


    function processDeposit(uint64 nonce, uint256 _amount, uint256[] _accTonPerShare) external override {
        require(msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 2);

        uint256 prevAmount = amount;
        uint256[] prevRewardDebt = rewardDebt;

        amount += _amount;
        for (uint i = 0; i < rewardDebt.length; i++) {
            rewardDebt[i] = (amount * _accTonPerShare[i]) / 1e18;
        }

        ITonFarmPool(msg.sender).finishDeposit{value: 0, flag: 128}(nonce, prevAmount, prevRewardDebt, _accTonPerShare);
    }

    function _withdraw(uint256 _amount, uint256[] _accTonPerShare, address send_gas_to) internal {
        // bad input. User does not have enough staked balance. At least we can return some gas
        if (_amount > amount) {
            send_gas_to.transfer(0, false, 128);
            return;
        }

        uint256 prevAmount = amount;
        uint256[] prevRewardDebt = rewardDebt;

        amount -= _amount;
        for (uint i = 0; i < _accTonPerShare.length; i++) {
            rewardDebt[i] = (amount * _accTonPerShare[i]) / 1e18;
        }

        ITonFarmPool(msg.sender).finishWithdraw{value: 0, flag: 128}(user, prevAmount, prevRewardDebt, _amount, _accTonPerShare, send_gas_to);
    }

    function processWithdraw(uint256 _amount, uint256[] _accTonPerShare, address send_gas_to) public override {
        require (msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 2);

        _withdraw(_amount, _accTonPerShare, send_gas_to);
    }

    function processWithdrawAll(uint256[] _accTonPerShare, address send_gas_to) external override {
        require (msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 2);

        _withdraw(amount, _accTonPerShare, send_gas_to);
    }

    function processSafeWithdraw(address send_gas_to) external override {
        require (msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 2);
        uint256 prevAmount = amount;
        amount = 0;
        for (uint i = 0; i < rewardDebt.length; i++) {
            rewardDebt[i] = 0;
        }
        ITonFarmPool(msg.sender).finishSafeWithdraw{value: 0, flag: 128}(user, prevAmount, send_gas_to);
    }
}
