const logger = require('mocha-logger');
const { expect } = require('chai');
const BigNumber = require('bignumber.js');
const {
    convertCrystal
} = locklift.utils;


async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const stringToBytesArray = (dataString) => {
    return Buffer.from(dataString).toString('hex')
};

const getRandomNonce = () => Math.random() * 64000 | 0;

const afterRun = async (tx) => {
    if (locklift.network === 'dev') {
        await sleep(80000);
    }
    await sleep(500);
};

describe('Test Ton Farm Pool', async function() {
    this.timeout(30000000);

    let user1;
    let user2;
    let admin_user;

    let fabric;
    let root;
    let farming_root_1;
    let farming_root_2;

    let userTokenWallet1;
    let userTokenWallet2;

    let userData1;
    let userData2;

    let userFarmTokenWallet1_1;
    let userFarmTokenWallet1_2;

    let userFarmTokenWallet2_1;
    let userFarmTokenWallet2_2;

    let adminFarmTokenWallet_1;
    let adminFarmTokenWallet_2;

    let farmStart;
    let farmEnd;
    let rewardPerSec_1;
    let rewardPerSec_2;

    let vestingPeriod = 5;
    let vestingRatio = 500;
    const MAX_VESTING_RATIO = 1000;

    if (locklift.network === 'dev') {
        rewardPerSec_1 = 100000000; // 0.1
        rewardPerSec_2 = 200000000; // 0.1
    } else {
        rewardPerSec_1 = 1000000000; // 1
        rewardPerSec_2 = 2000000000; // 1
    }
    const minDeposit = 100;
    const userInitialTokenBal = 10000;
    const adminInitialTokenBal = new BigNumber(1e18);

    let farm_pool;
    let farm_pool_wallet;
    let farm_pool_reward_wallet_1;
    let farm_pool_reward_wallet_2;

    const clearTokenWallet = async function(user, userTokenWallet) {
        const balance = await userTokenWallet.call({method: 'balance'});
        return await user.runTarget({
            contract: userTokenWallet,
            method: 'transferToRecipient',
            params: {
                recipient_public_key: 0,
                recipient_address: admin_user.address,
                tokens: balance.toFixed(0),
                deploy_grams: 0,
                transfer_grams: 0,
                send_gas_to: user.address,
                notify_receiver: true,
                payload: ''
            },
            value: convertCrystal(2.5, 'nano')
        });
    }

    const depositTokens = async function(user, userTokenWallet, deposit_amount) {
        // console.log(user, userTokenWallet, deposit_amount, farm_pool)
        return await user.runTarget({
            contract: userTokenWallet,
            method: 'transferToRecipient',
            params: {
                recipient_public_key: 0,
                recipient_address: farm_pool.address,
                tokens: deposit_amount,
                deploy_grams: 0,
                transfer_grams: 0,
                send_gas_to: user.address,
                notify_receiver: true,
                payload: ''
            },
            value: convertCrystal(5, 'nano')
        });
    };

    const checkReward = async function(userWallet, prevBalance, prevRewardTime, newRewardTime, _rewardPerSec) {
        const user_bal_after = await userWallet.call({method: 'balance'});
        const reward = user_bal_after - prevBalance;
        // console.log(user_bal_after, prevBalance)

        const time_passed = newRewardTime - prevRewardTime;
        const expected_reward = _rewardPerSec * time_passed;

        expect(reward).to.be.equal(expected_reward, 'Bad reward');
        return expected_reward;
    }

    const withdrawUnclaimed = async function(user) {
        return await user.runTarget({
            contract: farm_pool,
            method: 'withdrawUnclaimed',
            params: {
                to: user.address,
                callback_payload: ''
            },
            value: convertCrystal(5, 'nano')
        })
    }

    const withdrawTokens = async function(user, withdraw_amount) {
        return await user.runTarget({
            contract: farm_pool,
            method: 'withdraw',
            params: {
                amount: withdraw_amount,
                send_gas_to: user.address,
                callback_payload: ''
            },
            value: convertCrystal(5, 'nano')
        });
    };

    const claimReward = async function(user) {
        return await user.runTarget({
            contract: farm_pool,
            method: 'claimReward',
            params: {
                send_gas_to: user.address,
                callback_payload: ''
            },
            value: convertCrystal(5, 'nano')
        });
    };

    const withdrawAllTokens = async function(user) {
        return await user.runTarget({
            contract: farm_pool,
            method: 'withdrawAll',
            params: {callback_payload: ''},
            value: convertCrystal(5, 'nano')
        });
    }

    const addRewardRound = async function(start_time, reward_per_sec) {
        return await admin_user.runTarget({
            contract: farm_pool,
            method: 'addRewardRound',
            params: {reward_round: {startTime: start_time, rewardPerSecond: reward_per_sec}},
            value: convertCrystal(1.5, 'nano')
        });
    }

    const setFarmEndTime = async function(farm_end_time) {
        return await admin_user.runTarget({
            contract: farm_pool,
            method: 'setEndTime',
            params: {farm_end_time: farm_end_time},
            value: convertCrystal(1.5, 'nano')
        });
    }

    const getUserDataDetails = async function(userData) {
        return await userData.call({method: 'getDetails'});
    }

    const checkRewardVesting = async function(userWallet, userData, prevDetails, prevBalance, prevRewardTime, newRewardTime, _rewardPerSec, token_idx) {
        const user_bal_after = await userWallet.call({method: 'balance'});
        const details = await getUserDataDetails(userData);
        const entitled = prevDetails.entitled[token_idx];
        const vestingTime = prevDetails.vestingTime;
        const real_reward = user_bal_after - prevBalance;

        const time_passed = newRewardTime - prevRewardTime;
        const expected_reward = _rewardPerSec * time_passed;

        const vesting_part = expected_reward * vestingRatio / MAX_VESTING_RATIO;
        const clear_part = expected_reward - vesting_part;

        const newly_vested = Math.floor((vesting_part * time_passed) / (time_passed + vestingPeriod));

        const age = newRewardTime >= vestingTime ? vestingPeriod : (newRewardTime - prevRewardTime);
        let to_vest = age >= vestingPeriod ? entitled : Math.floor(entitled * age / (vestingTime - prevRewardTime));

        const remaining_entitled = entitled === 0 ? 0 : entitled - to_vest;
        const unreleased_newly = vesting_part - newly_vested;
        const pending = remaining_entitled + unreleased_newly;

        let period;
        if (remaining_entitled === 0 || pending === 0) {
            period = vestingPeriod;
        } else {
            const age2 = vestingTime - newRewardTime;
            period = Math.floor(((remaining_entitled * age2) + (unreleased_newly * vestingPeriod)) / pending);
        }

        to_vest = new BigNumber(to_vest.toFixed(0));

        const new_vesting_time = newRewardTime.plus(Math.min(period, vestingPeriod));
        const final_entitled = entitled.plus(vesting_part).minus(to_vest).minus(newly_vested);
        // console.log(
        //     entitled.toFixed(),
        //     vesting_part.toFixed(),
        //     to_vest.toFixed(),
        //     newly_vested.toFixed(),
        //     final_entitled.toFixed()
        // );
        const newly_vested_ = new BigNumber(newly_vested);
        const final_vested = newly_vested_.plus(to_vest).plus(clear_part);
        // console.log(final_vested.toFixed(0), newly_vested_ + to_vest + clear_part);
        // console.log(prevRewardTime.toFixed(0), newRewardTime.toFixed(0));

        expect(real_reward.toFixed(0)).to.be.equal(final_vested.toFixed(0), 'Bad vested reward');
        expect(final_entitled.toFixed(0)).to.be.equal(details.entitled[token_idx].toFixed(0), 'Bad entitled reward');
        expect(new_vesting_time.toFixed(0)).to.be.equal(details.vestingTime.toFixed(0), 'Bad vesting time');
        return real_reward;
    }

    const getUserData = async function(user) {
        const addr = await farm_pool.call({method: 'getUserDataAddress', params: {_user: user.address}});
        const userData = await locklift.factory.getContract('UserData');
        userData.setAddress(addr);
        return userData;
    }

    const getUserTokenWallet = async function(_root, user) {
        const expectedWalletAddr = await _root.call({
            method: 'getWalletAddress',
            params: {
                wallet_public_key_: 0,
                owner_address_: user.address
            }
        });
        const userTokenWallet = await locklift.factory.getContract(
            'TONTokenWallet',
            './node_modules/broxus-ton-tokens-contracts/free-ton/build'
        );
        userTokenWallet.setAddress(expectedWalletAddr);
        return userTokenWallet;
    }

    const getDetails = async function() {
        return await farm_pool.call({method: 'getDetails'});
    }

    const getLastRewardTime = async function() {
        const details = await getDetails();
        return details.lastRewardTime;
    }

    const poolTokenBalance = async function() {
        const res = await getDetails();
        return res.tokenBalance;
    }

    const checkTokenBalances = async function(userTokenWallet, bal1, bal2, bal3) {
        const pool_token_bal = await farm_pool_wallet.call({method: 'balance'});
        const pool_bal = await poolTokenBalance();
        const user_wallet_bal = await userTokenWallet.call({method: 'balance'});

        expect(pool_token_bal.toNumber()).to.be.equal(bal1, 'Pool ton token wallet low value');
        expect(pool_bal.toNumber()).to.be.equal(bal2, 'Pool balance low value');
        expect(user_wallet_bal.toNumber()).to.be.equal(bal3, 'Pool balance low value');
    }

    const deployTokenRoot = async function(token_name, token_symbol) {
        const RootToken = await locklift.factory.getContract(
            'RootTokenContract',
            './node_modules/broxus-ton-tokens-contracts/free-ton/build'
        );

        const TokenWallet = await locklift.factory.getContract(
            'TONTokenWallet',
            './node_modules/broxus-ton-tokens-contracts/free-ton/build'
        );

        const [keyPair] = await locklift.keys.getKeyPairs();

        _root = await locklift.giver.deployContract({
            contract: RootToken,
            constructorParams: {
                root_public_key_: `0x${keyPair.public}`,
                root_owner_address_: locklift.ton.zero_address
            },
            initParams: {
                name: stringToBytesArray(token_name),
                symbol: stringToBytesArray(token_symbol),
                decimals: 9,
                wallet_code: TokenWallet.code,
                _randomNonce: getRandomNonce(),
            },
            keyPair,
        });
        _root.afterRun = afterRun;
        _root.setKeyPair(keyPair);

        logger.log(`Token root address: ${_root.address}`);

        const name = await _root.call({
            method: 'name',
            params: {}
        });

        expect(name.toString()).to.be.equal(token_name, 'Wrong root name');
        expect((await locklift.ton.getBalance(_root.address)).toNumber()).to.be.above(0, 'Root balance empty');
        return _root;
    }

    const deployTokenWallets = async function(users, _root) {
        return await Promise.all(users.map(async (user) => {

            await user.runTarget({
                contract: _root,
                method: 'deployEmptyWallet',
                params: {
                    deploy_grams: convertCrystal(1, 'nano'),
                    wallet_public_key_: 0,
                    owner_address_: user.address,
                    gas_back_address: user.address
                },
                value: convertCrystal(2, 'nano'),
            });

            const userTokenWalletAddress = await _root.call({
                method: 'getWalletAddress',
                params: {
                    wallet_public_key_: 0,
                    owner_address_: user.address
                },
            });

            // Wait until user token wallet is presented into the GraphQL
            await locklift.ton.client.net.wait_for_collection({
                collection: 'accounts',
                filter: {
                    id: { eq: userTokenWalletAddress },
                    balance: { gt: `0x0` }
                },
                result: 'balance'
            });

            logger.log(`User token wallet: ${userTokenWalletAddress}`);

            let userTokenWallet = await locklift.factory.getContract(
                'TONTokenWallet',
                './node_modules/broxus-ton-tokens-contracts/free-ton/build'
            );

            userTokenWallet.setAddress(userTokenWalletAddress);
            return userTokenWallet;
        }));
    };

    describe('Setup contracts', async function() {
        describe('Tokens', async function() {
            it('Deploy roots', async function() {
                root = await deployTokenRoot('Farm token', 'FT');
                farming_root_1 = await deployTokenRoot('Reward token', 'RT');
                farming_root_2 = await deployTokenRoot('Reward token 2', 'RT 2');
            });
        });

        describe('Users', async function() {
            it('Deploy users accounts', async function() {
                let users = [];
                for (const i of [1, 1, 1]) {
                    const [keyPair] = await locklift.keys.getKeyPairs();
                    const Account = await locklift.factory.getAccount('Wallet');
                    const _user = await locklift.giver.deployContract({
                        contract: Account,
                        constructorParams: {},
                        initParams: {
                            _randomNonce: getRandomNonce()
                        },
                        keyPair,
                    }, convertCrystal(50, 'nano'));

                    _user.afterRun = afterRun;

                    _user.setKeyPair(keyPair);

                    const userBalance = await locklift.ton.getBalance(_user.address);

                    expect(userBalance.toNumber()).to.be.above(0, 'Bad user balance');

                    logger.log(`User address: ${_user.address}`);

                    const {
                        acc_type_name
                    } = await locklift.ton.getAccountType(_user.address);

                    expect(acc_type_name).to.be.equal('Active', 'User account not active');
                    users.push(_user);
                }
                [user1, user2, admin_user] = users;
            });

            it('Deploy users token wallets', async function() {
                [ userTokenWallet1, userTokenWallet2 ] = await deployTokenWallets([user1, user2], root);
                [ userFarmTokenWallet2_1, adminFarmTokenWallet_1 ] = await deployTokenWallets([user2, admin_user], farming_root_1);
                [ userFarmTokenWallet2_2, adminFarmTokenWallet_2 ] = await deployTokenWallets([user2, admin_user], farming_root_2);
                // [ userFarmTokenWallet1, userFarmTokenWallet2, adminFarmTokenWallet ] = await deployTokenWallets([user1, user2, admin_user], farming_root);
            });

            it('Mint tokens to users', async function() {
                for (const i of [userTokenWallet2, userTokenWallet1]) {
                    await root.run({
                        method: 'mint',
                        params: {
                            tokens: userInitialTokenBal,
                            to: i.address
                        }
                    });
                }
                await farming_root_1.run({
                    method: 'mint',
                    params: {
                        tokens: adminInitialTokenBal.toFixed(0),
                        to: adminFarmTokenWallet_1.address
                    }
                });

                await farming_root_2.run({
                    method: 'mint',
                    params: {
                        tokens: adminInitialTokenBal.toFixed(0),
                        to: adminFarmTokenWallet_2.address
                    }
                });

                const balance1 = await userTokenWallet1.call({method: 'balance'});
                const balance2 = await userTokenWallet2.call({method: 'balance'});

                const balance3 = await adminFarmTokenWallet_1.call({method: 'balance'});
                const balance4 = await adminFarmTokenWallet_2.call({method: 'balance'});

                expect(balance1.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');
                expect(balance2.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');
                expect(balance3.toFixed(0)).to.be.equal(adminInitialTokenBal.toFixed(0), 'User ton token wallet empty');
                expect(balance4.toFixed(0)).to.be.equal(adminInitialTokenBal.toFixed(0), 'User ton token wallet empty');
            });
        });
    });

    describe('Vesting staking pipeline testing', async function() {
        describe('Farm pool', async function() {
            it('Deploy fabric contract', async function () {
                const PoolFabric = await locklift.factory.getContract(
                    'FarmFabric',
                    './build'
                );

                const TonFarmPool = await locklift.factory.getContract(
                    'TonFarmPool',
                    './build'
                );

                const UserData = await locklift.factory.getContract(
                    'UserData',
                    './build'
                );

                const [keyPair] = await locklift.keys.getKeyPairs();

                fabric = await locklift.giver.deployContract({
                    contract: PoolFabric,
                    constructorParams: {
                        _owner: admin_user.address
                    },
                    initParams: {
                        FarmPoolCode: TonFarmPool.code,
                        FarmPoolUserDataCode: UserData.code,
                        nonce: getRandomNonce()
                    },
                    keyPair,
                }, convertCrystal(1, 'nano'));

                logger.log(`Pool Fabric address: ${fabric.address}`);

                const {
                    acc_type_name
                } = await locklift.ton.getAccountType(fabric.address);

                expect(acc_type_name).to.be.equal('Active', 'Fabric account not active');
            });

            it('Deploy farm pool contract (with vesting)', async function() {
                farmStart = Math.floor(Date.now() / 1000);
                farmEnd = Math.floor(Date.now() / 1000) + 10000;

                const deploy_tx = await admin_user.runTarget({
                    contract: fabric,
                    method: 'deployFarmPool',
                    params: {
                        pool_owner: admin_user.address,
                        reward_rounds: [{startTime: farmStart, rewardPerSecond: [rewardPerSec_1, rewardPerSec_2]}],
                        tokenRoot: root.address,
                        rewardTokenRoot: [farming_root_1.address, farming_root_2.address],
                        vestingPeriod: vestingPeriod,
                        vestingRatio: vestingRatio
                    },
                    value: convertCrystal(10, 'nano')
                });

                const {
                    value: {
                        pool: _pool,
                        pool_owner: _owner,
                        reward_rounds: _rewardRounds,
                        tokenRoot: _tokenRoot,
                        rewardTokenRoot: _rewardTokenRoot
                    }
                } = (await fabric.getEvents('NewFarmPool')).pop();

                expect(_owner).to.be.equal(admin_user.address, "Wrong owner");

                logger.log(`Farm Pool address: ${_pool}`);
                // Wait until farm farm pool is indexed
                await locklift.ton.client.net.wait_for_collection({
                    collection: 'accounts',
                    filter: {
                        id: { eq: _pool },
                        balance: { gt: `0x0` }
                    },
                    result: 'id'
                });

                const _farm_pool = await locklift.factory.getContract(
                    'TonFarmPool',
                    './build'
                );
                _farm_pool.setAddress(_pool);
                farm_pool = _farm_pool;

                const farm_pool_version = await farm_pool.call({method: 'getVersion'});

                const expectedWalletAddr = await root.call({
                    method: 'getWalletAddress',
                    params: {
                        wallet_public_key_: 0,
                        owner_address_: farm_pool.address
                    }
                });

                // Wait until farm token wallet is indexed
                await locklift.ton.client.net.wait_for_collection({
                    collection: 'accounts',
                    filter: {
                        id: { eq: expectedWalletAddr },
                        balance: { gt: `0x0` }
                    },
                    result: 'id'
                });

                const staking_details = await getDetails();
                logger.log(`Farm Pool token wallet: ${staking_details.tokenWallet}`);

                farm_pool_wallet = await locklift.factory.getContract(
                    'TONTokenWallet',
                    './node_modules/broxus-ton-tokens-contracts/free-ton/build'
                );
                farm_pool_wallet.setAddress(staking_details.tokenWallet);

                const farm_pool_reward_wallet_addrs = staking_details.rewardTokenWallet;
                logger.log(`Farm Pool reward token wallets: ${farm_pool_reward_wallet_addrs}`);

                farm_pool_reward_wallet_1 = await locklift.factory.getContract(
                    'TONTokenWallet',
                    './node_modules/broxus-ton-tokens-contracts/free-ton/build'
                );
                farm_pool_reward_wallet_1.setAddress(farm_pool_reward_wallet_addrs[0]);

                farm_pool_reward_wallet_2 = await locklift.factory.getContract(
                    'TONTokenWallet',
                    './node_modules/broxus-ton-tokens-contracts/free-ton/build'
                );
                farm_pool_reward_wallet_2.setAddress(farm_pool_reward_wallet_addrs[1]);
                await afterRun();
                // call in order to check if wallet is deployed
                const details = await farm_pool_wallet.call({method: 'getDetails'});
                expect(details.owner_address).to.be.equal(farm_pool.address, 'Wrong farm pool token wallet owner');
                expect(details.receive_callback).to.be.equal(farm_pool.address, 'Wrong farm pool token wallet receive callback');
                expect(details.root_address).to.be.equal(root.address, 'Wrong farm pool token wallet root');

                // call in order to check if wallet is deployed
                const details2 = await farm_pool_reward_wallet_1.call({method: 'getDetails'});
                expect(details2.owner_address).to.be.equal(farm_pool.address, 'Wrong farm pool reward token wallet owner');
                expect(details2.receive_callback).to.be.equal(farm_pool.address, 'Wrong farm pool reward token wallet receive callback');
                expect(details2.root_address).to.be.equal(farming_root_1.address, 'Wrong farm pool reward token wallet root');

                // call in order to check if wallet is deployed
                const details3 = await farm_pool_reward_wallet_2.call({method: 'getDetails'});
                expect(details3.owner_address).to.be.equal(farm_pool.address, 'Wrong farm pool reward token wallet owner');
                expect(details3.receive_callback).to.be.equal(farm_pool.address, 'Wrong farm pool reward token wallet receive callback');
                expect(details3.root_address).to.be.equal(farming_root_2.address, 'Wrong farm pool reward token wallet root');
            });

            it('Sending reward tokens to pool', async function() {
                const amount_1 = (farmEnd - farmStart) * rewardPerSec_1;
                const amount_2 = (farmEnd - farmStart) * rewardPerSec_2;

                await depositTokens(admin_user, adminFarmTokenWallet_1, amount_1);
                await depositTokens(admin_user, adminFarmTokenWallet_2, amount_2);

                await afterRun();

                const [event_1, event_2] = await farm_pool.getEvents('RewardDeposit');

                const { value: { amount: _amount_1} } = event_1;
                expect(_amount_1).to.be.equal(amount_1.toFixed(0), 'Bad event');

                const { value: { amount: _amount_2} } = event_2;
                expect(_amount_2).to.be.equal(amount_2.toFixed(0), 'Bad event');

                const farm_pool_balance_1 = await farm_pool_reward_wallet_1.call({method: 'balance'});
                const staking_details = await getDetails();
                const farm_pool_balances = staking_details.rewardTokenBalance;

                expect(farm_pool_balance_1.toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance empty');
                expect(farm_pool_balances[0].toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance not recognized');

                const farm_pool_balance_2 = await farm_pool_reward_wallet_2.call({method: 'balance'});

                expect(farm_pool_balance_2.toFixed(0)).to.be.equal(amount_2.toFixed(0), 'Farm pool balance empty');
                expect(farm_pool_balances[1].toFixed(0)).to.be.equal(amount_2.toFixed(0), 'Farm pool balance not recognized');
            });
        });

        describe('1 user farming', async function () {
            it('Deposit tokens', async function() {
                const tx = await depositTokens(user1, userTokenWallet1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                userFarmTokenWallet1_1 = await getUserTokenWallet(farming_root_1, user1);
                userFarmTokenWallet1_2 = await getUserTokenWallet(farming_root_2, user1);

                userData1 = await getUserData(user1);
                userData2 = await getUserData(user2);

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it('Deposit 2nd time', async function() {
                const prev_reward_time = await getLastRewardTime();

                const user1_1_bal_before = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_2_bal_before = await userFarmTokenWallet1_2.call({method: 'balance'});
                await sleep(2000);

                const user_details = await getUserDataDetails(userData1);

                const reward_data = await farm_pool.call({method: 'calculateRewardData'});
                // console.log(reward_data);
                const _accTonPerShare = reward_data._accTonPerShare.map(i => i.toFixed(0));
                const _lastRewardTime = reward_data._lastRewardTime.toFixed(0);

                const pending_vested = await userData1.call({
                    method: 'pendingReward',
                    params: {_accTonPerShare: _accTonPerShare, poolLastRewardTime: _lastRewardTime}}
                )
                // console.log(pending_vested.map(i => i.toFixed(0)));

                const tx = await depositTokens(user1, userTokenWallet1, minDeposit);
                await afterRun(tx);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit * 2, minDeposit * 2, userInitialTokenBal - minDeposit * 2
                );

                const new_reward_time = await getLastRewardTime();

                const x = await checkRewardVesting(userFarmTokenWallet1_1, userData1, user_details, user1_1_bal_before, prev_reward_time, new_reward_time, rewardPerSec_1, 0);
                const x1 = await checkRewardVesting(userFarmTokenWallet1_2, userData1, user_details, user1_2_bal_before, prev_reward_time, new_reward_time, rewardPerSec_2, 1);

                console.log(x, x1);

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it('User withdraw half of staked amount', async function() {
                const prev_reward_time = await getLastRewardTime();

                const user1_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                await sleep(2000);
                const user_details = await getUserDataDetails(userData1);

                const tx = await withdrawTokens(user1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const new_reward_time = await getLastRewardTime();

                await checkRewardVesting(userFarmTokenWallet1_1, userData1, user_details, user1_bal_before_1, prev_reward_time, new_reward_time, rewardPerSec_1, 0);
                await checkRewardVesting(userFarmTokenWallet1_2, userData1, user_details, user1_bal_before_2, prev_reward_time, new_reward_time, rewardPerSec_2, 1);

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it('User withdraw other half', async function() {
                const prev_reward_time = await getLastRewardTime();

                const user1_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                await sleep(1000);
                const user_details = await getUserDataDetails(userData1);

                // check claim reward func
                const claim_tx = await claimReward(user1);
                const new_reward_time = await getLastRewardTime();

                const reward1 = await checkRewardVesting(userFarmTokenWallet1_1, userData1, user_details, user1_bal_before_1, prev_reward_time, new_reward_time, rewardPerSec_1, 0);
                const reward2 = await checkRewardVesting(userFarmTokenWallet1_2, userData1, user_details, user1_bal_before_2, prev_reward_time, new_reward_time, rewardPerSec_2, 1);

                // funds are not withdrawed
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const { value: { user: _user_0, amount: _amount_0 } } = (await farm_pool.getEvents('Reward')).pop();
                expect(_user_0).to.be.equal(user1.address, 'Bad event');
                expect(_amount_0[0]).to.be.equal(reward1.toFixed(0), 'Bad event');
                expect(_amount_0[1]).to.be.equal(reward2.toFixed(0), 'Bad event');

                const user1_bal_before_11 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_22 = await userFarmTokenWallet1_2.call({method: 'balance'});

                const user_details_1 = await getUserDataDetails(userData1);

                const tx = await withdrawTokens(user1, minDeposit);
                const new_reward_time_2 = await getLastRewardTime();

                // console.log(user1_bal_before_1.toFixed(0), user1_bal_before_11.toFixed(0), new_reward_time.toNumber(), new_reward_time_2.toNumber());
                await checkRewardVesting(userFarmTokenWallet1_1, userData1, user_details_1, user1_bal_before_11, new_reward_time, new_reward_time_2, rewardPerSec_1, 0);
                await checkRewardVesting(userFarmTokenWallet1_2, userData1, user_details_1, user1_bal_before_22, new_reward_time, new_reward_time_2, rewardPerSec_2, 1);

                await checkTokenBalances(
                    userTokenWallet1, 0, 0, userInitialTokenBal
                );
                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });
        });

        describe("Clear wallets before next tests", async function() {
           await clearTokenWallet(user1, userTokenWallet1);
           await clearTokenWallet(user2, userTokenWallet2);
        });
    });


    describe('Base staking pipeline testing', async function() {
        describe('Farm pool', async function() {
            it('Deploy fabric contract', async function () {
                const PoolFabric = await locklift.factory.getContract(
                    'FarmFabric',
                    './build'
                );

                const TonFarmPool = await locklift.factory.getContract(
                    'TonFarmPool',
                    './build'
                );

                const UserData = await locklift.factory.getContract(
                    'UserData',
                    './build'
                );

                const [keyPair] = await locklift.keys.getKeyPairs();

                fabric = await locklift.giver.deployContract({
                    contract: PoolFabric,
                    constructorParams: {
                        _owner: admin_user.address
                    },
                    initParams: {
                        FarmPoolCode: TonFarmPool.code,
                        FarmPoolUserDataCode: UserData.code,
                        nonce: getRandomNonce()
                    },
                    keyPair,
                }, convertCrystal(1, 'nano'));

                logger.log(`Pool Fabric address: ${fabric.address}`);

                const {
                    acc_type_name
                } = await locklift.ton.getAccountType(fabric.address);

                expect(acc_type_name).to.be.equal('Active', 'Fabric account not active');
            });

            it('Deploy farm pool contract', async function() {
                farmStart = Math.floor(Date.now() / 1000);
                farmEnd = Math.floor(Date.now() / 1000) + 10000;

                const deploy_tx = await admin_user.runTarget({
                    contract: fabric,
                    method: 'deployFarmPool',
                    params: {
                        pool_owner: admin_user.address,
                        reward_rounds: [{startTime: farmStart, rewardPerSecond: [rewardPerSec_1, rewardPerSec_2]}],
                        tokenRoot: root.address,
                        rewardTokenRoot: [farming_root_1.address, farming_root_2.address],
                        vestingPeriod: 0,
                        vestingRatio: 0
                    },
                    value: convertCrystal(10, 'nano')
                });

                const {
                    value: {
                        pool: _pool,
                        pool_owner: _owner,
                        reward_rounds: _rewardRounds,
                        tokenRoot: _tokenRoot,
                        rewardTokenRoot: _rewardTokenRoot
                    }
                } = (await fabric.getEvents('NewFarmPool')).pop();

                expect(_owner).to.be.equal(admin_user.address, "Wrong owner");

                logger.log(`Farm Pool address: ${_pool}`);
                // Wait until farm farm pool is indexed
                await locklift.ton.client.net.wait_for_collection({
                    collection: 'accounts',
                    filter: {
                        id: { eq: _pool },
                        balance: { gt: `0x0` }
                    },
                    result: 'id'
                });

                const _farm_pool = await locklift.factory.getContract(
                    'TonFarmPool',
                    './build'
                );
                _farm_pool.setAddress(_pool);
                farm_pool = _farm_pool;

                const farm_pool_version = await farm_pool.call({method: 'getVersion'});

                const expectedWalletAddr = await root.call({
                    method: 'getWalletAddress',
                    params: {
                        wallet_public_key_: 0,
                        owner_address_: farm_pool.address
                    }
                });

                // Wait until farm token wallet is indexed
                await locklift.ton.client.net.wait_for_collection({
                    collection: 'accounts',
                    filter: {
                        id: { eq: expectedWalletAddr },
                        balance: { gt: `0x0` }
                    },
                    result: 'id'
                });

                const staking_details = await getDetails();
                logger.log(`Farm Pool token wallet: ${staking_details.tokenWallet}`);

                farm_pool_wallet = await locklift.factory.getContract(
                    'TONTokenWallet',
                    './node_modules/broxus-ton-tokens-contracts/free-ton/build'
                );
                farm_pool_wallet.setAddress(staking_details.tokenWallet);

                const farm_pool_reward_wallet_addrs = staking_details.rewardTokenWallet;
                logger.log(`Farm Pool reward token wallets: ${farm_pool_reward_wallet_addrs}`);

                farm_pool_reward_wallet_1 = await locklift.factory.getContract(
                    'TONTokenWallet',
                    './node_modules/broxus-ton-tokens-contracts/free-ton/build'
                );
                farm_pool_reward_wallet_1.setAddress(farm_pool_reward_wallet_addrs[0]);

                farm_pool_reward_wallet_2 = await locklift.factory.getContract(
                    'TONTokenWallet',
                    './node_modules/broxus-ton-tokens-contracts/free-ton/build'
                );
                farm_pool_reward_wallet_2.setAddress(farm_pool_reward_wallet_addrs[1]);
                await afterRun();
                // call in order to check if wallet is deployed
                const details = await farm_pool_wallet.call({method: 'getDetails'});
                expect(details.owner_address).to.be.equal(farm_pool.address, 'Wrong farm pool token wallet owner');
                expect(details.receive_callback).to.be.equal(farm_pool.address, 'Wrong farm pool token wallet receive callback');
                expect(details.root_address).to.be.equal(root.address, 'Wrong farm pool token wallet root');

                // call in order to check if wallet is deployed
                const details2 = await farm_pool_reward_wallet_1.call({method: 'getDetails'});
                expect(details2.owner_address).to.be.equal(farm_pool.address, 'Wrong farm pool reward token wallet owner');
                expect(details2.receive_callback).to.be.equal(farm_pool.address, 'Wrong farm pool reward token wallet receive callback');
                expect(details2.root_address).to.be.equal(farming_root_1.address, 'Wrong farm pool reward token wallet root');

                // call in order to check if wallet is deployed
                const details3 = await farm_pool_reward_wallet_2.call({method: 'getDetails'});
                expect(details3.owner_address).to.be.equal(farm_pool.address, 'Wrong farm pool reward token wallet owner');
                expect(details3.receive_callback).to.be.equal(farm_pool.address, 'Wrong farm pool reward token wallet receive callback');
                expect(details3.root_address).to.be.equal(farming_root_2.address, 'Wrong farm pool reward token wallet root');
            });

            it('Sending reward tokens to pool', async function() {
                const amount_1 = (farmEnd - farmStart) * rewardPerSec_1;
                const amount_2 = (farmEnd - farmStart) * rewardPerSec_2;

                await depositTokens(admin_user, adminFarmTokenWallet_1, amount_1);
                await depositTokens(admin_user, adminFarmTokenWallet_2, amount_2);

                await afterRun();

                const [event_1, event_2] = await farm_pool.getEvents('RewardDeposit');

                const { value: { amount: _amount_1} } = event_1;
                expect(_amount_1).to.be.equal(amount_1.toFixed(0), 'Bad event');

                const { value: { amount: _amount_2} } = event_2;
                expect(_amount_2).to.be.equal(amount_2.toFixed(0), 'Bad event');

                const farm_pool_balance_1 = await farm_pool_reward_wallet_1.call({method: 'balance'});
                const staking_details = await getDetails();
                const farm_pool_balances = staking_details.rewardTokenBalance;

                expect(farm_pool_balance_1.toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance empty');
                expect(farm_pool_balances[0].toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance not recognized');

                const farm_pool_balance_2 = await farm_pool_reward_wallet_2.call({method: 'balance'});

                expect(farm_pool_balance_2.toFixed(0)).to.be.equal(amount_2.toFixed(0), 'Farm pool balance empty');
                expect(farm_pool_balances[1].toFixed(0)).to.be.equal(amount_2.toFixed(0), 'Farm pool balance not recognized');
            });
        });

        describe('1 user farming', async function () {
            let unclaimed = [0, 0];

            it('Deposit tokens', async function() {
                const tx = await depositTokens(user1, userTokenWallet1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                userFarmTokenWallet1_1 = await getUserTokenWallet(farming_root_1, user1);
                userFarmTokenWallet1_2 = await getUserTokenWallet(farming_root_2, user1);

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it('Deposit 2nd time', async function() {
                const staking_details = await getDetails();
                const prev_reward_time = staking_details.lastRewardTime;
                const farmStart = staking_details.rewardRounds[0].startTime;

                unclaimed[0] += (prev_reward_time - farmStart) * rewardPerSec_1;
                unclaimed[1] += (prev_reward_time - farmStart) * rewardPerSec_2;

                const user1_1_bal_before = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_2_bal_before = await userFarmTokenWallet1_2.call({method: 'balance'});
                await sleep(2000);

                const tx = await depositTokens(user1, userTokenWallet1, minDeposit);
                await afterRun(tx);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit * 2, minDeposit * 2, userInitialTokenBal - minDeposit * 2
                );

                const staking_details_1 = await getDetails();
                const new_reward_time = staking_details_1.lastRewardTime;
                await checkReward(userFarmTokenWallet1_1, user1_1_bal_before, prev_reward_time, new_reward_time, rewardPerSec_1);
                await checkReward(userFarmTokenWallet1_2, user1_2_bal_before, prev_reward_time, new_reward_time, rewardPerSec_2);

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');

                const unclaimed_reward = staking_details_1.unclaimedReward;
                // console.log(staking_details_1);
                expect(unclaimed[0].toFixed(0)).to.be.equal(unclaimed_reward[0].toFixed(0), "Bad unclaimed reward 1");
                expect(unclaimed[1].toFixed(0)).to.be.equal(unclaimed_reward[1].toFixed(0), "Bad unclaimed reward 2");

                const admin_balance_before_1 = await adminFarmTokenWallet_1.call({method: 'balance'});
                const admin_balance_before_2 = await adminFarmTokenWallet_2.call({method: 'balance'});
                await withdrawUnclaimed(admin_user);

                const admin_balance_after_1 = await adminFarmTokenWallet_1.call({method: 'balance'});
                const admin_balance_after_2 = await adminFarmTokenWallet_2.call({method: 'balance'});

                const balance_delta_1 = admin_balance_after_1 - admin_balance_before_1;
                const balance_delta_2 = admin_balance_after_2 - admin_balance_before_2;

                expect(balance_delta_1.toFixed(0)).to.be.equal(unclaimed_reward[0].toFixed(0));
                expect(balance_delta_2.toFixed(0)).to.be.equal(unclaimed_reward[1].toFixed(0));

                unclaimed = [0, 0];
            });

            it('User withdraw half of staked amount', async function() {
                const prev_reward_time = await getLastRewardTime();

                const user1_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                await sleep(2000);

                const tx = await withdrawTokens(user1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const new_reward_time = await getLastRewardTime();

                await checkReward(userFarmTokenWallet1_1, user1_bal_before_1, prev_reward_time, new_reward_time, rewardPerSec_1);
                await checkReward(userFarmTokenWallet1_2, user1_bal_before_2, prev_reward_time, new_reward_time, rewardPerSec_2);

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it('User withdraw other half', async function() {
                const prev_reward_time = await getLastRewardTime();

                const user1_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                await sleep(1000);

                // check claim reward func
                const claim_tx = await claimReward(user1);
                const new_reward_time = await getLastRewardTime();

                const reward1 = await checkReward(userFarmTokenWallet1_1, user1_bal_before_1, prev_reward_time.toNumber(), new_reward_time, rewardPerSec_1);
                const reward2 = await checkReward(userFarmTokenWallet1_2, user1_bal_before_2, prev_reward_time.toNumber(), new_reward_time, rewardPerSec_2);

                // funds are not withdrawed
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const { value: { user: _user_0, amount: _amount_0 } } = (await farm_pool.getEvents('Reward')).pop();
                expect(_user_0).to.be.equal(user1.address, 'Bad event');
                expect(_amount_0[0]).to.be.equal(reward1.toFixed(0), 'Bad event');
                expect(_amount_0[1]).to.be.equal(reward2.toFixed(0), 'Bad event');

                const user1_bal_before_11 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_22 = await userFarmTokenWallet1_2.call({method: 'balance'});

                const tx = await withdrawTokens(user1, minDeposit);
                const new_reward_time_2 = await getLastRewardTime();

                // console.log(user1_bal_before_1.toFixed(0), user1_bal_before_11.toFixed(0), new_reward_time.toNumber(), new_reward_time_2.toNumber());

                await checkReward(userFarmTokenWallet1_1, user1_bal_before_11, new_reward_time.toNumber(), new_reward_time_2, rewardPerSec_1);
                await checkReward(userFarmTokenWallet1_2, user1_bal_before_22, new_reward_time.toNumber(), new_reward_time_2, rewardPerSec_2);

                await checkTokenBalances(
                    userTokenWallet1, 0, 0, userInitialTokenBal
                );
                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it("User deposits and withdraws again", async function() {
                await sleep(1000);

                const reward_time_1 = await getLastRewardTime();
                await depositTokens(user1, userTokenWallet1, minDeposit);
                const reward_time_2 = await getLastRewardTime();
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                await sleep(1000);
                unclaimed[0] += (reward_time_2 - reward_time_1) * rewardPerSec_1;
                unclaimed[1] += (reward_time_2 - reward_time_1) * rewardPerSec_2;

                const user1_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                await withdrawTokens(user1, minDeposit);
                const reward_time_3 = await getLastRewardTime();

                const details = await getDetails();
                const [cumulative_1, cumulative_2] = details.rewardTokenBalanceCumulative;
                const cumulative_expected_1 = (farmEnd - farmStart) * rewardPerSec_1;
                const cumulative_expected_2 = (farmEnd - farmStart) * rewardPerSec_2;

                expect(cumulative_1.toFixed(0)).to.be.equal(cumulative_expected_1.toFixed(0), 'Bad cumulative');
                expect(cumulative_2.toFixed(0)).to.be.equal(cumulative_expected_2.toFixed(0), 'Bad cumulative');

                const [unclaimed_reward_1, unclaimed_reward_2] = details.unclaimedReward;
                expect(unclaimed[0].toFixed(0)).to.be.equal(unclaimed_reward_1.toFixed(0), "Bad unclaimed reward");
                expect(unclaimed[1].toFixed(0)).to.be.equal(unclaimed_reward_2.toFixed(0), "Bad unclaimed reward");

                const admin_balance_before_1 = await adminFarmTokenWallet_1.call({method: 'balance'});
                const admin_balance_before_2 = await adminFarmTokenWallet_2.call({method: 'balance'});

                await withdrawUnclaimed(admin_user);
                const admin_balance_after_1 = await adminFarmTokenWallet_1.call({method: 'balance'});
                const admin_balance_after_2 = await adminFarmTokenWallet_2.call({method: 'balance'});

                // console.log(admin_balance_after_1.toFixed(0), admin_balance_before_1.toFixed(0));
                const balance_delta_1 = admin_balance_after_1 - admin_balance_before_1;
                const balance_delta_2 = admin_balance_after_2 - admin_balance_before_2;

                expect(balance_delta_1.toFixed(0)).to.be.equal(unclaimed_reward_1.toFixed(0));
                expect(balance_delta_2.toFixed(0)).to.be.equal(unclaimed_reward_2.toFixed(0));

                await checkReward(userFarmTokenWallet1_1, user1_bal_before_1, reward_time_2, reward_time_3, rewardPerSec_1);
                await checkReward(userFarmTokenWallet1_2, user1_bal_before_2, reward_time_2, reward_time_3, rewardPerSec_2);
            });
        });

        describe('Multiple users farming', async function() {
            let user1_deposit_time;
            let user2_deposit_time;
            let user1_withdraw_time;
            let user2_withdraw_time;

            it('Users deposit tokens', async function() {
                const tx1 = await depositTokens(user1, userTokenWallet1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                )
                user1_deposit_time = await getLastRewardTime();

                await sleep(5000);

                const tx2 = await depositTokens(user2, userTokenWallet2, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit * 2, minDeposit * 2, userInitialTokenBal - minDeposit
                )
                await afterRun(tx2);
                user2_deposit_time = await getLastRewardTime();
            });

            it('Users withdraw tokens', async function() {
                await sleep(5000);

                const user1_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                const tx1 = await withdrawTokens(user1, minDeposit);
                await afterRun(tx1);

                user1_withdraw_time = await getLastRewardTime();

                const user1_bal_after_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_after_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                const reward1_1 = user1_bal_after_1 - user1_bal_before_1;
                const reward1_2 = user1_bal_after_2 - user1_bal_before_2;

                const time_passed_1 = user2_deposit_time - user1_deposit_time;
                const expected_reward_1_1 = rewardPerSec_1 * time_passed_1;
                const expected_reward_1_2 = rewardPerSec_2 * time_passed_1;

                const time_passed_2 = user1_withdraw_time - user2_deposit_time;
                const expected_reward_2_1 = rewardPerSec_1 * 0.5 * time_passed_2;
                const expected_reward_2_2 = rewardPerSec_2 * 0.5 * time_passed_2;

                const expected_reward_final_1 = (expected_reward_1_1 + expected_reward_2_1);
                const expected_reward_final_2 = (expected_reward_1_2 + expected_reward_2_2);

                expect(reward1_1).to.be.eq(expected_reward_final_1, 'Bad reward 1_1 user (low)');
                expect(reward1_2).to.be.eq(expected_reward_final_2, 'Bad reward 1_2 user (low)');

                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal
                )

                await sleep(2000);

                const user2_bal_before_1 = await userFarmTokenWallet2_1.call({method: 'balance'});
                const user2_bal_before_2 = await userFarmTokenWallet2_2.call({method: 'balance'});

                const tx2 = await withdrawTokens(user2, minDeposit);
                await afterRun(tx2);

                const user2_bal_after_1 = await userFarmTokenWallet2_1.call({method: 'balance'});
                const user2_bal_after_2 = await userFarmTokenWallet2_2.call({method: 'balance'});

                user2_withdraw_time = await getLastRewardTime();
                const reward2_1 = user2_bal_after_1 - user2_bal_before_1;
                const reward2_2 = user2_bal_after_2 - user2_bal_before_2;

                const time_passed_21 = user1_withdraw_time - user2_deposit_time;

                const expected_reward_21_1 = rewardPerSec_1 * 0.5 * time_passed_21;
                const expected_reward_21_2 = rewardPerSec_2 * 0.5 * time_passed_21;

                const time_passed_22 = user2_withdraw_time - user1_withdraw_time;

                const expected_reward_22_1 = rewardPerSec_1 * time_passed_22;
                const expected_reward_22_2 = rewardPerSec_2 * time_passed_22;

                const expected_reward_final2_1 = (expected_reward_22_1 + expected_reward_21_1);
                const expected_reward_final2_2 = (expected_reward_22_2 + expected_reward_21_2);

                expect(reward2_1).to.be.equal(expected_reward_final2_1, 'Bad reward 2_1 user (low)');
                expect(reward2_2).to.be.equal(expected_reward_final2_2, 'Bad reward 2_2 user (low)');

                await checkTokenBalances(
                    userTokenWallet1, 0, 0, userInitialTokenBal
                )
            });
        });

        describe("Test dynamic apy", async function() {
            let rew_per_sec_11 = rewardPerSec_1 * 2;
            let rew_per_sec_12 = rewardPerSec_2 * 2;

            let rew_per_sec_21 = rewardPerSec_1 * 3;
            let rew_per_sec_22 = rewardPerSec_2 * 3;

            it("User deposit tokens", async function() {
                const tx = await depositTokens(user1, userTokenWallet1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                userFarmTokenWallet1_1 = await getUserTokenWallet(farming_root_1, user1);
                userFarmTokenWallet1_2 = await getUserTokenWallet(farming_root_2, user1);
                await afterRun(tx);

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it("New reward rounds added", async function() {
                const last_r_time = await getLastRewardTime();
                const tx = await addRewardRound(last_r_time.plus(3).toFixed(0), [rew_per_sec_11, rew_per_sec_12]);
                const tx2 = await addRewardRound(last_r_time.plus(4).toFixed(0), [rew_per_sec_21, rew_per_sec_22]);
                const tx3 = await setFarmEndTime(last_r_time.plus(5).toFixed(0));
            });

            it("User withdraw tokens", async function() {
                // const prev_reward_time = await getLastRewardTime();

                const user1_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                await sleep(5500);

                const tx = await withdrawTokens(user1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, 0, 0, userInitialTokenBal
                );

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');

                // const new_reward_time = await getLastRewardTime();
                // ok, so, we know that user should get reward with initial rate for:
                // round1_start - deposit_time (initial round) * rewardPerSec1
                // round2_start - round1_start * rewardPerSec2
                // endTime - round2_start * rewardPerSec3
                const reward_1 = 3 * rewardPerSec_1 + rew_per_sec_11 + rew_per_sec_21;
                const reward_2 = 3 * rewardPerSec_2 + rew_per_sec_12 + rew_per_sec_22;

                const user1_bal_after_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_after_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                const delta_1 = user1_bal_after_1 - user1_bal_before_1;
                const delta_2 = user1_bal_after_2 - user1_bal_before_2;

                expect(delta_1.toFixed(0)).to.be.eq(reward_1.toFixed(0), "Bad reward");
                expect(delta_2.toFixed(0)).to.be.eq(reward_2.toFixed(0), "Bad reward");
            });
        });

        describe('Withdraw all test', async function() {
            let user_deposit_time;

            it('User deposit tokens', async function() {
                const tx = await depositTokens(user1, userTokenWallet1, minDeposit);
                // console.log(tx.transaction.out_msgs);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');

                user_deposit_time = await getLastRewardTime();
            });

            it('User withdraw all', async function() {
                await sleep(2000);
                const user_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                const tx1 = await withdrawAllTokens(user1, farm_pool);
                const new_reward_time = await getLastRewardTime();
                await afterRun(tx1);

                const user_bal_after_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user_bal_after_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                const reward_1 = user_bal_after_1 - user_bal_before_1;
                const reward_2 = user_bal_after_2 - user_bal_before_2;

                const time_passed = new_reward_time - user_deposit_time;

                const expected_reward_1 = rewardPerSec_1 * time_passed;
                const expected_reward_2 = rewardPerSec_2 * time_passed;

                const expected_reward_final_1 = expected_reward_1;
                const expected_reward_final_2 = expected_reward_2;

                expect(reward_1).to.be.eq(expected_reward_final_1, 'Bad reward 1_1 user');
                expect(reward_2).to.be.eq(expected_reward_final_2, 'Bad reward 1_2 user');

                await checkTokenBalances(
                    userTokenWallet1, 0, 0, userInitialTokenBal
                )
            });
        });

        describe('Safe withdraw', async function () {
            it('Deposit tokens', async function() {
                const tx = await depositTokens(user1, userTokenWallet1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it('Safe withdraw', async function() {
                const user1_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});
                await sleep(2000);

                const tx = await user1.runTarget({
                    contract: farm_pool,
                    method: 'safeWithdraw',
                    params: {
                        send_gas_to: user1.address
                    },
                    value: convertCrystal(5, 'nano')
                });
                const user1_bal_after_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_after_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                expect(user1_bal_after_1.toNumber()).to.be.equal(user1_bal_before_1.toNumber(), 'Balance increased on safe withdraw');
                expect(user1_bal_after_2.toNumber()).to.be.equal(user1_bal_before_2.toNumber(), 'Balance increased on safe withdraw');

                await checkTokenBalances(userTokenWallet1, 0, 0, userInitialTokenBal);
                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });
        });
    });
});