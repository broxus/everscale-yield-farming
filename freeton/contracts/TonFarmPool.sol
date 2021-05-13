pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;

import "./interfaces/IRootTokenContract.sol";
import "./interfaces/ITONTokenWallet.sol";
import "./interfaces/ITokensReceivedCallback.sol";
import "./interfaces/IUserData.sol";
import "./interfaces/ITonFarmPool.sol";
import "./UserData.sol";


contract TonFarmPool is ITokensReceivedCallback, ITonFarmPool {
    // Events
    event Deposit(address user, uint256 amount);
    event Withdraw(address user, uint256 amount);

    // ERRORS
    uint8 public constant NOT_OWNER = 101;
    uint8 public constant NOT_ROOT = 102;
    uint8 public constant NOT_TOKEN_WALLET = 103;
    uint8 public constant LOW_DEPOSIT_MSG_VALUE = 104;
    uint8 public constant NOT_USER_DATA = 105;
    uint8 public constant EXTERNAL_CALL = 106;
    uint8 public constant ZERO_AMOUNT_INPUT = 107;
    uint8 public constant LOW_WITHDRAW_MSG_VALUE = 108;
    uint8 public constant FARMING_NOT_ENDED = 109;
    uint8 public constant WRONG_INTERVAL = 110;


    // constants
    uint128 public constant TOKEN_WALLET_DEPLOY_VALUE = 1 ton;
    uint128 public constant GET_WALLET_ADDRESS_VALUE = 0.5 ton;
    uint128 public constant MIN_DEPOSIT_MSG_VALUE = 2 ton;
    uint128 public constant MIN_WITHDRAW_MSG_VALUE = 1 ton;
    uint128 public constant CONTRACT_MIN_BALANCE = 1 ton;
    uint128 public constant USER_DATA_DEPLOY_VALUE = 0.2 ton;
    uint128 public constant TOKEN_TRANSFER_VALUE = 0.5 ton;

    // State vars
    uint256 public rewardPerSecond;

    uint256 public accTonPerShare;

    uint256 public lastRewardTime;

    uint256 public farmStartTime;

    uint256 public farmEndTime;

    address public tokenRoot;

    address public tokenWallet;

    uint256 public tokenBalance;

    address public rewardTokenRoot;

    address public rewardTokenWallet;

    uint256 public rewardTokenBalance;

    address public owner;

    struct PendingDeposit {
        address user;
        uint256 amount;
        address send_gas_to;
    }

    uint64 public deposit_nonce = 0;
    // this is used to prevent data loss on bounced messages during deposit
    mapping (uint64 => PendingDeposit) deposits;

    TvmCell public static userDataCode;
    
    uint64 public static deploy_nonce;

    constructor(address _owner, uint256 _rewardPerSecond, uint256 _farmStartTime, uint256 _farmEndTime, address _tokenRoot, address _rewardTokenRoot) public {
        require (_farmStartTime < _farmEndTime, WRONG_INTERVAL);
        tvm.accept();

        rewardPerSecond = _rewardPerSecond;
        farmStartTime = _farmStartTime;
        farmEndTime = _farmEndTime;
        tokenRoot = _tokenRoot;
        rewardTokenRoot = _rewardTokenRoot;
        owner = _owner;

        setUpTokenWallets();
    }

    function _reserve() internal view returns (uint128) {
        return math.max(address(this).balance - msg.value, CONTRACT_MIN_BALANCE);
    }

    /*
        @notice Creates token wallet for configured root token
    */
    function setUpTokenWallets() internal view {
        // Deploy vault's token wallet
        IRootTokenContract(tokenRoot).deployEmptyWallet{value: TOKEN_WALLET_DEPLOY_VALUE}(
            TOKEN_WALLET_DEPLOY_VALUE / 2, // deploy grams
            0, // owner pubkey
            address(this), // owner address
            address(this) // gas refund address
        );

        // Request for token wallet address
        IRootTokenContract(tokenRoot).getWalletAddress{
            value: GET_WALLET_ADDRESS_VALUE, callback: TonFarmPool.receiveTokenWalletAddress
        }(0, address(this));


        IRootTokenContract(rewardTokenRoot).deployEmptyWallet{value: TOKEN_WALLET_DEPLOY_VALUE}(
            TOKEN_WALLET_DEPLOY_VALUE / 2, // deploy grams
            0, // owner pubkey
            address(this), // owner address
            address(this) // gas refund address
        );

        // Request for token wallet address
        IRootTokenContract(rewardTokenRoot).getWalletAddress{
            value: GET_WALLET_ADDRESS_VALUE, callback: TonFarmPool.receiveTokenWalletAddress
        }(0, address(this));
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
        } else if (msg.sender == rewardTokenRoot) {
            rewardTokenWallet = wallet;
            ITONTokenWallet(wallet).setReceiveCallback{value: 0.05 ton}(address(this), false);
        }
    }

    function transferReward(address receiver_addr, uint256 amount) internal {
        TvmCell tvmcell;
        amount = math.min(rewardTokenBalance, amount);

        ITONTokenWallet(rewardTokenWallet).transferToRecipient{value: TOKEN_TRANSFER_VALUE, flag: 0}(
            0,
            receiver_addr,
            uint128(amount),
            0,
            0,
            receiver_addr,
            false,
            tvmcell
        );
        rewardTokenBalance -= amount;
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
            if (sender_address.value == 0 || msg.value < MIN_DEPOSIT_MSG_VALUE) {
                // external owner or too low deposit value or too lov msg.value
                TvmCell tvmcell;
                ITONTokenWallet(tokenWallet).transfer{value: 0, flag: 128}(
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
            deposits[deposit_nonce] = PendingDeposit(sender_address, amount, original_gas_to);

            address userDataAddr = getUserDataAddress(sender_address);
            UserData(userDataAddr).processDeposit{value: 0, flag: 128}(deposit_nonce, amount, accTonPerShare);
        } else if (msg.sender == rewardTokenWallet) {
            rewardTokenBalance += amount;
            original_gas_to.transfer(0, false, 128);
        }
    }

    function finishDeposit(uint64 _deposit_nonce, uint256 _prevAmount, uint256 _prevRewardDebt, uint256 _accTonPerShare) external override {
        PendingDeposit deposit = deposits[_deposit_nonce];
        address expectedAddr = getUserDataAddress(deposit.user);
        require (expectedAddr == msg.sender, NOT_USER_DATA);

        tvm.rawReserve(_reserve(), 2);

        uint256 pending = 0;
        if (_prevAmount > 0) {
            pending = ((_prevAmount * _accTonPerShare) / 1e18) - _prevRewardDebt;
        }

        tokenBalance += deposit.amount;

        if (pending > 0) {
            transferReward(deposit.user, pending);
        }

        delete deposits[_deposit_nonce];
        emit Deposit(deposit.user, deposit.amount);

        deposit.send_gas_to.transfer(0, false, 128);
    }

    function withdraw(uint256 amount, address send_gas_to) public {
        require (msg.sender.value != 0, EXTERNAL_CALL);
        require (amount > 0, ZERO_AMOUNT_INPUT);
        require (msg.value >= MIN_WITHDRAW_MSG_VALUE, LOW_WITHDRAW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 2);

        updatePoolInfo();

        address userDataAddr = getUserDataAddress(msg.sender);
        // we cant check if user has any balance here, delegate it to UserData
        UserData(userDataAddr).processWithdraw{value: 0, flag: 128}(amount, accTonPerShare, send_gas_to);
    }

    function withdrawAll() public {
        require (msg.sender.value != 0, EXTERNAL_CALL);
        require (msg.value >= MIN_WITHDRAW_MSG_VALUE, LOW_WITHDRAW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 2);

        updatePoolInfo();

        address userDataAddr = getUserDataAddress(msg.sender);
        // we cant check if user has any balance here, delegate it to UserData
        UserData(userDataAddr).processWithdrawAll{value: 0, flag: 128}(accTonPerShare, msg.sender);
    }

    function finishWithdraw(address user, uint256 _prevAmount, uint256 _prevRewardDebt, uint256 _withdrawAmount, uint256 _accTonPerShare, address send_gas_to) public override {
        address expectedAddr = getUserDataAddress(user);
        require (expectedAddr == msg.sender, NOT_USER_DATA);
        tvm.rawReserve(_reserve(), 2);

        uint256 pending = ((_prevAmount * _accTonPerShare) / 1e18) - _prevRewardDebt;

        tokenBalance -= _withdrawAmount;

        if (pending > 0) {
            transferReward(user, pending);
        }

        TvmCell tvmcell;
        emit Withdraw(user, _withdrawAmount);

        ITONTokenWallet(tokenWallet).transferToRecipient{value: 0, flag: 128}(
            0, user, uint128(_withdrawAmount), 0, 0, send_gas_to, false, tvmcell
        );
    }

    function finishWithdrawAll(address user, uint256 _prevAmount, uint256 _prevRewardDebt, uint256 _accTonPerShare, address send_gas_to) external override {
        finishWithdraw(user, _prevAmount, _prevRewardDebt, _prevAmount, _accTonPerShare, send_gas_to);
    }

    function withdrawUnclaimed(address to) external onlyOwner {
        require (now >= (farmEndTime + 24 hours), FARMING_NOT_ENDED);
        // minimum value that should remain on contract
        tvm.rawReserve(CONTRACT_MIN_BALANCE, 2);

        transferReward(to, rewardTokenBalance);
    }

    // user_amount and user_reward_debt should be fetched from UserData at first
    function pendingReward(uint256 user_amount, uint256 user_reward_debt) external view returns (uint256) {
        uint256 _accTonPerShare = accTonPerShare;
        if (now > lastRewardTime && tokenBalance != 0) {
            uint256 multiplier = getMultiplier(lastRewardTime, now);
            uint256 tonReward = multiplier * rewardPerSecond;
            _accTonPerShare += (tonReward * 1e18) / tokenBalance;
        }
        return ((user_amount * _accTonPerShare) / 1e18) - user_reward_debt;
    }

    function getMultiplier(uint256 from, uint256 to) public view returns(uint256) {
        require (from <= to, WRONG_INTERVAL);

        if ((from > farmEndTime) || (to < farmStartTime)) {
            return 0;
        }

        if (to > farmEndTime) {
            to = farmEndTime;
        }

        if (from < farmStartTime) {
            from = farmStartTime;
        }

        return to - from;
    }

    // withdraw all staked tokens without reward in case of some critical logic error / insufficient tons on FarmPool balance
    function safeWithdraw(address send_gas_to) external {
        require (msg.sender.value != 0, EXTERNAL_CALL);
        require (msg.value >= MIN_WITHDRAW_MSG_VALUE, LOW_WITHDRAW_MSG_VALUE);
        tvm.rawReserve(_reserve(), 2);

        address user_data_addr = getUserDataAddress(msg.sender);
        IUserData(user_data_addr).processSafeWithdraw{value: 0, flag: 128}(send_gas_to);
    }

    function finishSafeWithdraw(address user, uint256 amount, address send_gas_to) external override {
        address expectedAddr = getUserDataAddress(user);
        require (expectedAddr == msg.sender, NOT_USER_DATA);
        tvm.rawReserve(_reserve(), 2);

        tokenBalance -= amount;

        TvmCell tvmcell;
        emit Withdraw(user, amount);

        ITONTokenWallet(tokenWallet).transferToRecipient{value: 0, flag: 128}(
            0, user, uint128(amount), 0, 0, send_gas_to, false, tvmcell
        );
    }

    function updatePoolInfo() internal {
        if (now <= lastRewardTime) {
            return;
        }

        if (tokenBalance == 0) {
            lastRewardTime = now;
            return;
        }

        uint256 multiplier = getMultiplier(lastRewardTime, now);
        uint256 tonReward = rewardPerSecond * multiplier;
        accTonPerShare += tonReward * 1e18 / tokenBalance;
        lastRewardTime = now;
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
        }();
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
            // user first deposit? try deploy wallet for him
            IRootTokenContract(rewardTokenRoot).deployEmptyWallet{value: TOKEN_WALLET_DEPLOY_VALUE}(
                TOKEN_WALLET_DEPLOY_VALUE / 2, // deploy grams
                0, // owner pubkey
                deposit.user, // owner address
                deposit.user // gas refund address
            );
            // try again
            UserData(user_data_addr).processDeposit{value: 0, flag: 128}(_deposit_nonce, deposit.amount, accTonPerShare);

        }
    }

    modifier onlyOwner() {
        require(msg.sender == owner, NOT_OWNER);
        _;
    }
}
