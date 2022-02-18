const BigNumber = require("bignumber.js");
const {expect} = require("chai");
const {
    getUserDataDetails,
    deployUser,
    setupTokenRoot,
    setupFabric,
    wait_acc_deployed,
    afterRun,
    sleep,
} = require("./utils");
const logger = require("mocha-logger");


describe('Test Ton Farm Pool - vesting', async function() {
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

    let vestingPeriod = 1000;
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

    const checkRewardVesting = async function(userWallet, userData, prevDetails, prevBalance, prevRewardTime, newRewardTime, _rewardPerSec, token_idx) {
        const user_bal_after = await userWallet.balance();
        const details = await getUserDataDetails(userData);
        const entitled = prevDetails.entitled[token_idx];
        const vestingTime = prevDetails.vestingTime;
        const real_reward = user_bal_after - prevBalance;

        const time_passed = newRewardTime - prevRewardTime;
        const expected_reward = _rewardPerSec * time_passed;

        const vesting_part = expected_reward * vestingRatio / MAX_VESTING_RATIO;
        const clear_part = expected_reward - vesting_part;

        // TODO: up to new math
        const newly_vested = Math.floor((vesting_part * time_passed) / (time_passed + vestingPeriod));

        const age = newRewardTime >= vestingTime ? vestingPeriod : (newRewardTime - prevRewardTime);
        let to_vest = age >= vestingPeriod ? entitled : Math.floor((entitled * age) / (vestingTime - prevRewardTime));

        const remaining_entitled = entitled === 0 ? 0 : entitled - to_vest;
        const unreleased_newly = vesting_part - newly_vested;
        const pending = remaining_entitled + unreleased_newly;


        let new_vesting_time;
        // Compute the vesting time (i.e. when the entitled reward to be all vested)
        if (pending === 0) {
            new_vesting_time = newRewardTime;
        } else if (remaining_entitled === 0) {
            // only new reward, set vesting time to vesting period
            new_vesting_time = newRewardTime + vestingPeriod;
        } else if (unreleased_newly === 0) {
            // only unlocking old reward, dont change vesting time
            new_vesting_time = vestingTime;
        } else {
            // "old" reward and, perhaps, "new" reward are pending - the weighted average applied
            const age3 = vestingTime - newRewardTime;
            const period = Math.floor(((remaining_entitled * age3) + (unreleased_newly * vestingPeriod)) / pending);
            new_vesting_time = newRewardTime.plus(Math.min(period, vestingPeriod));
        }

        const final_entitled = entitled.plus(vesting_part).minus(to_vest).minus(newly_vested);

        const newly_vested_ = new BigNumber(newly_vested);
        const final_vested = newly_vested_.plus(to_vest).plus(clear_part);
        // console.log(
        //     entitled.toFixed(),
        //     vesting_part.toFixed(),
        //     to_vest.toFixed(),
        //     newly_vested.toFixed(),
        //     final_entitled.toFixed()
        // );

        // console.log(final_vested.toFixed(0), newly_vested_ + to_vest + clear_part);
        // console.log(prevRewardTime.toFixed(0), newRewardTime.toFixed(0));

        // expect(real_reward.toFixed(0)).to.be.equal(final_vested.toFixed(0), 'Bad vested reward');
        // // console.log(entitled.toFixed(0), final_entitled.toFixed(0));
        // expect(final_entitled.toFixed(0)).to.be.equal(details.entitled[token_idx].toFixed(0), 'Bad entitled reward');
        // expect(new_vesting_time.toFixed(0)).to.be.equal(details.vestingTime.toFixed(0), 'Bad vesting time');
        return real_reward;
    }

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

    describe('Vesting staking pipeline testing', async function() {
        describe('Farm pool', async function() {
            it('Deploy fabric contract', async function () {
                fabric = await setupFabric(admin_user, 1);
            });

            it('Deploy farm pool contract with vesting period', async function() {
                farmStart = Math.floor(Date.now() / 1000);
                farmEnd = Math.floor(Date.now() / 1000) + 10000;

                farm_pool = await fabric.deployPool({
                    pool_owner: admin_user,
                    reward_rounds: [{startTime: farmStart, rewardPerSecond: [rewardPerSec_1, 0]}],
                    tokenRoot: root.address,
                    rewardTokenRoot: [farming_root_1.address, farming_root_2.address],
                    vestingPeriod: vestingPeriod,
                    vestingRatio: vestingRatio,
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
            let first_deposit;
            let end_time;
            let last_withdraw;
            let sec_deposit;

            it('Deposit tokens', async function() {
                const tx = await farm_pool.deposit(userTokenWallet1, minDeposit);
                await afterRun(tx);

                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                userFarmTokenWallet1_1 = await farming_root_1.wallet(user1);
                userFarmTokenWallet1_2 = await farming_root_2.wallet(user1);

                userData1 = await farm_pool.userData(user1, 'UserDataV2');
                userData2 = await farm_pool.userData(user2, 'UserDataV2');

                const user_data_details = await getUserDataDetails(userData1);
                expect(user_data_details.amount.toFixed(0)).to.be.equal(minDeposit.toFixed(0), 'Deposit failed');

                const { value: { user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');

                expect(_reward[0]).to.be.equal('0', 'Bad event');
                expect(_reward[1]).to.be.equal('0', 'Bad event');

                expect(_reward_debt[0]).to.be.equal('0', 'Bad event');
                expect(_reward_debt[1]).to.be.equal('0', 'Bad event');

                first_deposit = await farm_pool.lastRewardTime();
            });

            it('Deposit 2nd time', async function() {
                const prev_reward_time = await farm_pool.lastRewardTime();

                const user1_1_bal_before = await userFarmTokenWallet1_1.balance();
                const user1_2_bal_before = await userFarmTokenWallet1_2.balance();
                await sleep(2000);

                const user_details = await getUserDataDetails(userData1);

                // const reward_data = await farm_pool.call({method: 'calculateRewardData'});
                // // console.log(reward_data);
                // const _accRewardPerShare = reward_data._accRewardPerShare.map(i => i.toFixed(0));
                // const _lastRewardTime = reward_data._lastRewardTime.toFixed(0);
                //
                // const pending_vested = await userData1.call({
                //     method: 'pendingReward',
                //     params: {_accRewardPerShare: _accRewardPerShare, poolLastRewardTime: _lastRewardTime, farmEndTime: 0}}
                // )

                // console.log('Vested', pending_vested._vested.map(i => i.toFixed(0)));
                // console.log('Entitled', pending_vested._entitled.map(i => i.toFixed(0)));
                // console.log('Debt', pending_vested._pool_debt.map(i => i.toFixed(0)));

                const tx = await farm_pool.deposit(userTokenWallet1, minDeposit);
                await afterRun(tx);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit * 2, minDeposit * 2, userInitialTokenBal - minDeposit * 2
                );

                const details = await getUserDataDetails(userData1);
                // console.log(details.vestingTime.toFixed(0));
                console.log(details.vestingTime[0].toFixed(0));
                console.log(details.vestingTime[1].toFixed(0));


                const new_reward_time = await farm_pool.lastRewardTime();

                const x = await checkRewardVesting(userFarmTokenWallet1_1, userData1, user_details, user1_1_bal_before, prev_reward_time, new_reward_time, rewardPerSec_1, 0);
                const x1 = await checkRewardVesting(userFarmTokenWallet1_2, userData1, user_details, user1_2_bal_before, prev_reward_time, new_reward_time, rewardPerSec_2, 1);

                // console.log(x, x1);

                const { value: { user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt } } = (await farm_pool.getEvents('Deposit')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');

                expect(_reward[0]).to.be.eq(x.toFixed(0), 'Bad event');
                expect(_reward[1]).to.be.eq(x1.toFixed(0), 'Bad event');

                expect(_reward_debt[0]).to.be.eq('0', 'Bad event');
                expect(_reward_debt[1]).to.be.eq('0', 'Bad event');
            });

            it('User withdraw half of staked amount', async function() {
                const prev_reward_time = await farm_pool.lastRewardTime();

                const user1_bal_before_1 = await userFarmTokenWallet1_1.balance();
                const user1_bal_before_2 = await userFarmTokenWallet1_2.balance();

                await sleep(2000);
                const user_details = await getUserDataDetails(userData1);

                const tx = await farm_pool.withdrawTokens(user1, minDeposit);
                await sleep(1000);
                await checkTokenBalances(
                    userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                );

                const new_reward_time = await farm_pool.lastRewardTime();

                const x = await checkRewardVesting(userFarmTokenWallet1_1, userData1, user_details, user1_bal_before_1, prev_reward_time, new_reward_time, rewardPerSec_1, 0);
                const x1 = await checkRewardVesting(userFarmTokenWallet1_2, userData1, user_details, user1_bal_before_2, prev_reward_time, new_reward_time, rewardPerSec_2, 1);

                const { value: { user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');

                expect(_reward[0]).to.be.eq(x.toFixed(0), 'Bad event');
                expect(_reward[1]).to.be.eq(x1.toFixed(0), 'Bad event');

                expect(_reward_debt[0]).to.be.eq('0', 'Bad event');
                expect(_reward_debt[1]).to.be.eq('0', 'Bad event');
            });

            it('User withdraw other half', async function() {
                const prev_reward_time = await farm_pool.lastRewardTime();

                const user1_bal_before_1 = await userFarmTokenWallet1_1.balance();
                const user1_bal_before_2 = await userFarmTokenWallet1_2.balance();

                await sleep(1000);
                const user_details = await getUserDataDetails(userData1);

                // check claim reward func
                const claim_tx = await farm_pool.claimReward(user1);
                const new_reward_time = await farm_pool.lastRewardTime();
                await sleep(1000);

                const reward1 = await checkRewardVesting(userFarmTokenWallet1_1, userData1, user_details, user1_bal_before_1, prev_reward_time, new_reward_time, rewardPerSec_1, 0);
                const reward2 = await checkRewardVesting(userFarmTokenWallet1_2, userData1, user_details, user1_bal_before_2, prev_reward_time, new_reward_time, rewardPerSec_2, 1);

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

                const user_details_1 = await getUserDataDetails(userData1);
                // console.log(user_details_1.amount.toNumber());

                const tx = await farm_pool.withdrawTokens(user1, minDeposit);
                const new_reward_time_2 = await farm_pool.lastRewardTime();

                // console.log(user1_bal_before_1.toFixed(0), user1_bal_before_11.toFixed(0), new_reward_time.toNumber(), new_reward_time_2.toNumber());
                await checkRewardVesting(userFarmTokenWallet1_1, userData1, user_details_1, user1_bal_before_11, new_reward_time, new_reward_time_2, rewardPerSec_1, 0);
                await checkRewardVesting(userFarmTokenWallet1_2, userData1, user_details_1, user1_bal_before_22, new_reward_time, new_reward_time_2, rewardPerSec_2, 1);

                await checkTokenBalances(
                    userTokenWallet1, 0, 0, userInitialTokenBal
                );
                const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                expect(_user).to.be.equal(user1.address, 'Bad event');
                expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');

                const user_details_2 = await getUserDataDetails(userData1);
                const entitled = user_details_2.entitled;

                await sleep(vestingPeriod * 1000);
                await farm_pool.claimReward(user1);

                const { value: {
                    user: _user1, reward: _reward1, reward_debt: _reward_debt1
                } } = (await farm_pool.getEvents('Claim')).pop();

                expect(_reward1[0]).to.be.eq(entitled[0].toFixed(0), 'Bad reward');
                expect(_reward1[1]).to.be.eq(entitled[1].toFixed(0), 'Bad reward');

                const user_details_3 = await getUserDataDetails(userData1);

                expect(user_details_3.entitled[0].toFixed(0)).to.be.eq('0', 'Bad reward');
                expect(user_details_3.entitled[1].toFixed(0)).to.be.eq('0', 'Bad reward');

                //
                // const reward_data = await farm_pool.call({method: 'calculateRewardData'});
                // // console.log(reward_data);
                // const _accRewardPerShare = reward_data._accRewardPerShare.map(i => i.toFixed(0));
                // const _lastRewardTime = reward_data._lastRewardTime.toFixed(0);
                //
                // const pending_vested = await userData1.call({
                //     method: 'pendingReward',
                //     params: {_accRewardPerShare: _accRewardPerShare, poolLastRewardTime: _lastRewardTime}}
                // )
                // console.log(pending_vested);
                // console.log(pending_vested._entitled[0].toFixed(0));
                // console.log(pending_vested._vested[0].toFixed(0));
                // console.log(pending_vested._vesting_time.toFixed(0));
            });

            it("Farm end is set", async function() {
                // deposit some dust to update lastRewardTime var
                const tx = await farm_pool.deposit(userTokenWallet1, 1);
                await sleep(1000);
                const last_r_time = await farm_pool.lastRewardTime();
                const tx3 = await farm_pool.setFarmEndTime(last_r_time.plus(5).toFixed(0));
                end_time = last_r_time.plus(2);
            });

            it("Reward is vesting after farm end time", async function() {
                await sleep(2000);
                const reward_data = await farm_pool.pool.call({method: 'calculateRewardData'});
                // console.log(reward_data);
                const _accRewardPerShare = reward_data._accRewardPerShare.map(i => i.toFixed(0));
                const _lastRewardTime = reward_data._lastRewardTime.toFixed(0);

                const pending_vested = await userData1.call({
                    method: 'pendingReward',
                    params: {_accRewardPerShare: _accRewardPerShare, poolLastRewardTime: _lastRewardTime, farmEndTime: end_time.toFixed(0)}}
                )

                await sleep(3000);
                const reward_data_1 = await farm_pool.pool.call({method: 'calculateRewardData'});
                // console.log(reward_data);
                const _accRewardPerShare_1 = reward_data_1._accRewardPerShare.map(i => i.toFixed(0));
                const _lastRewardTime_1 = reward_data_1._lastRewardTime.toFixed(0);


                const pending_vested_1 = await userData1.call({
                    method: 'pendingReward',
                    params: {_accRewardPerShare: _accRewardPerShare_1, poolLastRewardTime: _lastRewardTime_1, farmEndTime: end_time.toFixed(0)}}
                )

                const entitled_before = pending_vested._entitled[0];
                const entitled_after = pending_vested_1._entitled[0];

                const vested_before = pending_vested._vested[0];
                const vested_after = pending_vested_1._vested[0];

                // console.log(entitled_after.toFixed(0), entitled_before.toFixed(0));
                // console.log(vested_after.toFixed(0), vested_before.toFixed(0));
                // console.log(entitled_before > entitled_after, vested_before < vested_after);

                const reward_vested = entitled_before > entitled_after && vested_before < vested_after;
                expect(reward_vested).to.be.eq(true, 'Reward Not vested')

                await farm_pool.withdrawAllTokens(user1);
            });
        });

    });
});