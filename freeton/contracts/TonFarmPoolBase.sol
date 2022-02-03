pragma ton-solidity ^0.56.0;
pragma AbiHeader expire;


import "../../node_modules/broxus-ton-tokens-contracts/contracts/interfaces/ITokenRoot.sol";
import "../../node_modules/broxus-ton-tokens-contracts/contracts/interfaces/ITokenWallet.sol";
import "../../node_modules/broxus-ton-tokens-contracts/contracts/interfaces/IAcceptTokensTransferCallback.sol";

import "./interfaces/IUserData.sol";
import "./interfaces/ITonFarmPool.sol";
import "./interfaces/IFabric.sol";
import "./UserData.sol";
import "../../node_modules/@broxus/contracts/contracts/libraries/MsgFlag.sol";


abstract contract TonFarmPoolBase is ITonFarmPool, IAcceptTokensTransferCallback {
    // ERRORS
    uint8 constant NOT_OWNER = 101;
    uint8 constant NOT_ROOT = 102;
    uint8 constant NOT_TOKEN_WALLET = 103;
    uint8 constant LOW_DEPOSIT_MSG_VALUE = 104;
    uint8 constant NOT_USER_DATA = 105;
    uint8 constant EXTERNAL_CALL = 106;
    uint8 constant ZERO_AMOUNT_INPUT = 107;
    uint8 constant LOW_WITHDRAW_MSG_VALUE = 108;
    uint8 constant FARMING_NOT_ENDED = 109;
    uint8 constant WRONG_INTERVAL = 110;
    uint8 constant BAD_REWARD_TOKENS_INPUT = 111;
    uint8 constant NOT_FABRIC = 112;
    uint8 constant LOW_CLAIM_REWARD_MSG_VALUE = 113;
    uint8 constant BAD_REWARD_ROUNDS_INPUT = 114;
    uint8 constant BAD_FARM_END_TIME = 115;
    uint8 constant BAD_VESTING_SETUP = 116;
    uint8 constant CANT_WITHDRAW_UNCLAIMED_ALL = 117;

    // constants
    uint128 constant TOKEN_WALLET_DEPLOY_VALUE = 0.5 ton;
    uint128 constant TOKEN_WALLET_DEPLOY_GRAMS_VALUE = 0.1 ton;
    uint128 constant MIN_DEPOSIT_MSG_VALUE = 1 ton;
    uint128 constant MIN_WITHDRAW_MSG_VALUE = 1 ton;
    uint128 constant MIN_CLAIM_REWARD_MSG_VALUE = 1 ton;
    uint128 constant CONTRACT_MIN_BALANCE = 1 ton;
    uint128 constant USER_DATA_DEPLOY_VALUE = 0.2 ton;
    uint128 constant TOKEN_TRANSFER_VALUE = 1 ton;
    uint128 constant FABRIC_DEPLOY_CALLBACK_VALUE = 0.1 ton;
    uint128 constant ADD_REWARD_ROUND_VALUE = 0.5 ton;
    uint128 constant SET_END_TIME_VALUE = 0.5 ton;
    uint128 constant INCREASE_DEBT_VALUE = 0.3 ton;

    uint32 constant MAX_UINT32 = 0xFFFFFFFF;
    uint128 constant SCALING_FACTOR = 1e18;

    uint32 withdrawAllLockPeriod;

    // State vars
    uint32 lastRewardTime;

    // should be set dynamically
    uint32 farmEndTime;

    uint32 vestingPeriod;

    uint32 vestingRatio;

    address tokenRoot;

    address tokenWallet;

    uint128 tokenBalance;

    RewardRound[] rewardRounds;

    uint256[] accTonPerShare;

    address[] rewardTokenRoot;

    address[] rewardTokenWallet;

    uint128[] rewardTokenBalance;

    uint128[] rewardTokenBalanceCumulative;

    uint128[] unclaimedReward;

    address owner;

    struct PendingDeposit {
        address user;
        uint128 amount;
        address send_gas_to;
        uint32 nonce;
    }

    uint64 deposit_nonce = 0;
    // this is used to prevent data loss on bounced messages during deposit
    mapping (uint64 => PendingDeposit) deposits;
    //
    TvmCell static userDataCode;

    address static fabric;

    uint64 static deploy_nonce;
}