const logger = require('mocha-logger');
const { expect } = require('chai');
const BigNumber = require('bignumber.js');
const {
    convertCrystal
} = locklift.utils;

const {
    setupFabric, afterRun,
    sleep, setupTokenRoot,
    wait_acc_deployed,
    deployUser, getUserDataDetails,
    calcExpectedReward, checkReward
} = require('./utils');


describe('Test Ton Farm Pool - debt', async function() {
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

    const checkTokenBalances = async function(userTokenWallet, bal1, bal2, bal3) {
        const pool_token_bal = await farm_pool_wallet.balance();
        const pool_bal = await farm_pool.tokenBalance();
        const user_wallet_bal = await userTokenWallet.balance();

        // console.log(pool_token_bal.toNumber(), pool_bal.toNumber(), user_wallet_bal.toNumber());

        expect(pool_token_bal.toNumber()).to.be.equal(bal1, 'Pool ton token wallet low value');
        expect(pool_bal.toNumber()).to.be.equal(bal2, 'Pool balance low value');
        expect(user_wallet_bal.toNumber()).to.be.equal(bal3, 'Pool balance low value');
    }


    describe('Setup contracts', async function() {
        describe('Tokens', async function() {
            it('Deploy admin', async function() {
                admin_user = await deployUser();
            });

            it('Deploy roots', async function() {
                root = await setupTokenRoot('Farm token', 'FT', admin_user);
                farming_root_1 = await setupTokenRoot('Reward token', 'RT', admin_user);
                farming_root_2 = await setupTokenRoot('Reward token 2', 'RT 2', admin_user);
            });
        });

        describe('Users', async function() {
            it('Deploy users accounts', async function() {
                let users = [];
                for (const i of [1, 2]) {
                    const _user = await deployUser();
                    users.push(_user);
                }
                [user1, user2] = users;
            });

            it('Deploy users token wallets + mint tokens', async function() {
                userTokenWallet1 = await root.mint(userInitialTokenBal, user1);

                adminFarmTokenWallet_1 = await farming_root_1.mint(adminInitialTokenBal.toFixed(0), admin_user);
                adminFarmTokenWallet_2 = await farming_root_2.mint(adminInitialTokenBal.toFixed(0), admin_user);
            });

            it('Check tokens minted to users', async function() {
                const balance1 = await userTokenWallet1.balance();

                const balance3 = await adminFarmTokenWallet_1.balance();
                const balance4 = await adminFarmTokenWallet_2.balance();

                expect(balance1.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');
                expect(balance3.toFixed(0)).to.be.equal(adminInitialTokenBal.toFixed(0), 'User ton token wallet empty');
                expect(balance4.toFixed(0)).to.be.equal(adminInitialTokenBal.toFixed(0), 'User ton token wallet empty');
            });
        });
    });

    describe('Debt staking pipeline testing', async function () {
        describe('Farm pool', async function() {
            it('Deploy fabric contract', async function () {
                fabric = await setupFabric(admin_user);
            });

            it('Deploy farm pool contract', async function() {
                farmStart = Math.floor(Date.now() / 1000);
                farmEnd = Math.floor(Date.now() / 1000) + 10000;

                farm_pool = await fabric.deployPool({
                    pool_owner: admin_user,
                    reward_rounds: [{startTime: farmStart, rewardPerSecond: [rewardPerSec_1, rewardPerSec_2]}],
                    tokenRoot: root.address,
                    rewardTokenRoot: [farming_root_1.address, farming_root_2.address],
                    vestingPeriod: 0,
                    vestingRatio: 0,
                    withdrawAllLockPeriod: 0
                });
                farm_pool_wallet = await farm_pool.wallet();
                [farm_pool_reward_wallet_1, farm_pool_reward_wallet_2] = await farm_pool.rewardWallets();
            });
        });


        describe('Check debt is emitted when no reward tokens', async function() {
            let expected_debt_1;
            let expected_debt_2;

            it('Deposit tokens', async function() {
                const tx = await farm_pool.deposit(userTokenWallet1, minDeposit);
                // console.log(tx.transaction.out_msgs);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );
                userData1 = await farm_pool.userData(user1);

                const user_data_details = await getUserDataDetails(userData1);
                expect(user_data_details.amount.toFixed(0)).to.be.equal(minDeposit.toFixed(0), 'Deposit failed');

                userFarmTokenWallet1_1 = await farming_root_1.wallet(user1);
                // userFarmTokenWallet1_2 = await getUserTokenWallet(farming_root_2, user1);

                const { value: {
                    user: _user,
                    amount: _amount,
                    reward: _reward,
                    reward_debt: _reward_debt
                } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it('Withdraw tokens (debt is emitted, partial reward)', async function() {
                const prev_reward_time = await farm_pool.lastRewardTime();

                const user1_bal_before_1 = await userFarmTokenWallet1_1.balance();
                    // const user1_bal_before_2 = await userFarmTokenWallet1_2.balance();
                await sleep(2000);
                const expected_reward = calcExpectedReward(prev_reward_time, prev_reward_time.plus(1), rewardPerSec_1);
                // send reward only for 1 sec
                await farm_pool.deposit(adminFarmTokenWallet_1, expected_reward.toFixed(0));
                const [event_1] = await farm_pool.getEvents('RewardDeposit');

                const tx = await farm_pool.withdrawTokens(user1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, 0, 0, userInitialTokenBal
                );

                const new_reward_time = await farm_pool.lastRewardTime();

                // calculate debt (plus 1, because we added reward for 1 second of farming)
                expected_debt_1 = calcExpectedReward(prev_reward_time.plus(1), new_reward_time, rewardPerSec_1);
                // expected_debt_2 = calcExpectedReward(prev_reward_time, new_reward_time, rewardPerSec_2);

                const user1_bal_after_1 = await userFarmTokenWallet1_1.balance();
                    // const user1_bal_after_2 = await userFarmTokenWallet1_2.balance();
                const expected_balance = user1_bal_before_1.plus(expected_reward);

                expect(user1_bal_after_1.toFixed(0)).to.be.equal(expected_balance.toFixed(0), 'Bad reward');
                // expect(user1_bal_before_2.toFixed(0)).to.be.equal(user1_bal_after_2.toFixed(0), 'Bad reward');

                const user_data_details = await getUserDataDetails(userData1);
                const debt1 = user_data_details.pool_debt[0];
                // const debt2 = user_data_details.pool_debt[1];

                expect(expected_debt_1.toFixed(0)).to.be.equal(debt1.toFixed(0), 'Bad debt');
                // expect(expected_debt_2.toFixed(0)).to.be.equal(debt2.toFixed(0), 'Bad debt');

                if (expected_debt_1 > 0) {
                    const { value: {
                        user: _user1, amount: _amount1, reward: _reward, reward_debt: _reward_debt
                    } } = (await farm_pool.getEvents('Withdraw')).pop();
                    // console.log(_amount1);
                    expect(_user1).to.be.equal(user1.address, 'Bad event');
                    expect(_reward_debt[0]).to.be.equal(expected_debt_1.toFixed(0), 'Bad event');
                    expect(_reward[0]).to.be.equal(expected_reward.toFixed(0), 'Bad event');
                    expect(_amount1).to.be.equal(minDeposit.toFixed(0), 'Bad event');
                }
            });

            it('Sending more reward tokens to pool', async function() {
                const amount_1 = (farmEnd - farmStart) * rewardPerSec_1;
                // const amount_2 = (farmEnd - farmStart) * rewardPerSec_2;

                await farm_pool.deposit(adminFarmTokenWallet_1, amount_1);
                // await depositTokens(farm_pool, admin_user, adminFarmTokenWallet_2, amount_2);

                await afterRun();

                const event_1 = (await farm_pool.getEvents('RewardDeposit')).pop();expected_debt_1
                const { value: { amount: _amount_1} } = event_1;
                expect(_amount_1).to.be.equal(amount_1.toFixed(0), 'Bad event');

                // const { value: { amount: _amount_2} } = event_2;
                // expect(_amount_2).to.be.equal(amount_2.toFixed(0), 'Bad event');

                const farm_pool_balance_1 = await farm_pool_reward_wallet_1.balance();
                const details = await farm_pool.details();
                const farm_pool_balances = details.rewardTokenBalance;

                expect(farm_pool_balance_1.toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance empty');
                expect(farm_pool_balances[0].toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance not recognized');

                // const farm_pool_balance_2 = await farm_pool_reward_wallet_2.balance();
                //
                // expect(farm_pool_balance_2.toFixed(0)).to.be.equal(amount_2.toFixed(0), 'Farm pool balance empty');
                // expect(farm_pool_balances[1].toFixed(0)).to.be.equal(amount_2.toFixed(0), 'Farm pool balance not recognized');
            });

            it('Claim reward', async function() {
                const user1_bal_before_1 = await userFarmTokenWallet1_1.balance();
                    // const user1_bal_before_2 = await userFarmTokenWallet1_2.balance();

                const claim_tx = await farm_pool.claimReward(user1);
                await afterRun();

                const user1_bal_after_1 = await userFarmTokenWallet1_1.balance();
                    // const user1_bal_after_2 = await userFarmTokenWallet1_2.balance();

                const delta_1 = user1_bal_after_1 - user1_bal_before_1;
                // const delta_2 = user1_bal_after_2 - user1_bal_before_2;

                expect(delta_1.toFixed(0)).to.be.equal(expected_debt_1.toFixed(0), 'Bad reward');
                // expect(delta_2.toFixed(0)).to.be.equal(expected_debt_2.toFixed(0), 'Bad reward');

                const user_data_details = await getUserDataDetails(userData1);
                const debt1 = user_data_details.pool_debt[0];
                // const debt2 = user_data_details.pool_debt[1];

                expect(debt1.toFixed(0)).to.be.equal('0', 'Debt not cleared');
                // expect(debt2.toFixed(0)).to.be.equal('0', 'Debt not cleared');

                const { value: {
                    user: _user, reward: _reward, reward_debt: _reward_debt
                } } = (await farm_pool.getEvents('Claim')).pop();

                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_reward[0]).to.be.equal(expected_debt_1.toFixed(0), 'Bad event');
                expect(_reward_debt[0]).to.be.equal('0', 'Bad event');
                // expect(_amount[1]).to.be.equal(expected_debt_2.toFixed(0), 'Bad event');

            });
        })
    });
});