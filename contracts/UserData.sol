pragma ton-solidity ^0.57.1;
pragma AbiHeader expire;

import "./interfaces/ITonFarmPool.sol";
import "./interfaces/IUserData.sol";
import "@broxus/contracts/contracts/libraries/MsgFlag.sol";


contract UserData is IUserData {
    uint32 current_version;
    TvmCell platform_code;

    uint32 lastRewardTime;
    uint32 vestingPeriod;
    // number from 0 to 1000 (0% to 100%). 0 means vesting is disabled
    uint32 vestingRatio;
    uint32 vestingTime;

    uint128 amount;
    uint128[] rewardDebt;
    uint128[] entitled;
    uint128[] pool_debt;
    address farmPool;
    address user; // setup from initData
    uint8 constant NOT_FARM_POOL = 101;
    uint128 constant CONTRACT_MIN_BALANCE = 0.1 ton;
    uint32 constant MAX_VESTING_RATIO = 1000;
    uint256 constant SCALING_FACTOR = 1e18;

    // Cant be deployed directly
    constructor() public { revert(); }

    // should be called in onCodeUpgrade on platform initialization
    function _init(uint8 reward_tokens_count, uint32 _vestingPeriod, uint32 _vestingRatio) internal {
        require (farmPool == msg.sender, NOT_FARM_POOL);
        for (uint i = 0; i < reward_tokens_count; i++) {
            rewardDebt.push(0);
            entitled.push(0);
            pool_debt.push(0);
        }
        vestingPeriod = _vestingPeriod;
        vestingRatio = _vestingRatio;
    }

    function _reserve() internal pure returns (uint128) {
        return math.max(address(this).balance - msg.value, CONTRACT_MIN_BALANCE);
    }

    function getDetails() external responsible view override returns (UserDataDetails) {
        return { value: 0, bounce: false, flag: MsgFlag.REMAINING_GAS }UserDataDetails(
            pool_debt, entitled, vestingTime, amount, rewardDebt, farmPool, user, current_version
        );
    }

    // user_amount and user_reward_debt should be fetched from UserData at first
    function pendingReward(
        uint256[] _accTonPerShare,
        uint32 poolLastRewardTime,
        uint32 farmEndTime
    ) external view returns (uint128[] _entitled, uint128[] _vested, uint128[] _pool_debt, uint32 _vesting_time) {
        (
            _entitled,
            _vested,
            _vesting_time
        ) = _computeVesting(amount, rewardDebt, _accTonPerShare, poolLastRewardTime, farmEndTime);

        return (_entitled, _vested, pool_debt, _vesting_time);
    }

    function _isEven(uint64 num) internal pure returns (bool) {
        return (num / 2) == 0 ? true : false;
    }

    function _rangeSum(uint64 range) internal pure returns (uint64) {
        if (_isEven(range)) {
            return (range / 2) * range + (range / 2);
        }
        return ((range / 2) + 1) * range;
    }

    // interval should be less than max
    function _rangeIntervalAverage(uint32 interval, uint32 max) internal pure returns (uint256) {
        return (_rangeSum(uint64(interval)) * SCALING_FACTOR) / max;
    }

    // only applied if _interval is bigger than vestingPeriod, will throw integer overflow otherwise
    function _computeVestedForInterval(uint128 _entitled, uint32 _interval) internal view returns (uint128, uint128) {
        uint32 periods_passed = ((_interval / vestingPeriod) - 1);
        uint32 full_vested_part = periods_passed * vestingPeriod + _interval % vestingPeriod;
        uint32 partly_vested_part = _interval - full_vested_part;

        // get part of entitled reward that already vested, because their vesting period is passed
        uint128 clear_part_1 = uint128((((full_vested_part * SCALING_FACTOR) / _interval) * _entitled) / SCALING_FACTOR);
        uint128 vested_part = _entitled - clear_part_1;

        // now calculate vested share of remaining part
        uint256 clear_part_2_share = _rangeIntervalAverage(partly_vested_part, vestingPeriod) / partly_vested_part;
        uint128 clear_part_2 = uint128(vested_part * clear_part_2_share / SCALING_FACTOR);
        uint128 remaining_entitled = vested_part - clear_part_2;

        return (clear_part_1 + clear_part_2, remaining_entitled);
    }

    // this is used only when lastRewardTime < farmEndTime, because newly entitled reward not emitted otherwise
    // will throw with integer overflow otherwise
    function _computeVestedForNewlyEntitled(uint128 _entitled, uint32 _poolLastRewardTime, uint32 _farmEndTime) internal view returns (uint128 _vested) {
        if (_entitled == 0) {
            return 0;
        }
        if (_farmEndTime == 0 || _poolLastRewardTime < _farmEndTime) {
            uint32 age = _poolLastRewardTime - lastRewardTime;

            if (age > vestingPeriod) {
                (uint128 _vested_part, uint128 _) = _computeVestedForInterval(_entitled, age);
                return _vested_part;
            } else {
                uint256 clear_part_share = _rangeIntervalAverage(age, vestingPeriod) / age;
                return uint128(_entitled * clear_part_share / SCALING_FACTOR);
            }
        } else {
            uint32 age_before = _farmEndTime - lastRewardTime;
            uint32 age_after = math.min(_poolLastRewardTime - _farmEndTime, vestingPeriod);

            uint128 _vested_before;
            uint128 _entitled_before;
            if (age_before > vestingPeriod) {
                (_vested_before, _entitled_before) = _computeVestedForInterval(_entitled, age_before);
            } else {
                uint256 clear_part_share = _rangeIntervalAverage(age_before, vestingPeriod) / age_before;
                _vested_before = uint128(_entitled * clear_part_share / SCALING_FACTOR);
                _entitled_before = _entitled - _vested_before;
            }

            uint128 _vested_after = _entitled_before * age_after / vestingPeriod;
            return (_vested_before + _vested_after);
        }
    }

    function _computeVesting(
        uint128 _amount,
        uint128[] _rewardDebt,
        uint256[] _accTonPerShare,
        uint32 _poolLastRewardTime,
        uint32 _farmEndTime
    ) internal view returns (uint128[], uint128[], uint32) {
        uint32 new_vesting_time;
        uint128[] newly_vested = new uint128[](_rewardDebt.length);
        uint128[] updated_entitled = new uint128[](_rewardDebt.length);
        uint128[] new_entitled = new uint128[](_rewardDebt.length);

        for (uint i = 0; i < _rewardDebt.length; i++) {
            uint256 _reward = uint256(_amount) * _accTonPerShare[i];
            new_entitled[i] = uint128(_reward / SCALING_FACTOR) - _rewardDebt[i];
            if (vestingRatio > 0) {
                // calc which part should be payed immediately and with vesting from new reward
                uint128 vesting_part = (new_entitled[i] * vestingRatio) / MAX_VESTING_RATIO;
                uint128 clear_part = new_entitled[i] - vesting_part;

                if (lastRewardTime < _farmEndTime || _farmEndTime == 0) {
                    newly_vested[i] = _computeVestedForNewlyEntitled(vesting_part, _poolLastRewardTime, _farmEndTime);
                } else {
                    // no new entitled rewards after farm end, nothing to compute
                    newly_vested[i] = 0;
                }

                // now calculate newly vested part of old entitled reward
                uint32 age2 = _poolLastRewardTime >= vestingTime ? vestingPeriod : _poolLastRewardTime - lastRewardTime;
                uint256 _vested = uint256(entitled[i]) * age2;
                uint128 to_vest = age2 >= vestingPeriod
                    ? entitled[i]
                    : uint128(_vested / (vestingTime - lastRewardTime));

                // amount of reward vested from now
                uint128 remainingEntitled = entitled[i] == 0 ? 0 : entitled[i] - to_vest;
                uint128 unreleasedNewly = vesting_part - newly_vested[i];
                uint128 pending = remainingEntitled + unreleasedNewly;

                // Compute the vesting time (i.e. when the entitled reward to be all vested)
                if (pending == 0) {
                    new_vesting_time = _poolLastRewardTime;
                } else if (remainingEntitled == 0) {
                    // only new reward, set vesting time to vesting period
                    new_vesting_time = _poolLastRewardTime + vestingPeriod;
                } else if (unreleasedNewly == 0) {
                    // only unlocking old reward, dont change vesting time
                    new_vesting_time = vestingTime;
                } else {
                    // "old" reward and, perhaps, "new" reward are pending - the weighted average applied
                    uint32 age3 = vestingTime - _poolLastRewardTime;
                    uint32 period = uint32(((remainingEntitled * age3) + (unreleasedNewly * vestingPeriod)) / pending);
                    new_vesting_time = _poolLastRewardTime + math.min(period, vestingPeriod);
                }

                new_vesting_time = _farmEndTime > 0 ? math.min(_farmEndTime + vestingPeriod, new_vesting_time) : new_vesting_time;
                updated_entitled[i] = entitled[i] + vesting_part - to_vest - newly_vested[i];
                newly_vested[i] += to_vest + clear_part;
            } else {
                newly_vested[i] = new_entitled[i];
            }
        }

        return (updated_entitled, newly_vested, new_vesting_time);
    }

    function increasePoolDebt(uint128[] _pool_debt, address send_gas_to, uint32 code_version) external override {
        require(msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 0);

        for (uint i = 0; i < _pool_debt.length; i++) {
            pool_debt[i] += _pool_debt[i];
        }

        send_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
    }

    function processDeposit(uint64 nonce, uint128 _amount, uint256[] _accTonPerShare, uint32 poolLastRewardTime, uint32 farmEndTime, uint32 code_version) external override {
        require(msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 0);

        uint128 prevAmount = amount;
        uint128[] prevRewardDebt = rewardDebt;

        amount += _amount;
        for (uint i = 0; i < rewardDebt.length; i++) {
            uint256 _reward = amount * _accTonPerShare[i];
            rewardDebt[i] = uint128(_reward / SCALING_FACTOR);
        }

        (
            uint128[] _entitled,
            uint128[] _vested,
            uint32 _vestingTime
        ) = _computeVesting(prevAmount, prevRewardDebt, _accTonPerShare, poolLastRewardTime, farmEndTime);
        entitled = _entitled;
        vestingTime = _vestingTime;
        lastRewardTime = poolLastRewardTime;

        for (uint i = 0; i < _vested.length; i++) {
            _vested[i] += pool_debt[i];
            pool_debt[i] = 0;
        }

        ITonFarmPool(msg.sender).finishDeposit{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(nonce, _vested);
    }

    function _withdraw(uint128 _amount, uint256[] _accTonPerShare, uint32 poolLastRewardTime, uint32 farmEndTime, address send_gas_to, uint32 nonce) internal {
        // bad input. User does not have enough staked balance. At least we can return some gas
        if (_amount > amount) {
            send_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
            return;
        }

        uint128 prevAmount = amount;
        uint128[] prevRewardDebt = rewardDebt;

        amount -= _amount;
        for (uint i = 0; i < _accTonPerShare.length; i++) {
            uint256 _reward = amount * _accTonPerShare[i];
            rewardDebt[i] = uint128(_reward / SCALING_FACTOR);
        }

        (
            uint128[] _entitled,
            uint128[] _vested,
            uint32 _vestingTime
        ) = _computeVesting(prevAmount, prevRewardDebt, _accTonPerShare, poolLastRewardTime, farmEndTime);
        entitled = _entitled;
        vestingTime = _vestingTime;
        lastRewardTime = poolLastRewardTime;

        for (uint i = 0; i < _vested.length; i++) {
            _vested[i] += pool_debt[i];
            pool_debt[i] = 0;
        }

        ITonFarmPool(msg.sender).finishWithdraw{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(user, _amount, _vested, send_gas_to, nonce);
    }

    function processWithdraw(
        uint128 _amount,
        uint256[] _accTonPerShare,
        uint32 poolLastRewardTime,
        uint32 farmEndTime,
        address send_gas_to,
        uint32 nonce,
        uint32 code_version
    ) public override {
        require (msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 0);

        _withdraw(_amount, _accTonPerShare, poolLastRewardTime, farmEndTime, send_gas_to, nonce);
    }

    function processWithdrawAll(uint256[] _accTonPerShare, uint32 poolLastRewardTime, uint32 farmEndTime, address send_gas_to, uint32 nonce, uint32 code_version) external override {
        require (msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 0);

        _withdraw(amount, _accTonPerShare, poolLastRewardTime, farmEndTime, send_gas_to, nonce);
    }

    function processClaimReward(uint256[] _accTonPerShare, uint32 poolLastRewardTime, uint32 farmEndTime, address send_gas_to, uint32 nonce, uint32 code_version) external override {
        require (msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 0);

        _withdraw(0, _accTonPerShare, poolLastRewardTime, farmEndTime, send_gas_to, nonce);
    }

    function processSafeWithdraw(address send_gas_to, uint32 code_version) external override {
        require (msg.sender == farmPool, NOT_FARM_POOL);
        tvm.rawReserve(_reserve(), 0);

        uint128 prevAmount = amount;
        amount = 0;
        for (uint i = 0; i < rewardDebt.length; i++) {
            rewardDebt[i] = 0;
        }
        ITonFarmPool(msg.sender).finishSafeWithdraw{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(user, prevAmount, send_gas_to);
    }

    function upgrade(TvmCell new_code, uint32 new_version, address send_gas_to) external virtual override {
        require (msg.sender == farmPool, NOT_FARM_POOL);

        if (new_version == current_version) {
            tvm.rawReserve(_reserve(), 0);
            send_gas_to.transfer({ value: 0, bounce: false, flag: MsgFlag.ALL_NOT_RESERVED });
            return;
        }

        TvmBuilder main_builder;
        main_builder.store(farmPool);
        main_builder.store(uint8(0));
        main_builder.store(send_gas_to);

        main_builder.store(platform_code);

        TvmBuilder initial_data;
        initial_data.store(user);

        TvmBuilder params;
        params.store(new_version);
        params.store(current_version);

        main_builder.storeRef(initial_data);
        main_builder.storeRef(params);

        TvmBuilder data_builder;
        data_builder.store(lastRewardTime); // 32
        data_builder.store(vestingPeriod); // 32
        data_builder.store(vestingRatio); // 32
        data_builder.store(vestingTime); // 32
        data_builder.store(amount); // 128
        data_builder.store(rewardDebt); // 33 + ref
        data_builder.store(entitled); // 33 + ref
        data_builder.store(pool_debt); // 33 + ref

        main_builder.storeRef(data_builder);

        // set code after complete this method
        tvm.setcode(new_code);

        // run onCodeUpgrade from new code
        tvm.setCurrentCode(new_code);
        onCodeUpgrade(main_builder.toCell());
    }

    function onCodeUpgrade(TvmCell upgrade_data) private {
        tvm.resetStorage();
        tvm.rawReserve(_reserve(), 0);

        TvmSlice s = upgrade_data.toSlice();
        (address root_, , address send_gas_to) = s.decode(address, uint8, address);
        farmPool = root_;

        platform_code = s.loadRef();

        TvmSlice initialData = s.loadRefAsSlice();
        user = initialData.decode(address);

        TvmSlice params = s.loadRefAsSlice();
        (current_version, ) = params.decode(uint32, uint32);

        (uint8 tokens_num, uint32 _vestingPeriod, uint32 _vestingRatio) = params.decode(uint8, uint32, uint32);

        _init(tokens_num, _vestingPeriod, _vestingRatio);

        send_gas_to.transfer({ value: 0, bounce: false, flag: MsgFlag.ALL_NOT_RESERVED });
    }

}
