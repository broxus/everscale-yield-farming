pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;

import "./interfaces/ITonFarmPool.sol";
import "./interfaces/IUserData.sol";
import "../../node_modules/@broxus/contracts/contracts/libraries/MsgFlag.sol";

contract UserData is IUserData {
    uint32 lastRewardTime;
    uint32 vestingPeriod;
    // number from 0 to 1000 (0% to 100%). 0 means vesting is disabled
    uint32 vestingRatio;
    uint32 vestingTime;

    uint128 public amount;
    uint128[] public rewardDebt;
    uint128[] public entitled;
    address public static farmPool;
    address public static user; // setup from initData
    uint8 constant NOT_FARM_POOL = 101;
    uint128 constant CONTRACT_MIN_BALANCE = 0.1 ton;
    uint32 constant MAX_VESTING_RATIO = 1000;

    constructor(uint8 reward_tokens_count, uint32 _vestingPeriod, uint32 _vestingRatio) public {
        require (farmPool == msg.sender, NOT_FARM_POOL);
        tvm.accept();
        for (uint i = 0; i < reward_tokens_count; i++) {
            rewardDebt.push(0);
            entitled.push(0);
        }
        vestingPeriod = _vestingPeriod;
        vestingRatio = _vestingRatio;
    }

    function _reserve() internal pure returns (uint128) {
        return math.max(address(this).balance - msg.value, CONTRACT_MIN_BALANCE);
    }

    function getDetails() external responsible view override returns (UserDataDetails) {
        return { value: 0, bounce: false, flag: MsgFlag.REMAINING_GAS }UserDataDetails(entitled, vestingTime, amount, rewardDebt, farmPool, user);
    }

    // user_amount and user_reward_debt should be fetched from UserData at first
    function pendingReward(uint256[] _accTonPerShare, uint32 poolLastRewardTime) external view returns (uint128[]) {
        (
        uint128[] _entitled,
        uint128[] _vested,
        uint32 _lastRewardTime
        ) = _computeVesting(amount, rewardDebt, _accTonPerShare, poolLastRewardTime);

        return _vested;
    }

    function _computeVesting(
        uint128 _amount,
        uint128[] _rewardDebt,
        uint256[] _accTonPerShare,
        uint32 _poolLastRewardTime
    ) internal view returns (uint128[], uint128[], uint32) {
        uint32 new_vesting_time;
        uint128[] newly_vested = new uint128[](_rewardDebt.length);
        uint128[] updated_entitled = new uint128[](_rewardDebt.length);

        if (_amount > 0) {
            uint128[] new_entitled = new uint128[](_rewardDebt.length);
            uint32 age = _poolLastRewardTime - lastRewardTime;

            for (uint i = 0; i < _rewardDebt.length; i++) {
                new_entitled[i] = uint128(math.muldiv(_amount, _accTonPerShare[i], 1e18) - _rewardDebt[i]);
                if (vestingRatio > 0) {
                    // calc which part should be payed immediately and with vesting from new reward
                    uint128 vesting_part = (new_entitled[i] * vestingRatio) / MAX_VESTING_RATIO;
                    uint128 clear_part = new_entitled[i] - vesting_part;
                    newly_vested[i] = clear_part + uint128(math.muldiv(new_entitled[i], age, age + vestingPeriod));

                    // now calculate newly vested part of old entitled reward
                    uint32 age2 = _poolLastRewardTime >= vestingTime ? vestingPeriod : _poolLastRewardTime - lastRewardTime;
                    uint128 to_vest = age2 >= vestingPeriod
                        ? entitled[i]
                        : uint128(math.muldiv(entitled[i], age2, vestingTime - lastRewardTime));

                    uint128 newlyVested = to_vest + newly_vested[i];

                    // amount of reward vested from now
                    uint128 remainingEntitled = entitled[i] == 0 ? 0 : entitled[i] - to_vest;
                    uint128 unreleasedNewly = new_entitled[i] - newly_vested[i];
                    uint128 pending = remainingEntitled + unreleasedNewly;

                    // Compute the vesting time (i.e. when the entitled reward to be all vested)
                    uint32 period;
                    if (remainingEntitled == 0 || pending == 0) {
                        // newly entitled reward only or nothing remain entitled
                        period = vestingPeriod;
                    } else {
                        // "old" reward and, perhaps, "new" reward are pending - the weighted average applied
                        uint32 age3 = vestingTime - _poolLastRewardTime;
                        period = uint32(((remainingEntitled * age3) + (unreleasedNewly * vestingPeriod)) / pending);
                    }

                    new_vesting_time = vestingTime + math.min(period, vestingPeriod);
                    updated_entitled[i] = entitled[i] + new_entitled[i] - newlyVested;
                    newly_vested[i] = newlyVested;
                } else {
                    newly_vested[i] = new_entitled[i];
                }
            }
        }

        return (updated_entitled, newly_vested, new_vesting_time);
    }

    function processDeposit(uint64 nonce, uint128 _amount, uint256[] _accTonPerShare, uint32 poolLastRewardTime) external override {
        require(msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 2);

        uint128 prevAmount = amount;
        uint128[] prevRewardDebt = rewardDebt;

        amount += _amount;
        for (uint i = 0; i < rewardDebt.length; i++) {
            rewardDebt[i] = uint128(math.muldiv(amount, _accTonPerShare[i], 1e18));
        }

        (
            uint128[] _entitled,
            uint128[] _vested,
            uint32 _lastRewardTime
        ) = _computeVesting(prevAmount, prevRewardDebt, _accTonPerShare, poolLastRewardTime);
        entitled = _entitled;
        lastRewardTime = _lastRewardTime;

        ITonFarmPool(msg.sender).finishDeposit{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(nonce, _vested);
    }

    function _withdraw(uint128 _amount, uint256[] _accTonPerShare, uint32 poolLastRewardTime, address send_gas_to) internal {
        // bad input. User does not have enough staked balance. At least we can return some gas
        if (_amount > amount) {
            send_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
            return;
        }

        uint128 prevAmount = amount;
        uint128[] prevRewardDebt = rewardDebt;

        amount -= _amount;
        for (uint i = 0; i < _accTonPerShare.length; i++) {
            rewardDebt[i] = uint128(math.muldiv(amount, _accTonPerShare[i], 1e18));
        }

        (
        uint128[] _entitled,
        uint128[] _vested,
        uint32 _lastRewardTime
        ) = _computeVesting(prevAmount, prevRewardDebt, _accTonPerShare, poolLastRewardTime);
        entitled = _entitled;
        lastRewardTime = _lastRewardTime;

        ITonFarmPool(msg.sender).finishWithdraw{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(user, _amount, _vested, send_gas_to);
    }

    function processWithdraw(
        uint128 _amount,
        uint256[] _accTonPerShare,
        uint32 poolLastRewardTime,
        address send_gas_to
    ) public override {
        require (msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 2);

        _withdraw(_amount, _accTonPerShare, poolLastRewardTime, send_gas_to);
    }

    function processWithdrawAll(uint256[] _accTonPerShare, uint32 poolLastRewardTime, address send_gas_to) external override {
        require (msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 2);

        _withdraw(amount, _accTonPerShare, poolLastRewardTime, send_gas_to);
    }

    function processClaimReward(uint256[] _accTonPerShare, uint32 poolLastRewardTime, address send_gas_to) external override {
        require (msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 2);

        _withdraw(0, _accTonPerShare, poolLastRewardTime, send_gas_to);
    }

    function processSafeWithdraw(address send_gas_to) external override {
        require (msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 2);

        uint128 prevAmount = amount;
        amount = 0;
        for (uint i = 0; i < rewardDebt.length; i++) {
            rewardDebt[i] = 0;
        }
        ITonFarmPool(msg.sender).finishSafeWithdraw{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(user, prevAmount, send_gas_to);
    }
}
