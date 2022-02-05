pragma ton-solidity ^0.57.1;
pragma AbiHeader expire;


import "./interfaces/IUserData.sol";
import "./interfaces/ITonFarmPool.sol";
import "./interfaces/IFabric.sol";
import "./TonFarmPoolBase.sol";
import "./UserData.sol";
import "../../node_modules/@broxus/contracts/contracts/libraries/MsgFlag.sol";


contract TonFarmPool is TonFarmPoolBase {
    constructor(
        address _owner,
        RewardRound[] _rewardRounds,
        address _tokenRoot,
        address[] _rewardTokenRoot,
        uint32 _vestingPeriod,
        uint32 _vestingRatio,
        uint32 _withdrawAllLockPeriod
    ) public {
        require (_rewardRounds.length > 0, BAD_REWARD_ROUNDS_INPUT);
        require ((_vestingPeriod == 0 && _vestingRatio == 0) || (_vestingPeriod > 0 && _vestingRatio > 0), BAD_VESTING_SETUP);
        for (uint i = 0; i < _rewardRounds.length; i++) {
            if (i > 0) {
                require(_rewardRounds[i].startTime > _rewardRounds[i - 1].startTime, BAD_REWARD_ROUNDS_INPUT);
            }
            require(_rewardRounds[i].rewardPerSecond.length == _rewardTokenRoot.length, BAD_REWARD_ROUNDS_INPUT);
        }
        require (msg.sender == fabric, NOT_FABRIC);
        tvm.accept();

        rewardRounds = _rewardRounds;
        tokenRoot = _tokenRoot;
        rewardTokenRoot = _rewardTokenRoot;
        owner = _owner;
        vestingRatio = _vestingRatio;
        vestingPeriod = _vestingPeriod;
        withdrawAllLockPeriod = _withdrawAllLockPeriod;

        _initialize_reward_arrays();
        setUpTokenWallets();
        IFabric(fabric).onPoolDeploy{value: FABRIC_DEPLOY_CALLBACK_VALUE}(
            deploy_nonce, _owner, _rewardRounds, _tokenRoot, _rewardTokenRoot, vestingPeriod, vestingRatio, withdrawAllLockPeriod
        );
    }

    function _initialize_reward_arrays() internal {
        for (uint i = 0; i < rewardTokenRoot.length; i++) {
            accTonPerShare.push(0);
            rewardTokenWallet.push(address.makeAddrNone());
            rewardTokenBalance.push(0);
            rewardTokenBalanceCumulative.push(0);
            unclaimedReward.push(0);
        }
    }

    function _reserve() internal pure returns (uint128) {
        return math.max(address(this).balance - msg.value, CONTRACT_MIN_BALANCE);
    }

    function getVersion() external pure returns (uint8, uint8, uint8) {
        return (2, 0, 0);
    }

    function getDetails() external view responsible returns (Details) {
        return { value: 0, bounce: false, flag: MsgFlag.REMAINING_GAS }Details(
            lastRewardTime, farmEndTime, vestingPeriod, vestingRatio, tokenRoot, tokenWallet, tokenBalance,
            rewardRounds, accTonPerShare, rewardTokenRoot, rewardTokenWallet, rewardTokenBalance,
            rewardTokenBalanceCumulative, unclaimedReward, owner, fabric
        );
    }

    /*
        @notice Creates token wallet for configured root token
    */
    function setUpTokenWallets() internal view {
        // Deploy vault's token wallet
        ITokenRoot(tokenRoot).deployWallet{value: TOKEN_WALLET_DEPLOY_VALUE, callback: TonFarmPool.receiveTokenWalletAddress }(
            address(this), // owner
            TOKEN_WALLET_DEPLOY_GRAMS_VALUE // deploy grams
        );

        for (uint i = 0; i < rewardTokenRoot.length; i++) {
            ITokenRoot(rewardTokenRoot[i]).deployWallet{value: TOKEN_WALLET_DEPLOY_VALUE, callback: TonFarmPool.receiveTokenWalletAddress}(
                address(this), // owner address
                TOKEN_WALLET_DEPLOY_GRAMS_VALUE // deploy grams
            );
        }
    }

    function dummy(address user_wallet) external { tvm.rawReserve(_reserve(), 0); }

    /*
        @notice Store vault's token wallet address
        @dev Only root can call with correct params
        @param wallet Farm pool's token wallet
    */
    function receiveTokenWalletAddress(
        address wallet
    ) external {
        tvm.rawReserve(_reserve(), 0);

        if (msg.sender == tokenRoot) {
            tokenWallet = wallet;
        } else {
            for (uint i = 0; i < rewardTokenRoot.length; i++) {
                if (msg.sender == rewardTokenRoot[i]) {
                    rewardTokenWallet[i] = wallet;
                }
            }
        }
    }

    function transferReward(
        address user_data_addr,
        address receiver_addr,
        uint128[] amount,
        address send_gas_to,
        uint32 nonce
    ) internal returns (uint128[] _reward, uint128[] _reward_debt){
        _reward = amount;
        _reward_debt = new uint128[](amount.length);

        // check if we have enough reward, emit debt otherwise
        for (uint i = 0; i < amount.length; i++) {
            if (rewardTokenBalance[i] < amount[i]) {
                _reward_debt[i] = amount[i] - rewardTokenBalance[i];
                _reward[i] -= _reward_debt[i];
            }
        }

        // check if its user or admin
        // for user we emit debt, for admin just claim possible amounts (withdrawUnclaimed)
        if (user_data_addr != address.makeAddrNone()) {
            IUserData(user_data_addr).increasePoolDebt{value: INCREASE_DEBT_VALUE, flag: 0}(_reward_debt, send_gas_to);
        }

        TvmBuilder builder;
        builder.store(nonce);
        for (uint i = 0; i < _reward.length; i++) {
            if (_reward[i] > 0) {
                ITokenWallet(rewardTokenWallet[i]).transfer{value: TOKEN_TRANSFER_VALUE, flag: 0}(
                    _reward[i],
                    receiver_addr,
                    0,
                    send_gas_to,
                    true,
                    builder.toCell()
                );
                rewardTokenBalance[i] -= _reward[i];
            }
        }
        return (_reward, _reward_debt);
    }

    function encodeDepositPayload(address deposit_owner, uint32 nonce) external pure returns (TvmCell deposit_payload) {
        TvmBuilder builder;
        builder.store(deposit_owner);
        builder.store(nonce);
        return builder.toCell();
    }

    // try to decode deposit payload
    function decodeDepositPayload(TvmCell payload) public view returns (address deposit_owner, uint32 nonce, bool correct) {
        // check if payload assembled correctly
        TvmSlice slice = payload.toSlice();
        // 1 address and 1 cell
        if (!slice.hasNBitsAndRefs(267 + 32, 0)) {
            return (address.makeAddrNone(), 0, false);
        }

        deposit_owner = slice.decode(address);
        nonce = slice.decode(uint32);

        return (deposit_owner, nonce, true);
    }

    // deposit occurs here
    function onAcceptTokensTransfer(
        address tokenRoot,
        uint128 amount,
        address sender,
        address senderWallet,
        address remainingGasTo,
        TvmCell payload
    ) external override {
        tvm.rawReserve(_reserve(), 0);

        if (msg.sender == tokenWallet) {
            // check if payload assembled correctly
            (address deposit_owner, uint32 nonce, bool correct) = decodeDepositPayload(payload);

            if (!correct || msg.value < (MIN_DEPOSIT_MSG_VALUE + TOKEN_TRANSFER_VALUE * rewardTokenRoot.length)) {
                // too low deposit value or too low msg.value or incorrect deposit payload
                // for incorrect deposit payload send tokens back to sender
                ITokenWallet(tokenWallet).transfer{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(
                    amount,
                    sender,
                    0,
                    remainingGasTo,
                    true,
                    payload
                );
                return;
            }

            updatePoolInfo();

            deposit_nonce += 1;
            tokenBalance += amount;

            deposits[deposit_nonce] = PendingDeposit(deposit_owner, amount, remainingGasTo, nonce);

            address userDataAddr = getUserDataAddress(deposit_owner);
            IUserData(userDataAddr).processDeposit{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(deposit_nonce, amount, accTonPerShare, lastRewardTime, farmEndTime);
        } else {
            for (uint i = 0; i < rewardTokenWallet.length; i++) {
                if (msg.sender == rewardTokenWallet[i]) {
                    rewardTokenBalance[i] += amount;
                    rewardTokenBalanceCumulative[i] += amount;

                    emit RewardDeposit(rewardTokenRoot[i], amount);
                }
            }
            remainingGasTo.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
            return;
        }
    }

    function finishDeposit(uint64 _deposit_nonce, uint128[] _vested) external override {
        PendingDeposit deposit = deposits[_deposit_nonce];
        address expectedAddr = getUserDataAddress(deposit.user);
        require (expectedAddr == msg.sender, NOT_USER_DATA);

        tvm.rawReserve(_reserve(), 0);

        (
            uint128[] _reward,
            uint128[] _reward_debt
        ) = transferReward(expectedAddr, deposit.user, _vested, deposit.send_gas_to, deposit.nonce);

        emit Deposit(deposit.user, deposit.amount, _reward, _reward_debt);
        delete deposits[_deposit_nonce];

        deposit.send_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
    }

    function withdraw(uint128 amount, address send_gas_to, uint32 nonce) public {
        require (amount > 0, ZERO_AMOUNT_INPUT);
        require (msg.value >= MIN_WITHDRAW_MSG_VALUE + TOKEN_TRANSFER_VALUE * rewardTokenRoot.length, LOW_WITHDRAW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 0);

        updatePoolInfo();

        address userDataAddr = getUserDataAddress(msg.sender);
        // we cant check if user has any balance here, delegate it to UserData
        IUserData(userDataAddr).processWithdraw{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(amount, accTonPerShare, lastRewardTime, farmEndTime, send_gas_to, nonce);
    }

    function withdrawAll(address send_gas_to, uint32 nonce) public {
        require (msg.value >= MIN_WITHDRAW_MSG_VALUE + TOKEN_TRANSFER_VALUE * rewardTokenRoot.length, LOW_WITHDRAW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 0);

        updatePoolInfo();

        address userDataAddr = getUserDataAddress(msg.sender);
        // we cant check if user has any balance here, delegate it to UserData
        IUserData(userDataAddr).processWithdrawAll{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(accTonPerShare, lastRewardTime, farmEndTime, send_gas_to, nonce);
    }

    function claimReward(address send_gas_to, uint32 nonce) public {
        require (msg.value >= MIN_CLAIM_REWARD_MSG_VALUE + TOKEN_TRANSFER_VALUE * rewardTokenRoot.length, LOW_WITHDRAW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 0);

        updatePoolInfo();

        address userDataAddr = getUserDataAddress(msg.sender);
        // we cant check if user has any balance here, delegate it to UserData
        IUserData(userDataAddr).processClaimReward{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(accTonPerShare, lastRewardTime, farmEndTime, send_gas_to, nonce);
    }

    function finishWithdraw(
        address user,
        uint128 _withdrawAmount,
        uint128[] _vested,
        address send_gas_to,
        uint32 nonce
    ) public override {
        address expectedAddr = getUserDataAddress(user);
        require (expectedAddr == msg.sender, NOT_USER_DATA);
        tvm.rawReserve(_reserve(), 0);

        (
        uint128[] _reward,
        uint128[] _reward_debt
        ) = transferReward(expectedAddr, user, _vested, send_gas_to, nonce);

        // withdraw is called
        if (_withdrawAmount > 0) {
            tokenBalance -= _withdrawAmount;

            emit Withdraw(user, _withdrawAmount, _reward, _reward_debt);
            TvmBuilder builder;
            builder.store(nonce);
            ITokenWallet(tokenWallet).transfer{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(
                _withdrawAmount,
                user,
                0,
                send_gas_to,
                true,
                builder.toCell()
            );
        // claim is called
        } else {
            emit Claim(user, _reward, _reward_debt);
            send_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
        }
    }

    function withdrawUnclaimed(address to, address send_gas_to, uint32 nonce) external onlyOwner {
        require (msg.value >= MIN_CLAIM_REWARD_MSG_VALUE + TOKEN_TRANSFER_VALUE * rewardTokenRoot.length, LOW_WITHDRAW_MSG_VALUE);
        // minimum value that should remain on contract
        tvm.rawReserve(_reserve(), 0);

        transferReward(address.makeAddrNone(), to, unclaimedReward, send_gas_to, nonce);
        for (uint i = 0; i < unclaimedReward.length; i++) {
            unclaimedReward[i] = 0;
        }

        send_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
    }

    function withdrawUnclaimedAll(address to, address send_gas_to, uint32 nonce) external onlyOwner {
        require (msg.value >= MIN_CLAIM_REWARD_MSG_VALUE + TOKEN_TRANSFER_VALUE * rewardTokenRoot.length, LOW_WITHDRAW_MSG_VALUE);
        require (farmEndTime > 0, CANT_WITHDRAW_UNCLAIMED_ALL);
        require (now >= farmEndTime + vestingPeriod + withdrawAllLockPeriod, CANT_WITHDRAW_UNCLAIMED_ALL);
        // minimum value that should remain on contract
        tvm.rawReserve(_reserve(), 0);

        transferReward(address.makeAddrNone(), to, rewardTokenBalance, send_gas_to, nonce);
        for (uint i = 0; i < unclaimedReward.length; i++) {
            unclaimedReward[i] = 0;
        }

        send_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
    }

    function addRewardRound(RewardRound reward_round, address send_gas_to) external onlyOwner {
        require (msg.value >= ADD_REWARD_ROUND_VALUE);
        require (reward_round.startTime >= now, BAD_REWARD_ROUNDS_INPUT);
        require (reward_round.startTime >= rewardRounds[rewardRounds.length - 1].startTime, BAD_REWARD_ROUNDS_INPUT);
        require (reward_round.rewardPerSecond.length == rewardTokenRoot.length, BAD_REWARD_ROUNDS_INPUT);
        require (farmEndTime == 0, BAD_REWARD_ROUNDS_INPUT);

        tvm.rawReserve(_reserve(), 0);
        rewardRounds.push(reward_round);
        emit RewardRoundAdded(reward_round);
        send_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
    }

    function setEndTime(uint32 farm_end_time, address send_gas_to) external onlyOwner {
        require (msg.value >= SET_END_TIME_VALUE);
        require (farm_end_time >= now, BAD_FARM_END_TIME);
        require (farm_end_time >= rewardRounds[rewardRounds.length - 1].startTime, BAD_FARM_END_TIME);
        require (farmEndTime == 0, BAD_FARM_END_TIME);

        tvm.rawReserve(_reserve(), 0);
        farmEndTime = farm_end_time;
        emit farmEndSet(farm_end_time);
        send_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
    }

    // withdraw all staked tokens without reward in case of some critical logic error / insufficient tons on FarmPool balance
    function safeWithdraw(address send_gas_to) external view {
        require (msg.value >= MIN_WITHDRAW_MSG_VALUE, LOW_WITHDRAW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 0);

        address user_data_addr = getUserDataAddress(msg.sender);
        IUserData(user_data_addr).processSafeWithdraw{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(send_gas_to);
    }

    function finishSafeWithdraw(address user, uint128 amount, address send_gas_to) external override {
        address expectedAddr = getUserDataAddress(user);
        require (expectedAddr == msg.sender, NOT_USER_DATA);
        tvm.rawReserve(_reserve(), 0);

        tokenBalance -= amount;

        uint128[] _reward;
        uint128[] _reward_debt;

        TvmCell tvmcell;
        emit Withdraw(user, amount, _reward, _reward_debt);

        ITokenWallet(tokenWallet).transfer{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(
            amount,
            user,
            0,
            send_gas_to,
            true,
            tvmcell
        );
    }

    function _getMultiplier(uint32 _farmStartTime, uint32 _farmEndTime, uint32 from, uint32 to) internal view returns(uint32) {
        require (from <= to, WRONG_INTERVAL);

        if ((from > _farmEndTime) || (to < _farmStartTime)) {
            return 0;
        }

        if (to > _farmEndTime) {
            to = _farmEndTime;
        }

        if (from < _farmStartTime) {
            from = _farmStartTime;
        }

        return to - from;
    }

    function _getRoundEndTime(uint256 round_idx) internal view returns (uint32) {
        bool last_round = round_idx == rewardRounds.length - 1;
        uint32 _farmEndTime;
        if (last_round) {
            // if this round is last, check if end is setup and return it, otherwise return max uint value
            _farmEndTime = farmEndTime > 0 ? farmEndTime : MAX_UINT32;
        } else {
            // next round exists, its start time is this round's end time
            _farmEndTime = rewardRounds[round_idx + 1].startTime;
        }
        return _farmEndTime;
    }

    function calculateRewardData() public view returns (uint32 _lastRewardTime, uint256[] _accTonPerShare, uint128[] _unclaimedReward) {
        _lastRewardTime = lastRewardTime;
        _accTonPerShare = accTonPerShare;
        _unclaimedReward = unclaimedReward;

        uint32 first_round_start = rewardRounds[0].startTime;

        // reward rounds still not started, nothing to calculate
        if (now < first_round_start) {
            _lastRewardTime = now;
            return (_lastRewardTime, _accTonPerShare, _unclaimedReward);
        }

        if (now > _lastRewardTime) {
            // special case - last update occurred before start of 1st round
            if (_lastRewardTime < first_round_start) {
                _lastRewardTime = math.min(first_round_start, now);
            }

            for (uint i = rewardRounds.length - 1; i >= 0; i--) {
                // find reward round when last update occurred
                if (_lastRewardTime >= rewardRounds[i].startTime) {
                    // we found reward round when last update occurred, start updating reward from this point
                    for (uint j = i; j < rewardRounds.length; j++) {
                        // we didnt reach this round
                        if (now <= rewardRounds[j].startTime) {
                            break;
                        }
                        uint32 _roundEndTime = _getRoundEndTime(j);
                        // get multiplier bounded by this reward round
                        uint32 multiplier = _getMultiplier(rewardRounds[j].startTime, _roundEndTime, _lastRewardTime, now);
                        uint128[] new_reward;
                        for (uint k = 0; k < rewardRounds[j].rewardPerSecond.length; k++) {
                            new_reward.push(rewardRounds[j].rewardPerSecond[k] * multiplier);
                        }
                        uint32 new_reward_time;
                        if (_roundEndTime == farmEndTime) {
                            new_reward_time = now;
                        } else {
                            new_reward_time = math.min(_roundEndTime, now);
                        }

                        if (tokenBalance == 0) {
                            for (uint k = 0; k < rewardRounds[j].rewardPerSecond.length; k++) {
                                _unclaimedReward[k] += new_reward[k];
                            }
                            _lastRewardTime = new_reward_time;
                            continue;
                        }

                        for (uint k = 0; k < rewardRounds[j].rewardPerSecond.length; k++) {
                            uint256 scaled_reward = uint256(new_reward[k]) * SCALING_FACTOR;
                            _accTonPerShare[k] += scaled_reward / tokenBalance;
                        }
                        _lastRewardTime = new_reward_time;
                    }
                    break;
                }
                if (i == 0) {
                    // break to avoid integer overflow
                    break;
                }
            }
        }
        return (_lastRewardTime, _accTonPerShare, _unclaimedReward);
    }

    function updatePoolInfo() internal {
        (uint32 _lastRewardTime, uint256[] _accTonPerShare, uint128[] _unclaimedReward) = calculateRewardData();
        lastRewardTime = _lastRewardTime;
        accTonPerShare = _accTonPerShare;
        unclaimedReward = _unclaimedReward;
    }

    function deployUserData(address _user) internal returns (address) {
        TvmCell stateInit = tvm.buildStateInit({
            contr: UserData,
            varInit: { user: _user, farmPool: address(this) },
            pubkey: tvm.pubkey(),
            code: userDataCode
        });

        return new UserData{
            stateInit: stateInit,
            value: USER_DATA_DEPLOY_VALUE,
            wid: address(this).wid,
            flag: 1
        }(uint8(rewardTokenRoot.length), vestingPeriod, vestingRatio);
    }

    function getUserDataAddress(address _user) public view returns (address) {
        TvmCell stateInit = tvm.buildStateInit({
            contr: UserData,
            varInit: { user: _user, farmPool: address(this) },
            pubkey: tvm.pubkey(),
            code: userDataCode
        });
        return address(tvm.hash(stateInit));
    }

    onBounce(TvmSlice slice) external {
        tvm.accept();

        uint32 functionId = slice.decode(uint32);
        // if processing failed - contract was not deployed. Deploy and try again
        if (functionId == tvm.functionId(UserData.processDeposit)) {
            tvm.rawReserve(_reserve(), 0);

            uint64 _deposit_nonce = slice.decode(uint64);
            PendingDeposit deposit = deposits[_deposit_nonce];
            address user_data_addr = deployUserData(deposit.user);
            for (uint i = 0; i < rewardTokenRoot.length; i++) {
                // user first deposit? try deploy wallet for him
                ITokenRoot(rewardTokenRoot[i]).deployWallet{value: TOKEN_WALLET_DEPLOY_VALUE, callback: TonFarmPool.dummy}(
                    deposit.user,
                    TOKEN_WALLET_DEPLOY_GRAMS_VALUE // deploy grams
                );
            }
            // try again
            IUserData(user_data_addr).processDeposit{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(_deposit_nonce, deposit.amount, accTonPerShare, lastRewardTime, farmEndTime);

        }
    }

    modifier onlyOwner() {
        require(msg.sender == owner, NOT_OWNER);
        _;
    }
}
