const logger = require('mocha-logger');
const { expect, version} = require('chai');
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


describe('Test Ton Farm Pool - main', async function() {
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
                userTokenWallet2 = await root.mint(userInitialTokenBal, user2);

                adminFarmTokenWallet_1 = await farming_root_1.mint(adminInitialTokenBal.toFixed(0), admin_user);
                adminFarmTokenWallet_2 = await farming_root_2.mint(adminInitialTokenBal.toFixed(0), admin_user);

                userFarmTokenWallet2_1 = await farming_root_1.deployWallet(user2);
                userFarmTokenWallet2_2 = await farming_root_2.deployWallet(user2);
            });

            it('Check tokens minted to users', async function() {
                const balance1 = await userTokenWallet1.balance();
                const balance2 = await userTokenWallet2.balance();

                const balance3 = await adminFarmTokenWallet_1.balance();
                const balance4 = await adminFarmTokenWallet_2.balance();

                expect(balance1.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');
                expect(balance2.toNumber()).to.be.equal(userInitialTokenBal, 'User ton token wallet empty');
                expect(balance3.toFixed(0)).to.be.equal(adminInitialTokenBal.toFixed(0), 'User ton token wallet empty');
                expect(balance4.toFixed(0)).to.be.equal(adminInitialTokenBal.toFixed(0), 'User ton token wallet empty');
            });
        });
    });

    describe('Base staking pipeline testing', async function() {
        describe('Farm pool', async function() {
            it('Deploy fabric contract', async function () {
                fabric = await setupFabric(admin_user, 1);
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

            it('Sending reward tokens to pool', async function() {
                const amount_1 = (farmEnd - farmStart) * rewardPerSec_1;
                const amount_2 = (farmEnd - farmStart) * rewardPerSec_2;

                await farm_pool.deposit(adminFarmTokenWallet_1, amount_1);
                await farm_pool.deposit(adminFarmTokenWallet_2, amount_2);

                await afterRun();

                const [event_1, event_2] = await farm_pool.getEvents('RewardDeposit');

                const { value: { amount: _amount_1} } = event_1;
                expect(_amount_1).to.be.equal(amount_1.toFixed(0), 'Bad event');

                const { value: { amount: _amount_2} } = event_2;
                expect(_amount_2).to.be.equal(amount_2.toFixed(0), 'Bad event');

                const farm_pool_balance_1 = await farm_pool_reward_wallet_1.balance();
                const details = await farm_pool.details();
                const farm_pool_balances = details.rewardTokenBalance;

                expect(farm_pool_balance_1.toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance empty');
                expect(farm_pool_balances[0].toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance not recognized');

                const farm_pool_balance_2 = await farm_pool_reward_wallet_2.balance();

                expect(farm_pool_balance_2.toFixed(0)).to.be.equal(amount_2.toFixed(0), 'Farm pool balance empty');
                expect(farm_pool_balances[1].toFixed(0)).to.be.equal(amount_2.toFixed(0), 'Farm pool balance not recognized');
            });
        });

        describe('1 user farming', async function () {
            let unclaimed = [0, 0];

            it('Deposit tokens', async function() {
                // user1 send his tokens to user2 so that he will deposit them instead of him
                await userTokenWallet1.transfer(minDeposit, user2);
                // now user2 deposit tokens of user1 with special payload
                const tx = await farm_pool.deposit(userTokenWallet2, minDeposit, user1);

                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                userFarmTokenWallet1_1 = await farming_root_1.wallet(user1);
                userFarmTokenWallet1_2 = await farming_root_2.wallet(user1);

                const { value: { user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it('Deposit 2nd time', async function() {
                const details = await farm_pool.details();
                const prev_reward_time = details.lastRewardTime;
                const farmStart = details.rewardRounds[0].startTime;

                unclaimed[0] += (prev_reward_time - farmStart) * rewardPerSec_1;
                unclaimed[1] += (prev_reward_time - farmStart) * rewardPerSec_2;

                const user1_1_bal_before = await userFarmTokenWallet1_1.balance();
                const user1_2_bal_before = await userFarmTokenWallet1_2.balance();
                await sleep(2000);

                const tx = await farm_pool.deposit(userTokenWallet1, minDeposit);
                await afterRun();
                await checkTokenBalances(
                    userTokenWallet1, minDeposit * 2, minDeposit * 2, userInitialTokenBal - minDeposit * 2
                );

                const details_1 = await farm_pool.details();
                const new_reward_time = details_1.lastRewardTime;

                await checkReward(userFarmTokenWallet1_1, user1_1_bal_before, prev_reward_time, new_reward_time, rewardPerSec_1);
                await checkReward(userFarmTokenWallet1_2, user1_2_bal_before, prev_reward_time, new_reward_time, rewardPerSec_2);

                const { value: { user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');

                const unclaimed_reward = details_1.unclaimedReward;
                // console.log(details_1);
                expect(unclaimed[0].toFixed(0)).to.be.equal(unclaimed_reward[0].toFixed(0), "Bad unclaimed reward 1");
                expect(unclaimed[1].toFixed(0)).to.be.equal(unclaimed_reward[1].toFixed(0), "Bad unclaimed reward 2");

                const admin_balance_before_1 = await adminFarmTokenWallet_1.balance();
                const admin_balance_before_2 = await adminFarmTokenWallet_2.balance();

                await farm_pool.withdrawUnclaimed();

                const admin_balance_after_1 = await adminFarmTokenWallet_1.balance();
                const admin_balance_after_2 = await adminFarmTokenWallet_2.balance();

                const balance_delta_1 = admin_balance_after_1 - admin_balance_before_1;
                const balance_delta_2 = admin_balance_after_2 - admin_balance_before_2;

                expect(balance_delta_1.toFixed(0)).to.be.equal(unclaimed_reward[0].toFixed(0));
                expect(balance_delta_2.toFixed(0)).to.be.equal(unclaimed_reward[1].toFixed(0));

                unclaimed = [0, 0];
            });

            it('User withdraw half of staked amount', async function() {
                const prev_reward_time = await farm_pool.lastRewardTime();

                const user1_bal_before_1 = await userFarmTokenWallet1_1.balance();
                const user1_bal_before_2 = await userFarmTokenWallet1_2.balance();

                await sleep(2000);

                const tx = await farm_pool.withdrawTokens(user1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const new_reward_time = await farm_pool.lastRewardTime();

                await checkReward(userFarmTokenWallet1_1, user1_bal_before_1, prev_reward_time, new_reward_time, rewardPerSec_1);
                await checkReward(userFarmTokenWallet1_2, user1_bal_before_2, prev_reward_time, new_reward_time, rewardPerSec_2);

                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it('User withdraw other half', async function() {
                const prev_reward_time = await farm_pool.lastRewardTime();

                const user1_bal_before_1 = await userFarmTokenWallet1_1.balance();
                const user1_bal_before_2 = await userFarmTokenWallet1_2.balance();

                await sleep(1000);

                // check claim reward func
                const claim_tx = await farm_pool.claimReward(user1);
                const new_reward_time = await farm_pool.lastRewardTime();

                const reward1 = await checkReward(userFarmTokenWallet1_1, user1_bal_before_1, prev_reward_time.toNumber(), new_reward_time, rewardPerSec_1);
                const reward2 = await checkReward(userFarmTokenWallet1_2, user1_bal_before_2, prev_reward_time.toNumber(), new_reward_time, rewardPerSec_2);

                // funds are not withdrawed
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const { value: {
                    user: _user_0, reward: _reward, reward_debt: _reward_debt
                } } = (await farm_pool.getEvents('Claim')).pop();
                expect(_user_0).to.be.equal(user1.address, 'Bad event');
                expect(_reward[0]).to.be.equal(reward1.toFixed(0), 'Bad event');
                expect(_reward[1]).to.be.equal(reward2.toFixed(0), 'Bad event');

                const user1_bal_before_11 = await userFarmTokenWallet1_1.balance();
                const user1_bal_before_22 = await userFarmTokenWallet1_2.balance();

                const tx = await farm_pool.withdrawTokens(user1, minDeposit);
                const new_reward_time_2 = await farm_pool.lastRewardTime();

                // console.log(user1_bal_before_1.toFixed(0), user1_bal_before_11.toFixed(0), new_reward_time.toNumber(), new_reward_time_2.toNumber());

                await checkReward(userFarmTokenWallet1_1, user1_bal_before_11, new_reward_time.toNumber(), new_reward_time_2, rewardPerSec_1);
                await checkReward(userFarmTokenWallet1_2, user1_bal_before_22, new_reward_time.toNumber(), new_reward_time_2, rewardPerSec_2);

                await checkTokenBalances(
                    userTokenWallet1, 0, 0, userInitialTokenBal
                );
                const { value: {
                    user: _user, amount: _amount, reward: _reward1, reward_debt: _reward_debt1
                } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it("User deposits and withdraws again", async function() {
                await sleep(1000);

                const reward_time_1 = await farm_pool.lastRewardTime();
                await farm_pool.deposit(userTokenWallet1, minDeposit);
                const reward_time_2 = await farm_pool.lastRewardTime();
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                await sleep(1000);
                unclaimed[0] += (reward_time_2 - reward_time_1) * rewardPerSec_1;
                unclaimed[1] += (reward_time_2 - reward_time_1) * rewardPerSec_2;

                const user1_bal_before_1 = await userFarmTokenWallet1_1.balance();
                const user1_bal_before_2 = await userFarmTokenWallet1_2.balance();

                await farm_pool.withdrawTokens(user1, minDeposit);
                const reward_time_3 = await farm_pool.lastRewardTime();

                const details = await farm_pool.details();
                const [cumulative_1, cumulative_2] = details.rewardTokenBalanceCumulative;
                const cumulative_expected_1 = (farmEnd - farmStart) * rewardPerSec_1;
                const cumulative_expected_2 = (farmEnd - farmStart) * rewardPerSec_2;

                expect(cumulative_1.toFixed(0)).to.be.equal(cumulative_expected_1.toFixed(0), 'Bad cumulative');
                expect(cumulative_2.toFixed(0)).to.be.equal(cumulative_expected_2.toFixed(0), 'Bad cumulative');

                const [unclaimed_reward_1, unclaimed_reward_2] = details.unclaimedReward;
                expect(unclaimed[0].toFixed(0)).to.be.equal(unclaimed_reward_1.toFixed(0), "Bad unclaimed reward");
                expect(unclaimed[1].toFixed(0)).to.be.equal(unclaimed_reward_2.toFixed(0), "Bad unclaimed reward");

                const admin_balance_before_1 = await adminFarmTokenWallet_1.balance();
                const admin_balance_before_2 = await adminFarmTokenWallet_2.balance();

                await farm_pool.withdrawUnclaimed();
                const admin_balance_after_1 = await adminFarmTokenWallet_1.balance();
                const admin_balance_after_2 = await adminFarmTokenWallet_2.balance();

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
                await farm_pool.deposit(userTokenWallet1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                )
                user1_deposit_time = await farm_pool.lastRewardTime();

                await sleep(5000);

                const tx2 = await farm_pool.deposit(userTokenWallet2, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit * 2, minDeposit * 2, userInitialTokenBal - minDeposit
                )
                await afterRun(tx2);
                user2_deposit_time = await farm_pool.lastRewardTime();

                userData1 = await farm_pool.userData(user1, 'UserDataV2');
                userData2 = await farm_pool.userData(user2, 'UserDataV2');
            });

            it('Users withdraw tokens', async function() {
                await sleep(5000);

                const user1_bal_before_1 = await userFarmTokenWallet1_1.balance();
                const user1_bal_before_2 = await userFarmTokenWallet1_2.balance();

                const tx1 = await farm_pool.withdrawTokens(user1, minDeposit);
                await afterRun(tx1);

                user1_withdraw_time = await farm_pool.lastRewardTime();

                const user1_bal_after_1 = await userFarmTokenWallet1_1.balance();
                const user1_bal_after_2 = await userFarmTokenWallet1_2.balance();

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

                const user2_bal_before_1 = await userFarmTokenWallet2_1.balance();
                const user2_bal_before_2 = await userFarmTokenWallet2_2.balance();

                const tx2 = await farm_pool.withdrawTokens(user2, minDeposit);
                await afterRun(tx2);

                const user2_bal_after_1 = await userFarmTokenWallet2_1.balance();
                const user2_bal_after_2 = await userFarmTokenWallet2_2.balance();

                user2_withdraw_time = await farm_pool.lastRewardTime();
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

        describe('Withdraw all test', async function() {
            let user_deposit_time;

            it('User deposit tokens', async function() {
                const tx = await farm_pool.deposit(userTokenWallet1, minDeposit);

                await sleep(1000);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const { value: { user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');

                user_deposit_time = await farm_pool.lastRewardTime();

                const details = await getUserDataDetails(userData1);
                expect(details.amount.toFixed(0)).to.be.eq(minDeposit.toFixed(0), 'Deposit failed');
            });

            it('User withdraw all', async function() {
                await sleep(2000);
                const user_bal_before_1 = await userFarmTokenWallet1_1.balance();
                const user_bal_before_2 = await userFarmTokenWallet1_2.balance();

                const tx1 = await farm_pool.withdrawAllTokens(user1);
                await sleep(1000);
                const new_reward_time = await farm_pool.lastRewardTime();
                await afterRun(tx1);

                const user_bal_after_1 = await userFarmTokenWallet1_1.balance();
                const user_bal_after_2 = await userFarmTokenWallet1_2.balance();

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

        describe("Test dynamic apy", async function() {
            let rew_per_sec_11 = rewardPerSec_1 * 2;
            let rew_per_sec_12 = rewardPerSec_2 * 2;

            let rew_per_sec_21 = rewardPerSec_1 * 3;
            let rew_per_sec_22 = rewardPerSec_2 * 3;

            it("User deposit tokens", async function() {
                const tx = await farm_pool.deposit(userTokenWallet1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                userFarmTokenWallet1_1 = await farming_root_1.wallet(user1);
                userFarmTokenWallet1_2 = await farming_root_2.wallet(user1);
                await afterRun(tx);

                const { value: { user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it("New reward rounds added", async function() {
                const last_r_time = await farm_pool.lastRewardTime();
                const tx = await farm_pool.addRewardRound(last_r_time.plus(4).toFixed(0), [rew_per_sec_11, rew_per_sec_12]);
                const tx2 = await farm_pool.addRewardRound(last_r_time.plus(5).toFixed(0), [rew_per_sec_21, rew_per_sec_22]);
                const tx3 = await farm_pool.setFarmEndTime(last_r_time.plus(6).toFixed(0));
            });

            it("User withdraw tokens", async function() {
                // const prev_reward_time = await farm_pool.lastRewardTime();
                const user1_bal_before_1 = await userFarmTokenWallet1_1.balance();
                const user1_bal_before_2 = await userFarmTokenWallet1_2.balance();

                await sleep(6500);

                const tx = await farm_pool.withdrawTokens(user1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, 0, 0, userInitialTokenBal
                );

                const { value: {
                    user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt
                } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');

                // const new_reward_time = await farm_pool.lastRewardTime();
                // ok, so, we know that user should get reward with initial rate for:
                // round1_start - deposit_time (initial round) * rewardPerSec1
                // round2_start - round1_start * rewardPerSec2
                // endTime - round2_start * rewardPerSec3
                const reward_1 = 4 * rewardPerSec_1 + rew_per_sec_11 + rew_per_sec_21;
                const reward_2 = 4 * rewardPerSec_2 + rew_per_sec_12 + rew_per_sec_22;

                const user1_bal_after_1 = await userFarmTokenWallet1_1.balance();
                const user1_bal_after_2 = await userFarmTokenWallet1_2.balance();

                const delta_1 = user1_bal_after_1 - user1_bal_before_1;
                const delta_2 = user1_bal_after_2 - user1_bal_before_2;

                expect(_reward[0]).to.be.eq(reward_1.toFixed(0), "Bad reward");
                expect(_reward[1]).to.be.eq(reward_2.toFixed(0), "Bad reward");

                expect(delta_1.toFixed(0)).to.be.eq(reward_1.toFixed(0), "Bad reward");
                expect(delta_2.toFixed(0)).to.be.eq(reward_2.toFixed(0), "Bad reward");
            });

            it("Admin withdraw all remaining balance", async function() {
                const details = await farm_pool.details();
                const balances = details.rewardTokenBalance.map(i => i.toFixed(0));

                const admin_balance_before_1 = await adminFarmTokenWallet_1.balance();
                const admin_balance_before_2 = await adminFarmTokenWallet_2.balance();

                const tx = await farm_pool.withdrawUnclaimedAll();

                await sleep(1000);

                const admin_balance_after_1 = await adminFarmTokenWallet_1.balance();
                const admin_balance_after_2 = await adminFarmTokenWallet_2.balance();

                const delta_1 = admin_balance_after_1 - admin_balance_before_1;
                const delta_2 = admin_balance_after_2 - admin_balance_before_2;

                const details_1 = await farm_pool.details();
                const balances_1 = details_1.rewardTokenBalance.map(i => i.toFixed(0));

                expect(balances_1[0]).to.be.equal('0', 'Reward not withdrawed');
                expect(balances_1[1]).to.be.equal('0', 'Reward not withdrawed');

                expect(delta_1.toFixed(0)).to.be.eq(balances[0], "Reward not withdrawed");
                expect(delta_2.toFixed(0)).to.be.eq(balances[1], "Reward not withdrawed");
            })
        });

        describe('Safe withdraw', async function () {
            it('Deposit tokens', async function() {
                const tx = await farm_pool.deposit(userTokenWallet1, minDeposit);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const { value: { user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
            });

            it('Safe withdraw', async function() {
                const user1_bal_before_1 = await userFarmTokenWallet1_1.balance();
                const user1_bal_before_2 = await userFarmTokenWallet1_2.balance();
                await sleep(2000);

                const tx = await farm_pool.safeWithdraw(user1);

                const user1_bal_after_1 = await userFarmTokenWallet1_1.balance();
                const user1_bal_after_2 = await userFarmTokenWallet1_2.balance();

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