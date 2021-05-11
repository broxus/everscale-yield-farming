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

    let root;
    let userTokenWallet1;
    let userTokenWallet2;
    let farmStart;
    let farmEnd;
    let rewardPerSec;
    if (locklift.network === 'dev') {
        rewardPerSec = 100000000; // 0.1
    } else {
        rewardPerSec = 1000000000; // 1
    }
    const minDeposit = 100;
    const userInitialTokenBal = 10000;

    let farm_pool;
    let farm_pool_wallet;

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
            value: convertCrystal(0.6, 'nano')
        });
    };

    const withdrawTokens = async function(user, farm_pool, withdraw_amount) {
        return await user.runTarget({
            contract: farm_pool,
            method: 'withdraw',
            params: {
                amount: withdraw_amount,
                send_gas_to: user.address
            },
            value: convertCrystal(0.6, 'nano')
        });
    };

    const withdrawAllTokens = async function(user, farm_pool) {
        return await user.runTarget({
            contract: farm_pool,
            method: 'withdrawAll',
            params: {},
            value: convertCrystal(0.6, 'nano')
        });
    }

    const checkReward = async function(user, prevBalance, prevRewardTime, tx) {
        const user1_bal_after = await locklift.ton.getBalance(user.address);
        const reward = user1_bal_after - prevBalance;

        const time_passed = tx.transaction.now - prevRewardTime;
        const expected_reward = rewardPerSec * time_passed;
        const tx_cost = convertCrystal(0.3, 'nano'); // rough estimate

        expect(reward).to.be.above(expected_reward - tx_cost, 'Bad reward');
    }

    const checkTokenBalances = async function(farm_pool, farm_pool_wallet, userTokenWallet, bal1, bal2, bal3) {
        const pool_token_bal = await farm_pool_wallet.call({method: 'balance'});
        const pool_bal = await farm_pool.call({method: 'lpTokenBalance'});
        const user_wallet_bal = await userTokenWallet.call({method: 'balance'});

        expect(pool_token_bal.toNumber()).to.be.equal(bal1, 'Pool ton token wallet low value');
        expect(pool_bal.toNumber()).to.be.equal(bal2, 'Pool balance low value');
        expect(user_wallet_bal.toNumber()).to.be.equal(bal3, 'Pool balance low value');
    }

    describe('Setup contracts', async function() {
        describe('Token', async function() {
            it('Deploy root', async function() {
                const RootToken = await locklift.factory.getContract(
                    'RootTokenContract',
                    './node_modules/broxus-ton-tokens-contracts/free-ton/build'
                );

                const TokenWallet = await locklift.factory.getContract(
                    'TONTokenWallet',
                    './node_modules/broxus-ton-tokens-contracts/free-ton/build'
                );

                const [keyPair] = await locklift.keys.getKeyPairs();

                root = await locklift.giver.deployContract({
                    contract: RootToken,
                    constructorParams: {
                        root_public_key_: `0x${keyPair.public}`,
                        root_owner_address_: locklift.ton.zero_address
                    },
                    initParams: {
                        name: stringToBytesArray('Token'),
                        symbol: stringToBytesArray('TKN'),
                        decimals: 9,
                        wallet_code: TokenWallet.code,
                        _randomNonce: getRandomNonce(),
                    },
                    keyPair,
                });
                root.afterRun = afterRun;
                root.setKeyPair(keyPair);

                logger.log(`Root address: ${root.address}`);


                const name = await root.call({
                    method: 'name',
                    params: {}
                });

                expect(name.toString()).to.be.equal("Token", 'Wrong root name');
                expect((await locklift.ton.getBalance(root.address)).toNumber()).to.be.above(0, 'Root balance empty');
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
                    }, convertCrystal(10, 'nano'));

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
                [ userTokenWallet1, userTokenWallet2 ] = await Promise.all([user1, user2].map(async (user) => {

                    await user.runTarget({
                        contract: root,
                        method: 'deployEmptyWallet',
                        params: {
                            deploy_grams: convertCrystal(1, 'nano'),
                            wallet_public_key_: 0,
                            owner_address_: user.address,
                            gas_back_address: user.address
                        },
                        value: convertCrystal(2, 'nano'),
                    });

                    const userTokenWalletAddress = await root.call({
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
                const balance1 = await userTokenWallet1.call({method: 'balance'});
                const balance2 = await userTokenWallet2.call({method: 'balance'});

                expect(balance1.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');
                expect(balance2.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');
            });
        });

        describe('Farm pool', async function() {
            it('Deploy farm pool contract', async function() {
                const TonFarmPool = await locklift.factory.getContract(
                    'TonFarmPool',
                    './build'
                );

                const UserData = await locklift.factory.getContract(
                    'UserData',
                    './build'
                );

                const [keyPair] = await locklift.keys.getKeyPairs();

                farmStart = Math.floor(Date.now() / 1000);
                farmEnd = Math.floor(Date.now() / 1000) + 10000;

                farm_pool = await locklift.giver.deployContract({
                    contract: TonFarmPool,
                    constructorParams: {
                        _owner: admin_user.address,
                        _rewardPerSecond: rewardPerSec,
                        _minDeposit: minDeposit,
                        _farmStartTime: farmStart,
                        _farmEndTime: farmEnd,
                        _lpTokenRoot: root.address
                    },
                    initParams: {
                        userDataCode: UserData.code,
                        deploy_nonce: 0
                    },
                    keyPair,
                }, convertCrystal(3, 'nano'));

                logger.log(`Farm Pool address: ${farm_pool.address}`);

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

                // we wait until last msg in deploy chain is indexed
                // last msg is setReceiveCallback from farm pool to token wallet
                await locklift.ton.client.net.wait_for_collection({
                    collection: 'messages',
                    filter: {
                        dst: { eq: expectedWalletAddr },
                        src: { eq: farm_pool.address },
                        // this is the body of setReceiveCallback call
                        // body: { eq: `te6ccgEBAQEAKAAAS3Hu6HWABHVBJcgv7aQ+zPFad/KtOJMATapHjRzEbZYcCnx3Xrmo` }
                        // try catch by value
                        value: { eq: "0x2ebae40" },
                        status: { eq: 5 }
                    },
                    result: 'id',
                    timeout: 120000
                });

                const farm_pool_wallet_addr = await farm_pool.call({method: 'lpTokenWallet'});
                logger.log(`Farm Pool token wallet: ${farm_pool_wallet_addr}`);

                farm_pool_wallet = await locklift.factory.getContract(
                    'TONTokenWallet',
                    './node_modules/broxus-ton-tokens-contracts/free-ton/build'
                );
                farm_pool_wallet.setAddress(farm_pool_wallet_addr);
                await afterRun();
                // call in order to check if wallet is deployed
                const details = await farm_pool_wallet.call({method: 'getDetails'});
                expect(details.owner_address).to.be.equal(farm_pool.address, 'Wrong farm pool token wallet owner');
                expect(details.receive_callback).to.be.equal(farm_pool.address, 'Wrong farm pool token wallet receive callback');
                expect(details.root_address).to.be.equal(root.address, 'Wrong farm pool token wallet root');
            });
            it('Sending tons to pool', async function() {
                const amount = 600 * 10**9;
                await locklift.giver.giver.run({
                    method: 'sendGrams',
                    params: {
                        dest: farm_pool.address,
                        amount
                    }
                });
                await afterRun();
                expect((await locklift.ton.getBalance(farm_pool.address)).toNumber()).to.be.above(amount, 'Farm pool balance empty');
            });
        });
    });

    describe('Staking pipeline testing', async function() {
        describe('1 user farming', async function () {
            it('Deposit tokens', async function() {
                const tx = await depositTokens(user1, userTokenWallet1, farm_pool, minDeposit);
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toString(), 'Bad event');
            });

            it('Deposit 2nd time', async function() {
                const prev_reward_time = await farm_pool.call({method: 'lastRewardTime'});
                const user1_bal_before = await locklift.ton.getBalance(user1.address);
                await sleep(2000);

                const tx = await depositTokens(user1, userTokenWallet1, farm_pool, minDeposit);
                await afterRun(tx);
                await checkReward(user1, user1_bal_before, prev_reward_time, tx);
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit * 2, minDeposit * 2, userInitialTokenBal - minDeposit * 2
                );

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toString(), 'Bad event');
            });

            it('User withdraw half of staked amount', async function() {
                const prev_reward_time = await farm_pool.call({method: 'lastRewardTime'});
                const user1_bal_before = await locklift.ton.getBalance(user1.address);
                await sleep(2000);

                const tx = await withdrawTokens(user1, farm_pool, minDeposit);
                await checkReward(user1, user1_bal_before, prev_reward_time.toNumber(), tx);

                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );
                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toString(), 'Bad event');
            });

            it('User withdraw other half', async function() {
                const prev_reward_time = await farm_pool.call({method: 'lastRewardTime'});
                const user1_bal_before = await locklift.ton.getBalance(user1.address);
                await sleep(2000);

                const tx = await withdrawTokens(user1, farm_pool, minDeposit);
                await checkReward(user1, user1_bal_before, prev_reward_time.toNumber(), tx);

                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    0, 0, userInitialTokenBal
                );
                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toString(), 'Bad event');
            });
        });

        describe('Multiple users farming', async function() {
            let user1_deposit_time;
            let user2_deposit_time;

            it('Users deposit tokens', async function() {
                const tx1 = await depositTokens(user1, userTokenWallet1, farm_pool, minDeposit);
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit, minDeposit, userInitialTokenBal - minDeposit
                )

                await sleep(5000);

                const tx2 = await depositTokens(user2, userTokenWallet2, farm_pool, minDeposit);
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit * 2, minDeposit * 2, userInitialTokenBal - minDeposit
                )
                await afterRun(tx1);

                user1_deposit_time = tx1.transaction.now;
                user2_deposit_time = tx2.transaction.now;
            });

            it('Users withdraw tokens', async function() {
                await sleep(5000);

                const user1_bal_before = await locklift.ton.getBalance(user1.address);
                const tx1 = await withdrawTokens(user1, farm_pool, minDeposit);
                await afterRun(tx1);
                const user1_bal_after = await locklift.ton.getBalance(user1.address);
                const reward1 = user1_bal_after - user1_bal_before;

                const time_passed_1 = user2_deposit_time - user1_deposit_time;
                const expected_reward_1 = rewardPerSec * time_passed_1;

                const time_passed_2 = tx1.transaction.now - user2_deposit_time;
                const expected_reward_2 = rewardPerSec * 0.5 * time_passed_2;

                const tx_cost = convertCrystal(0.6, 'nano'); // rough estimate
                const expected_reward_final = (expected_reward_1 + expected_reward_2 - tx_cost) * 0.9

                expect(reward1).to.be.above(expected_reward_final, 'Bad reward 1 user');

                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit, minDeposit, userInitialTokenBal
                )

                await sleep(2000);

                const user2_bal_before = await locklift.ton.getBalance(user2.address);
                const tx2 = await withdrawTokens(user2, farm_pool, minDeposit);
                await afterRun(tx1);
                const user2_bal_after = await locklift.ton.getBalance(user2.address);
                const reward2 = user2_bal_after - user2_bal_before;

                const time_passed_21 = tx1.transaction.now - user2_deposit_time;
                const expected_reward_21 = rewardPerSec * 0.5 * time_passed_21;

                const time_passed_22 = tx2.transaction.now - tx1.transaction.now;
                const expected_reward_22 = rewardPerSec * time_passed_22;
                const expected_reward_final_2 = (expected_reward_22 + expected_reward_21 - tx_cost) * 0.9

                expect(reward2).to.be.above(expected_reward_final_2, 'Bad reward 2 user');

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
                expect(_amount).to.be.equal(minDeposit.toString(), 'Bad event');

                user_deposit_time = tx.transaction.now;
            });

            it('User withdraw all', async function() {
                await sleep(2000);
                const user_bal_before = await locklift.ton.getBalance(user1.address);
                const tx1 = await withdrawAllTokens(user1, farm_pool);
                await afterRun(tx1);
                const user_bal_after = await locklift.ton.getBalance(user1.address);
                const reward = user_bal_after - user_bal_before;

                const time_passed = tx1.transaction.now - user_deposit_time;
                const expected_reward = rewardPerSec * time_passed;

                const tx_cost = convertCrystal(0.6, 'nano'); // rough estimate
                const expected_reward_final = (expected_reward - tx_cost) * 0.9

                expect(reward).to.be.above(expected_reward_final, 'Bad reward 1 user');

                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    0, 0, userInitialTokenBal
                )
            });
        });

        describe('Pool has low balance', async function() {
            it('Deposit tokens', async function() {
                const updatedRewardPerSec = (farmEnd - farmStart) * rewardPerSec * 1000000;
                // increase rewardPerSec so that pool will become unable to pay rewards
                // now pools pays amount equal to its balance every second
                await admin_user.runTarget({
                    contract: farm_pool,
                    method: 'setRewardPerSecond',
                    params: {
                        newReward: updatedRewardPerSec
                    },
                    value: convertCrystal(1, 'nano')
                });
                const newReward = await farm_pool.call({method: 'rewardPerSecond'});
                expect(newReward.toNumber()).to.be.equal(updatedRewardPerSec, 'RewardPerSec not updated');

                const tx = await depositTokens(user1, userTokenWallet1, farm_pool, minDeposit);
                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toString(), 'Bad event');
            });

            it('User withdraw, debt emitted', async function() {
                const updatedRewardPerSec = (farmEnd - farmStart) * rewardPerSec * 1000000;

                const prev_reward_time = await farm_pool.call({method: 'lastRewardTime'});
                const user1_bal_before = await locklift.ton.getBalance(user1.address);
                await sleep(2000);

                const tx = await withdrawTokens(user1, farm_pool, minDeposit);

                const user1_bal_after = await locklift.ton.getBalance(user1.address);
                expect(user1_bal_after.toNumber()).to.be.below(user1_bal_before.toNumber(), 'Balance increased on debt');

                const time_passed = tx.transaction.now - prev_reward_time;
                const expected_reward = (time_passed * updatedRewardPerSec) * 0.9;

                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    0, 0, userInitialTokenBal
                );
                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('RewardDebt')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                const num = Number(_amount);
                expect(num).to.be.above(expected_reward, 'Bad event');

                // return to normal
                await admin_user.runTarget({
                    contract: farm_pool,
                    method: 'setRewardPerSecond',
                    params: {
                        newReward: rewardPerSec
                    },
                    value: convertCrystal(1, 'nano')
                });
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
                expect(_amount).to.be.equal(minDeposit.toString(), 'Bad event');
            });

            it('Safe withdraw', async function() {
                const user1_bal_before = await locklift.ton.getBalance(user1.address);
                await sleep(2000);

                const tx = await user1.runTarget({
                    contract: farm_pool,
                    method: 'safeWithdraw',
                    params: {
                        send_gas_to: user1.address
                    },
                    value: convertCrystal(0.6, 'nano')
                });
                const user1_bal_after = await locklift.ton.getBalance(user1.address);
                expect(user1_bal_after.toNumber()).to.be.below(user1_bal_before.toNumber(), 'Balance increased on safe withdraw');

                await checkTokenBalances(
                    farm_pool, farm_pool_wallet, userTokenWallet1,
                    0, 0, userInitialTokenBal
                );
                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toString(), 'Bad event');
            });
        });
    });

    describe('Admin functions', async function() {
        it('setRewardPerSecond', async function() {
            const new_val = 10;
            await admin_user.runTarget({
                contract: farm_pool,
                method: 'setRewardPerSecond',
                params: {
                    newReward: new_val
                },
                value: convertCrystal(1, 'nano')
            });

            const pool_reward_per_sec = await farm_pool.call({method: 'rewardPerSecond'});
            expect(pool_reward_per_sec.toNumber()).to.be.equal(new_val, 'Reward per second not updated');
        });

        it('Upgrade', async  function() {
            await admin_user.runTarget({
                contract: farm_pool,
                method: 'upgrade',
                params: {
                    new_code: farm_pool.code
                },
                value: convertCrystal(1, 'nano')
            });

            // try to read any var
            await farm_pool.call({method: 'rewardPerSecond'});
        })

    });
});