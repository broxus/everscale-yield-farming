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

    const depositTokens = async function(user, userTokenWallet, farm_pool, deposit_amount) {
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
            value: convertCrystal(2.5, 'nano')
        });
    };

    const withdrawUnclaimed = async function(user, farm_pool) {
        return await user.runTarget({
            contract: farm_pool,
            method: 'withdrawUnclaimed',
            params: {
                to: user.address
            },
            value: convertCrystal(1.5, 'nano')
        })
    }

    const withdrawTokens = async function(user, farm_pool, withdraw_amount) {
        return await user.runTarget({
            contract: farm_pool,
            method: 'withdraw',
            params: {
                amount: withdraw_amount,
                send_gas_to: user.address
            },
            value: convertCrystal(1.5, 'nano')
        });
    };

    const withdrawAllTokens = async function(user, farm_pool) {
        return await user.runTarget({
            contract: farm_pool,
            method: 'withdrawAll',
            params: {},
            value: convertCrystal(1.5, 'nano')
        });
    }

    const checkReward = async function(userWallet, prevBalance, prevRewardTime, newRewardTime, _rewardPerSec) {
        const user_bal_after = await userWallet.call({method: 'balance'});
        const reward = user_bal_after - prevBalance;
        // console.log(user_bal_after, prevBalance)

        const time_passed = newRewardTime - prevRewardTime;
        const expected_reward = _rewardPerSec * time_passed;

        expect(reward).to.be.equal(expected_reward, 'Bad reward');
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

    const checkTokenBalances = async function(farm_pool, farm_pool_wallet, userTokenWallet, bal1, bal2, bal3) {
        const pool_token_bal = await farm_pool_wallet.call({method: 'balance'});
        const pool_bal = await farm_pool.call({method: 'tokenBalance'});
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
                    const Account = await locklift.factory.getAccount();
                    const _user = await locklift.giver.deployContract({
                        contract: Account,
                        constructorParams: {},
                        initParams: {
                            _randomNonce: getRandomNonce()
                        },
                        keyPair,
                    }, convertCrystal(25, 'nano'));

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
                        tokens: adminInitialTokenBal.toString(),
                        to: adminFarmTokenWallet_1.address
                    }
                });

                await farming_root_2.run({
                    method: 'mint',
                    params: {
                        tokens: adminInitialTokenBal.toString(),
                        to: adminFarmTokenWallet_2.address
                    }
                });

                const balance1 = await userTokenWallet1.call({method: 'balance'});
                const balance2 = await userTokenWallet2.call({method: 'balance'});

                const balance3 = await adminFarmTokenWallet_1.call({method: 'balance'});
                const balance4 = await adminFarmTokenWallet_2.call({method: 'balance'});

                expect(balance1.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');
                expect(balance2.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');
                expect(balance3.toString()).to.be.equal(adminInitialTokenBal.toString(), 'User ton token wallet empty');
                expect(balance4.toString()).to.be.equal(adminInitialTokenBal.toString(), 'User ton token wallet empty');
            });
        });

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
                        rewardPerSecond: [rewardPerSec_1, rewardPerSec_2],
                        farmStartTime: farmStart,
                        farmEndTime: farmEnd,
                        tokenRoot: root.address,
                        rewardTokenRoot: [farming_root_1.address, farming_root_2.address]
                    },
                    value: convertCrystal(10, 'nano')
                });

                const {
                    value: {
                        pool: _pool,
                        pool_owner: _owner,
                        rewardPerSecond: _rewardPerSecond,
                        farmStartTime: _farmStartTime,
                        farmEndTime: _farmEndTime,
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

                const farm_pool_wallet_addr = await farm_pool.call({method: 'tokenWallet'});
                logger.log(`Farm Pool token wallet: ${farm_pool_wallet_addr}`);

                farm_pool_wallet = await locklift.factory.getContract(
                    'TONTokenWallet',
                    './node_modules/broxus-ton-tokens-contracts/free-ton/build'
                );
                farm_pool_wallet.setAddress(farm_pool_wallet_addr);

                const farm_pool_reward_wallet_addrs = await farm_pool.call({method: 'rewardTokenWallet'});
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

                await depositTokens(admin_user, adminFarmTokenWallet_1, farm_pool, amount_1);
                await depositTokens(admin_user, adminFarmTokenWallet_2, farm_pool, amount_2);

                await afterRun();

                const [event_1, event_2] = await farm_pool.getEvents('RewardDeposit');

                const { value: { amount: _amount_1} } = event_1;
                expect(parseInt(_amount_1, 16)).to.be.equal(amount_1, 'Bad event');

                const { value: { amount: _amount_2} } = event_2;
                expect(parseInt(_amount_2, 16)).to.be.equal(amount_2, 'Bad event');

                const farm_pool_balance_1 = await farm_pool_reward_wallet_1.call({method: 'balance'});
                const farm_pool_balances = await farm_pool.call({method: 'rewardTokenBalance'});

                expect(farm_pool_balance_1.toString()).to.be.equal(amount_1.toString(), 'Farm pool balance empty');
                expect(farm_pool_balances[0].toString()).to.be.equal(amount_1.toString(), 'Farm pool balance not recognized');

                const farm_pool_balance_2 = await farm_pool_reward_wallet_2.call({method: 'balance'});

                expect(farm_pool_balance_2.toString()).to.be.equal(amount_2.toString(), 'Farm pool balance empty');
                expect(farm_pool_balances[1].toString()).to.be.equal(amount_2.toString(), 'Farm pool balance not recognized');
            });
        });
    });

    describe('Staking pipeline testing', async function() {
        describe('1 user farming', async function () {
            let unclaimed = [0, 0];

            it('Deposit tokens', async function() {
                const tx = await depositTokens(user1, userTokenWallet1, farm_pool, minDeposit);
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                userFarmTokenWallet1_1 = await getUserTokenWallet(farming_root_1, user1);
                userFarmTokenWallet1_2 = await getUserTokenWallet(farming_root_2, user1);

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(parseInt(_amount, 16)).to.be.equal(minDeposit, 'Bad event');
            });

            it('Deposit 2nd time', async function() {
                const prev_reward_time = await farm_pool.call({method: 'lastRewardTime'});
                const farmStart = await farm_pool.call({method: 'farmStartTime'});

                unclaimed[0] += (prev_reward_time - farmStart) * rewardPerSec_1;
                unclaimed[1] += (prev_reward_time - farmStart) * rewardPerSec_2;

                const user1_1_bal_before = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_2_bal_before = await userFarmTokenWallet1_2.call({method: 'balance'});
                await sleep(2000);

                const tx = await depositTokens(user1, userTokenWallet1, farm_pool, minDeposit);
                await afterRun(tx);
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit * 2, minDeposit * 2, userInitialTokenBal - minDeposit * 2
                );

                const new_reward_time = await farm_pool.call({method: 'lastRewardTime'})
                await checkReward(userFarmTokenWallet1_1, user1_1_bal_before, prev_reward_time, new_reward_time, rewardPerSec_1);
                await checkReward(userFarmTokenWallet1_2, user1_2_bal_before, prev_reward_time, new_reward_time, rewardPerSec_2);

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(parseInt(_amount, 16)).to.be.equal(minDeposit, 'Bad event');

                const unclaimed_reward = await farm_pool.call({method: 'unclaimedReward'});
                expect(unclaimed[0].toString()).to.be.equal(unclaimed_reward[0].toString(), "Bad unclaimed reward 1");
                expect(unclaimed[1].toString()).to.be.equal(unclaimed_reward[1].toString(), "Bad unclaimed reward 2");

                const admin_balance_before_1 = await adminFarmTokenWallet_1.call({method: 'balance'});
                const admin_balance_before_2 = await adminFarmTokenWallet_2.call({method: 'balance'});
                await withdrawUnclaimed(admin_user, farm_pool);

                const admin_balance_after_1 = await adminFarmTokenWallet_1.call({method: 'balance'});
                const admin_balance_after_2 = await adminFarmTokenWallet_2.call({method: 'balance'});

                const balance_delta_1 = admin_balance_after_1 - admin_balance_before_1;
                const balance_delta_2 = admin_balance_after_2 - admin_balance_before_2;

                expect(balance_delta_1.toString()).to.be.equal(unclaimed_reward[0].toString());
                expect(balance_delta_2.toString()).to.be.equal(unclaimed_reward[1].toString());

                unclaimed = [0, 0];
            });

            it('User withdraw half of staked amount', async function() {
                const prev_reward_time = await farm_pool.call({method: 'lastRewardTime'});
                const user1_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                await sleep(2000);

                const tx = await withdrawTokens(user1, farm_pool, minDeposit);
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const new_reward_time = await farm_pool.call({method: 'lastRewardTime'})
                await checkReward(userFarmTokenWallet1_1, user1_bal_before_1, prev_reward_time, new_reward_time, rewardPerSec_1);
                await checkReward(userFarmTokenWallet1_2, user1_bal_before_2, prev_reward_time, new_reward_time, rewardPerSec_2);

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(parseInt(_amount, 16)).to.be.equal(minDeposit, 'Bad event');
            });

            it('User withdraw other half', async function() {
                const prev_reward_time = await farm_pool.call({method: 'lastRewardTime'});
                const user1_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                await sleep(2000);

                const tx = await withdrawTokens(user1, farm_pool, minDeposit);

                const new_reward_time = await farm_pool.call({method: 'lastRewardTime'})
                await checkReward(userFarmTokenWallet1_1, user1_bal_before_1, prev_reward_time.toNumber(), new_reward_time, rewardPerSec_1);
                await checkReward(userFarmTokenWallet1_2, user1_bal_before_2, prev_reward_time.toNumber(), new_reward_time, rewardPerSec_2);

                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    0, 0, userInitialTokenBal
                );
                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(parseInt(_amount, 16)).to.be.equal(minDeposit, 'Bad event');
            });

            it("User deposits and withdraws again", async function() {
                await sleep(1000);

                const reward_time_1 = await farm_pool.call({method: 'lastRewardTime'});
                await depositTokens(user1, userTokenWallet1, farm_pool, minDeposit);
                const reward_time_2 = await farm_pool.call({method: 'lastRewardTime'});
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                await sleep(1000);
                unclaimed[0] += (reward_time_2 - reward_time_1) * rewardPerSec_1;
                unclaimed[1] += (reward_time_2 - reward_time_1) * rewardPerSec_2;

                const user1_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                await withdrawTokens(user1, farm_pool, minDeposit);
                const reward_time_3 = await farm_pool.call({method: 'lastRewardTime'});

                const [cumulative_1, cumulative_2] = await farm_pool.call({method: 'rewardTokenBalanceCumulative'});
                const cumulative_expected_1 = (farmEnd - farmStart) * rewardPerSec_1;
                const cumulative_expected_2 = (farmEnd - farmStart) * rewardPerSec_2;

                expect(cumulative_1.toString()).to.be.equal(cumulative_expected_1.toString(), 'Bad cumulative');
                expect(cumulative_2.toString()).to.be.equal(cumulative_expected_2.toString(), 'Bad cumulative');

                const [unclaimed_reward_1, unclaimed_reward_2] = await farm_pool.call({method: 'unclaimedReward'});
                expect(unclaimed[0].toString()).to.be.equal(unclaimed_reward_1.toString(), "Bad unclaimed reward");
                expect(unclaimed[1].toString()).to.be.equal(unclaimed_reward_2.toString(), "Bad unclaimed reward");

                const admin_balance_before_1 = await adminFarmTokenWallet_1.call({method: 'balance'});
                const admin_balance_before_2 = await adminFarmTokenWallet_2.call({method: 'balance'});

                await withdrawUnclaimed(admin_user, farm_pool);
                const admin_balance_after_1 = await adminFarmTokenWallet_1.call({method: 'balance'});
                const admin_balance_after_2 = await adminFarmTokenWallet_2.call({method: 'balance'});

                const balance_delta_1 = admin_balance_after_1 - admin_balance_before_1;
                const balance_delta_2 = admin_balance_after_2 - admin_balance_before_2;

                expect(balance_delta_1.toString()).to.be.equal(unclaimed_reward_1.toString());
                expect(balance_delta_2.toString()).to.be.equal(unclaimed_reward_2.toString());

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
                const tx1 = await depositTokens(user1, userTokenWallet1, farm_pool, minDeposit);
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit, minDeposit, userInitialTokenBal - minDeposit
                )
                user1_deposit_time = await farm_pool.call({method: 'lastRewardTime'});

                await sleep(5000);

                const tx2 = await depositTokens(user2, userTokenWallet2, farm_pool, minDeposit);
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit * 2, minDeposit * 2, userInitialTokenBal - minDeposit
                )
                await afterRun(tx2);
                user2_deposit_time = await farm_pool.call({method: 'lastRewardTime'});
            });

            it('Users withdraw tokens', async function() {
                await sleep(5000);

                const user1_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                const tx1 = await withdrawTokens(user1, farm_pool, minDeposit);
                await afterRun(tx1);

                user1_withdraw_time = await farm_pool.call({method: 'lastRewardTime'});

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
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit, minDeposit, userInitialTokenBal
                )

                await sleep(2000);

                const user2_bal_before_1 = await userFarmTokenWallet2_1.call({method: 'balance'});
                const user2_bal_before_2 = await userFarmTokenWallet2_2.call({method: 'balance'});

                const tx2 = await withdrawTokens(user2, farm_pool, minDeposit);
                await afterRun(tx2);

                const user2_bal_after_1 = await userFarmTokenWallet2_1.call({method: 'balance'});
                const user2_bal_after_2 = await userFarmTokenWallet2_2.call({method: 'balance'});

                user2_withdraw_time = await farm_pool.call({method: 'lastRewardTime'});
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
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    0, 0, userInitialTokenBal
                )
            });
        });

        describe('Withdraw all test', async function() {
            let user_deposit_time;

            it('User deposit tokens', async function() {
                const tx = await depositTokens(user1, userTokenWallet1, farm_pool, minDeposit);
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(parseInt(_amount, 16)).to.be.equal(minDeposit, 'Bad event');

                user_deposit_time = await farm_pool.call({method: 'lastRewardTime'});
            });

            it('User withdraw all', async function() {
                await sleep(2000);
                const user_bal_before_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user_bal_before_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                const tx1 = await withdrawAllTokens(user1, farm_pool);
                const new_reward_time = await farm_pool.call({method: 'lastRewardTime'});
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
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    0, 0, userInitialTokenBal
                )
            });
        });

        describe('Safe withdraw', async function () {
            it('Deposit tokens', async function() {
                const tx = await depositTokens(user1, userTokenWallet1, farm_pool, minDeposit);
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(parseInt(_amount, 16)).to.be.equal(minDeposit, 'Bad event');
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
                    value: convertCrystal(1.5, 'nano')
                });
                const user1_bal_after_1 = await userFarmTokenWallet1_1.call({method: 'balance'});
                const user1_bal_after_2 = await userFarmTokenWallet1_2.call({method: 'balance'});

                expect(user1_bal_after_1.toNumber()).to.be.equal(user1_bal_before_1.toNumber(), 'Balance increased on safe withdraw');
                expect(user1_bal_after_2.toNumber()).to.be.equal(user1_bal_before_2.toNumber(), 'Balance increased on safe withdraw');

                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    0, 0, userInitialTokenBal
                );
                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(parseInt(_amount, 16)).to.be.equal(minDeposit, 'Bad event');
            });
        });
    });
});