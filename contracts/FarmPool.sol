pragma solidity ^0.40.0;
pragma AbiHeader expire;

import "../token-contracts/free-ton/contracts/interfaces/IRootTokenContract.sol";
import "../token-contracts/free-ton/contracts/interfaces/ITONTokenWallet.sol";
import "../token-contracts/free-ton/contracts/interfaces/ITokensReceivedCallback.sol";
import "./IUserData.sol";
import "./ITonFarmPool.sol";


contract TonFarmPool is ITokensReceivedCallback, ITonFarmPool {
    event Deposit(address user, uint128 amount);
    event Withdraw(address user, uint256 amount);

    uint128 public rewardPerSecond;

    uint128 public lastRewardTime;

    uint128 public accTonPerShare;

    uint128 public farmStartTime;

    uint128 public farmEndTime;

    address public lpTokenRoot;

    address public lpTokenWallet;

    uint128 public lpTokenBalance;

    uint128 public minDeposit;

    address public owner;

//    TvmCell public static userDataСode;

    constructor(address _owner, uint128 _rewardPerSecond, uint128 _farmStartTime, uint128 _farmEndTime, address _lpTokenRoot) public {
        require (tvm.pubkey() == msg.pubkey, 123);
        require (_farmStartTime < _farmEndTime);
        tvm.accept();

        rewardPerSecond = _rewardPerSecond;
        farmStartTime = _farmStartTime;
        farmEndTime = _farmEndTime;
        lpTokenRoot = _lpTokenRoot;
        owner = _owner;

        setUpTokenWallet();
    }

    /*
        @notice Creates token wallet for configured root token
    */
    function setUpTokenWallet() internal view {
        // Deploy vault's token wallet
        IRootTokenContract(lpTokenRoot).deployEmptyWallet{value: 1 ton}(
            1, // deploy grams
            0, // owner pubkey
            address(this), // owner address
            address(this) // gas refund address
        );

        // Request for token wallet address
        IRootTokenContract(configuration.root).getWalletAddress{
            value: 1 ton, callback: TonFarmPool.receiveTokenWalletAddress
        }(0, address(this));

        // TODO: настроить setReceiveCallback
    }

    /*
        @notice Store vault's token wallet address
        @dev Only root can call with correct params
        @param wallet Farm pool's token wallet
    */
    function receiveTokenWalletAddress(
        address wallet
    ) external {
        require(msg.sender == lpTokenRoot, wrong_root);
        lpTokenWallet = wallet;
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
    ) external {
        require (msg.sender == lpTokenWallet);
        // TODO: constant
        require (msg.value >= 1 ton);
        tvm.rawReserve(address(this).balance - msg.value, 2);

        if (sender_wallet.value == 0 || amount < minDeposit) {
            // external owner or too low deposit value
            TvmCell tvmcell;
            ITONTokenWallet(lpTokenWallet).transfer{value: 0, flag: 128}(sender_public_key, amount, 0, original_gas_to, false, tvmcell);
            // TODO: emit Event for such failure?
            return;
        }

        updatePoolInfo();

        // we try deploying every time
        address userDataAddr = deployUserData(sender_wallet);
        UserData(userDataAddr).processDeposit{value: 0, flag: 128}(amount, accTonPerShare, original_gas_to);
    }

    function finishDeposit(address user, uint128 _prevAmount, uint128 _prevRewardDebt, uint128 _depositAmount, address send_gas_to) external {
        address expectedAddr = getUserDataAddress(user);
        require (expectedAddr == msg.sender, 131);

        uint128 pending = 0;
        if (_prevAmount > 0) {
            pending = (_prevAmount * accTonPerShare / 1e12) - _prevRewardDebt;
        }

        tvm.rawReserve(address(this).balance - msg.value - pending, 2);
        lpTokenBalance += _depositAmount;

        if (pending > 0) {
            user.transfer(pending, false, 1);
        }

        emit Deposit(user, _depositAmount);

        send_gas_to.transfer(0, false, 128);
    }

    function withdraw(uint128 amount, address send_gas_to) public {
        require (msg.sender.value != 0, 127);
        require (amount > 0, 128);
        // TODO: constants
        require (msg.value >= 1 ton);
        tvm.rawReserve(address(this).balance - msg.value, 2);

        updatePoolInfo();

        address userDataAddr = getUserDataAddress(msg.sender);
        UserData(userDataAddr).processWithdraw{value: 0, flag: 128}(amount, accTonPerShare, send_gas_to);
    }

    function finishWithdraw(address user, uint128 _prevAmount, uint128 _prevRewardDebt, uint128 _withdrawAmount, address send_gas_to) external {
        address expectedAddr = getUserDataAddress(user);
        require (expectedAddr == msg.sender, 131);

        uint128 pending = (_prevAmount * accTonPerShare / 1e12) - _prevRewardDebt;
        tvm.rawReserve(address(this).balance - msg.value - pending, 2);

        lpTokenBalance -= _withdrawAmount;
        user.transfer(pending, false, 1);

        TvmCell tvmcell;
        emit Withdraw(user, _withdrawAmount);

        ITONTokenWallet(lpTokenWallet).transfer{value: 0, flag: 128}(user, _withdrawAmount, 0, send_gas_to, false, tvmcell);
    }

    // TODO:
    function withdrawUnclaimed() external onlyOwner {}

    // TODO:
    function pendingReward() external view {}

    // TODO: upgradable

    function getMultiplier(uint128 from, uint128 to) public view returns(uint128) {
        require (from <= to, 126);

        if (to > farmEndTime) {
            to = farmEndTime;
        }

        if (from < farmStartTime) {
            from = farmStartTime;
        }

        return to - from;
    }

    function updatePoolInfo() internal {
        if (now() <= lastRewardTime) {
            return;
        }

        if (lpTokenBalance == 0) {
            lastRewardTime = now();
            return;
        }

        uint128 multiplier = getMultiplier(lastRewardTime, now());
        uint128 tonReward = rewardPerSecond * multiplier;
        accTonPerShare += tonReward * 1e12 / lpTokenBalance;
        lastRewardTime = now();
    }

    function deployUserData(address _user) internal returns (address) {
        TvmCell stateInit = tvm.buildStateInit({
            contr: UserData,
            varInit: { user: _user },
            pubkey: tvm.pubkey(),
            code: userDataСode
        });

        // TODO: add constant value
        return new UserData{
            stateInit: stateInit,
            value: 0.2 ton,
            wid: address(this).wid,
            flag: 1
        }();
    }

    function getUserDataAddress(address _user) public returns (address) {
        TvmCell stateInit = tvm.buildStateInit({
            contr: UserData,
            varInit: { user: _user },
            pubkey: tvm.pubkey(),
            code: userDataСode
        });
        return address(tvm.hash(stateInit));
    }

    function setRewardPerSecond(uint128 newReward) onlyOwner {
        tvm.rawReserve(address(this).balance - msg.value, 2);
        rewardPerSecond = newReward;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, 124);
        _;
    }
}
