pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;

import "./interfaces/IRootTokenContract.sol";
import "./interfaces/ITONTokenWallet.sol";
import "./interfaces/ITokensReceivedCallback.sol";
import "./interfaces/IUserData.sol";
import "./interfaces/ITonFarmPool.sol";
import "./interfaces/IFabric.sol";
import "./TonFarmPoolBase.sol";
import "./UserData.sol";
import "../../node_modules/@broxus/contracts/contracts/libraries/MsgFlag.sol";


contract TonFarmPool is ITokensReceivedCallback, TonFarmPoolBase {
    constructor(
        address _owner,
        RewardRound[] _rewardRounds,
        address _tokenRoot,
        address[] _rewardTokenRoot,
        uint32 _vestingPeriod,
        uint32 _vestingRatio
    ) public {
        require (_rewardRounds.length > 0, BAD_REWARD_ROUNDS_INPUT);
        require ((_vestingPeriod == 0 && _vestingRatio == 0) || (_vestingPeriod > 0 && _vestingRatio > 0), BAD_VESTING_SETUP);
        for (uint i = 0; i < _rewardRounds.length; i++) {
            require(_rewardRounds[i].rewardPerSecond.length == _rewardTokenRoot.length, BAD_REWARD_TOKENS_INPUT);
        }
        require (msg.sender == fabric, NOT_FABRIC);
        tvm.accept();

        rewardRounds = _rewardRounds;
        tokenRoot = _tokenRoot;
        rewardTokenRoot = _rewardTokenRoot;
        owner = _owner;
        vestingRatio = _vestingRatio;
        vestingPeriod = _vestingPeriod;

        _initialize_reward_arrays();
        setUpTokenWallets();
        IFabric(fabric).onPoolDeploy{value: FABRIC_DEPLOY_CALLBACK_VALUE}(
            deploy_nonce, _owner, _rewardRounds, _tokenRoot, _rewardTokenRoot, vestingPeriod, vestingRatio
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
        return Details(
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
        IRootTokenContract(tokenRoot).deployEmptyWallet{value: TOKEN_WALLET_DEPLOY_VALUE}(
            TOKEN_WALLET_DEPLOY_GRAMS_VALUE, // deploy grams
            0, // owner pubkey
            address(this), // owner address
            address(this) // gas refund address
        );

        // Request for token wallet address
        IRootTokenContract(tokenRoot).getWalletAddress{
            value: GET_WALLET_ADDRESS_VALUE, callback: TonFarmPool.receiveTokenWalletAddress
        }(0, address(this));

        for (uint i = 0; i < rewardTokenRoot.length; i++) {
            IRootTokenContract(rewardTokenRoot[i]).deployEmptyWallet{value: TOKEN_WALLET_DEPLOY_VALUE}(
                TOKEN_WALLET_DEPLOY_GRAMS_VALUE, // deploy grams
                0, // owner pubkey
                address(this), // owner address
                address(this) // gas refund address
            );

            // Request for token wallet address
            IRootTokenContract(rewardTokenRoot[i]).getWalletAddress{
                value: GET_WALLET_ADDRESS_VALUE, callback: TonFarmPool.receiveTokenWalletAddress
            }(0, address(this));
        }
    }

    /*
        @notice Store vault's token wallet address
        @dev Only root can call with correct params
        @param wallet Farm pool's token wallet
    */
    function receiveTokenWalletAddress(
        address wallet
    ) external {
        if (msg.sender == tokenRoot) {
            tokenWallet = wallet;
            ITONTokenWallet(wallet).setReceiveCallback{value: 0.05 ton}(address(this), false);
        } else {
            for (uint i = 0; i < rewardTokenRoot.length; i++) {
                if (msg.sender == rewardTokenRoot[i]) {
                    rewardTokenWallet[i] = wallet;
                    ITONTokenWallet(wallet).setReceiveCallback{value: 0.05 ton}(address(this), false);
                }
            }
        }
    }

    function transferReward(address receiver_addr, uint128[] amount, TvmCell payload) internal {
        for (uint i = 0; i < amount.length; i++) {
            uint128 _amount = math.min(rewardTokenBalance[i], amount[i]);
            if (_amount > 0) {
                ITONTokenWallet(rewardTokenWallet[i]).transferToRecipient{value: TOKEN_TRANSFER_VALUE, flag: 0}(
                    0,
                    receiver_addr,
                    _amount,
                    0,
                    0,
                    receiver_addr,
                    true,
                    payload
                );
                rewardTokenBalance[i] -= _amount;
            }
        }
    }

    // deposit occurs here
    function tokensReceivedCallback(
        address token_wallet,
        address token_root,
        uint128 amount,
        uint256 sender_public_key,
        address sender_address,
        address sender_wallet,
        address original_gas_to,
        uint128 updated_balance,
        TvmCell payload
    ) external override {
        tvm.rawReserve(_reserve(), 2);

        if (msg.sender == tokenWallet) {
            if (sender_address.value == 0 || msg.value < (MIN_DEPOSIT_MSG_VALUE + TOKEN_TRANSFER_VALUE * rewardTokenRoot.length)) {
                // external owner or too low deposit value or too low msg.value
                TvmCell tvmcell;
                ITONTokenWallet(tokenWallet).transfer{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(
                    sender_wallet,
                    amount,
                    0,
                    original_gas_to,
                    false,
                    tvmcell
                );
                return;
            }

            updatePoolInfo();

            deposit_nonce += 1;
            tokenBalance += amount;

            deposits[deposit_nonce] = PendingDeposit(sender_address, amount, original_gas_to, payload);

            address userDataAddr = getUserDataAddress(sender_address);
            IUserData(userDataAddr).processDeposit{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(deposit_nonce, amount, accTonPerShare, lastRewardTime);
        } else {
            for (uint i = 0; i < rewardTokenWallet.length; i++) {
                if (msg.sender == rewardTokenWallet[i]) {
                    rewardTokenBalance[i] += amount;
                    rewardTokenBalanceCumulative[i] += amount;

                    emit RewardDeposit(rewardTokenRoot[i], amount);
                }
            }
            original_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
            return;
        }
    }

    function finishDeposit(uint64 _deposit_nonce, uint128[] _vested) external override {
        PendingDeposit deposit = deposits[_deposit_nonce];
        address expectedAddr = getUserDataAddress(deposit.user);
        require (expectedAddr == msg.sender, NOT_USER_DATA);

        tvm.rawReserve(_reserve(), 2);

        transferReward(deposit.user, _vested, deposit.callback_payload);
        emit Reward(deposit.user, _vested);

        emit Deposit(deposit.user, deposit.amount);
        delete deposits[_deposit_nonce];

        deposit.send_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
    }

    function withdraw(uint128 amount, address send_gas_to, TvmCell callback_payload) public {
        require (msg.sender.value != 0, EXTERNAL_CALL);
        require (amount > 0, ZERO_AMOUNT_INPUT);
        require (msg.value >= MIN_WITHDRAW_MSG_VALUE + TOKEN_TRANSFER_VALUE * rewardTokenRoot.length, LOW_WITHDRAW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 2);

        updatePoolInfo();

        address userDataAddr = getUserDataAddress(msg.sender);
        // we cant check if user has any balance here, delegate it to UserData
        IUserData(userDataAddr).processWithdraw{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(amount, accTonPerShare, lastRewardTime, send_gas_to, callback_payload);
    }

    function withdrawAll(TvmCell callback_payload) public {
        require (msg.sender.value != 0, EXTERNAL_CALL);
        require (msg.value >= MIN_WITHDRAW_MSG_VALUE + TOKEN_TRANSFER_VALUE * rewardTokenRoot.length, LOW_WITHDRAW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 2);

        updatePoolInfo();

        address userDataAddr = getUserDataAddress(msg.sender);
        // we cant check if user has any balance here, delegate it to UserData
        IUserData(userDataAddr).processWithdrawAll{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(accTonPerShare, lastRewardTime, msg.sender, callback_payload);
    }

    function claimReward(TvmCell callback_payload) public {
        require (msg.sender.value != 0, EXTERNAL_CALL);
        require (msg.value >= MIN_CLAIM_REWARD_MSG_VALUE + TOKEN_TRANSFER_VALUE * rewardTokenRoot.length, LOW_WITHDRAW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 2);

        updatePoolInfo();

        address userDataAddr = getUserDataAddress(msg.sender);
        // we cant check if user has any balance here, delegate it to UserData
        IUserData(userDataAddr).processClaimReward{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(accTonPerShare, lastRewardTime, msg.sender, callback_payload);
    }

    function finishWithdraw(
        address user,
        uint128 _withdrawAmount,
        uint128[] _vested,
        address send_gas_to,
        TvmCell callback_payload
    ) public override {
        address expectedAddr = getUserDataAddress(user);
        require (expectedAddr == msg.sender, NOT_USER_DATA);
        tvm.rawReserve(_reserve(), 2);

        transferReward(user, _vested, callback_payload);
        emit Reward(user, _vested);

        if (_withdrawAmount > 0) {
            tokenBalance -= _withdrawAmount;

            emit Withdraw(user, _withdrawAmount);
            ITONTokenWallet(tokenWallet).transferToRecipient{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(
                0, user, _withdrawAmount, 0, 0, send_gas_to, true, callback_payload
            );
        } else {
            send_gas_to.transfer(0, false, MsgFlag.ALL_NOT_RESERVED);
        }
    }

    function withdrawUnclaimed(address to, TvmCell callback_payload) external onlyOwner {
        require (msg.value >= MIN_CLAIM_REWARD_MSG_VALUE + TOKEN_TRANSFER_VALUE * rewardTokenRoot.length, LOW_WITHDRAW_MSG_VALUE);
        // minimum value that should remain on contract
        tvm.rawReserve(_reserve(), 2);

        transferReward(to, unclaimedReward, callback_payload);
        for (uint i = 0; i < unclaimedReward.length; i++) {
            unclaimedReward[i] = 0;
        }
    }

    function addRewardRound(RewardRound reward_round) external onlyOwner {
        require (msg.value >= ADD_REWARD_ROUND_VALUE);
        require (reward_round.startTime >= now, BAD_REWARD_ROUNDS_INPUT);
        require (reward_round.rewardPerSecond.length == rewardTokenRoot.length, BAD_REWARD_ROUNDS_INPUT);

        tvm.rawReserve(_reserve(), 2);
        rewardRounds.push(reward_round);
    }

    function setEndTime(uint32 farm_end_time) external onlyOwner {
        require (msg.value >= SET_END_TIME_VALUE);
        require (farm_end_time >= now, BAD_FARM_END_TIME);
        require (farm_end_time >= rewardRounds[rewardRounds.length - 1].startTime, BAD_FARM_END_TIME);
        require (farmEndTime == 0, BAD_FARM_END_TIME);

        tvm.rawReserve(_reserve(), 2);
        farmEndTime = farm_end_time;
    }

    // withdraw all staked tokens without reward in case of some critical logic error / insufficient tons on FarmPool balance
    function safeWithdraw(address send_gas_to) external view {
        require (msg.sender.value != 0, EXTERNAL_CALL);
        require (msg.value >= MIN_WITHDRAW_MSG_VALUE, LOW_WITHDRAW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 2);

        address user_data_addr = getUserDataAddress(msg.sender);
        IUserData(user_data_addr).processSafeWithdraw{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(send_gas_to);
    }

    function finishSafeWithdraw(address user, uint128 amount, address send_gas_to) external override {
        address expectedAddr = getUserDataAddress(user);
        require (expectedAddr == msg.sender, NOT_USER_DATA);
        tvm.rawReserve(_reserve(), 2);

        tokenBalance -= amount;

        TvmCell tvmcell;
        emit Withdraw(user, amount);

        ITONTokenWallet(tokenWallet).transferToRecipient{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(
            0, user, uint128(amount), 0, 0, send_gas_to, false, tvmcell
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

        if (now > _lastRewardTime) {
            // special case - last update occurred before start of 1st round
            uint32 first_round_start = rewardRounds[0].startTime;
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
                        uint32 new_reward_time = math.min(_roundEndTime, now);

                        if (tokenBalance == 0) {
                            for (uint k = 0; k < rewardRounds[j].rewardPerSecond.length; k++) {
                                _unclaimedReward[k] += new_reward[k];
                            }
                            _lastRewardTime = new_reward_time;
                            continue;
                        }

                        for (uint k = 0; k < rewardRounds[j].rewardPerSecond.length; k++) {
                            _accTonPerShare[k] += math.muldiv(new_reward[k], 1e18, tokenBalance);
                        }
                        _lastRewardTime = new_reward_time;
                    }
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
            tvm.rawReserve(_reserve(), 2);

            uint64 _deposit_nonce = slice.decode(uint64);
            PendingDeposit deposit = deposits[_deposit_nonce];
            address user_data_addr = deployUserData(deposit.user);
            for (uint i = 0; i < rewardTokenRoot.length; i++) {
                // user first deposit? try deploy wallet for him
                IRootTokenContract(rewardTokenRoot[i]).deployEmptyWallet{value: TOKEN_WALLET_DEPLOY_VALUE}(
                    TOKEN_WALLET_DEPLOY_GRAMS_VALUE, // deploy grams
                    0, // owner pubkey
                    deposit.user, // owner address
                    deposit.user // gas refund address
                );
            }
            // try again
            IUserData(user_data_addr).processDeposit{value: 0, flag: MsgFlag.ALL_NOT_RESERVED}(_deposit_nonce, deposit.amount, accTonPerShare, lastRewardTime);

        }
    }

    modifier onlyOwner() {
        require(msg.sender == owner, NOT_OWNER);
        _;
    }
}
