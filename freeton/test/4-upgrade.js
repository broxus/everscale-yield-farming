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
    calcExpectedReward, checkReward,
    FarmPool
} = require('./utils');


describe('Test Ton Farm Pool - upgrade', async function() {
    this.timeout(30000000);

    let user1;
    let user2;
    let admin_user;

    let fabric;
    let root;
    let farming_root_1;
    let farming_root_2;
    let farming_root_3;

    let userTokenWallet1;
    let userTokenWallet2;
    let userTokenWallet3;

    let userData1;
    let userData2;

    let userFarmTokenWallet1_1;
    let userFarmTokenWallet1_2;
    let userFarmTokenWallet1_3;

    let userFarmTokenWallet2_1;
    let userFarmTokenWallet2_2;
    let userFarmTokenWallet2_3;

    let adminFarmTokenWallet_1;
    let adminFarmTokenWallet_2;
    let adminFarmTokenWallet_3;

    let farmStart;
    let farmEnd;
    let rewardPerSec;

    if (locklift.network === 'dev') {
        rewardPerSec = 100000000;
    } else {
        rewardPerSec = 1000000000;
    }
    const minDeposit = 100;
    const userInitialTokenBal = 10000;
    const adminInitialTokenBal = new BigNumber(1e18);

    let farm_pool;
    let farm_pool_wallet;
    let farm_pool_reward_wallet_1;
    let farm_pool_reward_wallet_2;
    let farm_pool_reward_wallet_3;

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
                farming_root_3 = await setupTokenRoot('Reward token 3', 'RT 3', admin_user);
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
                adminFarmTokenWallet_3 = await farming_root_3.mint(adminInitialTokenBal.toFixed(0), admin_user);
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

    describe('Upgrade staking pipeline testing', async function() {
        describe('Farm pool setup', async function() {
            it('Deploy fabric contract', async function () {
                fabric = await setupFabric(admin_user);
            });

            it('Deploy farm pool contract', async function() {
                farmStart = Math.floor(Date.now() / 1000);
                farmEnd = Math.floor(Date.now() / 1000) + 10000;

                farm_pool = await fabric.deployPool({
                    pool_owner: admin_user,
                    reward_rounds: [{startTime: farmStart, rewardPerSecond: [rewardPerSec, rewardPerSec, rewardPerSec]}],
                    tokenRoot: root.address,
                    rewardTokenRoot: [farming_root_1.address, farming_root_2.address, farming_root_3.address],
                    vestingPeriod: 0,
                    vestingRatio: 0,
                    withdrawAllLockPeriod: 0
                });
                farm_pool_wallet = await farm_pool.wallet();
                [farm_pool_reward_wallet_1, farm_pool_reward_wallet_2, farm_pool_reward_wallet_3] = await farm_pool.rewardWallets();
            });

            it('Sending reward tokens to pool', async function() {
                const amount_1 = (farmEnd - farmStart) * rewardPerSec;

                await farm_pool.deposit(adminFarmTokenWallet_1, amount_1);
                await farm_pool.deposit(adminFarmTokenWallet_2, amount_1);
                await farm_pool.deposit(adminFarmTokenWallet_3, amount_1);

                await afterRun();

                const [event_1, event_2, event_3] = await farm_pool.getEvents('RewardDeposit');

                const { value: { amount: _amount_1} } = event_1;
                expect(_amount_1).to.be.equal(amount_1.toFixed(0), 'Bad event');

                const { value: { amount: _amount_2} } = event_2;
                expect(_amount_2).to.be.equal(amount_1.toFixed(0), 'Bad event');

                const { value: { amount: _amount_3} } = event_3;
                expect(_amount_3).to.be.equal(amount_1.toFixed(0), 'Bad event');

                const farm_pool_balance_1 = await farm_pool_reward_wallet_1.balance();
                const details = await farm_pool.details();
                const farm_pool_balances = details.rewardTokenBalance;

                expect(farm_pool_balance_1.toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance empty');
                expect(farm_pool_balances[0].toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance not recognized');

                const farm_pool_balance_2 = await farm_pool_reward_wallet_2.balance();

                expect(farm_pool_balance_2.toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance empty');
                expect(farm_pool_balances[1].toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance not recognized');

                const farm_pool_balance_3 = await farm_pool_reward_wallet_3.balance();

                expect(farm_pool_balance_3.toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance empty');
                expect(farm_pool_balances[2].toFixed(0)).to.be.equal(amount_1.toFixed(0), 'Farm pool balance not recognized');
            });
        });

        describe('Main logic', async function () {
            let unclaimed = [0, 0, 0];

            describe('1st user start farming', async function() {
                it('Deposit tokens', async function() {
                    const tx = await farm_pool.deposit(userTokenWallet1, minDeposit);

                    await checkTokenBalances(
                        userTokenWallet1, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                    );

                    userFarmTokenWallet1_1 = await farming_root_1.wallet(user1);
                    userFarmTokenWallet1_2 = await farming_root_2.wallet(user1);
                    userFarmTokenWallet1_3 = await farming_root_3.wallet(user1);

                    const { value: { user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt } } = (await farm_pool.getEvents('Deposit')).pop();
                    expect(_user).to.be.equal(user1.address, 'Bad event');
                    expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
                });
            });

            describe('Update farm pool and userdata', async function() {
                it('Update farm pool', async function() {
                    const poolV2 = await locklift.factory.getContract('TonFarmPoolV2');
                    const tx = await fabric.installNewFarmPoolCode(poolV2.code);

                    const pool_version_fabric = await fabric.pool_version();
                    expect(pool_version_fabric.toString()).to.be.eq('1', 'Pool version not updated');

                    const old_details = await farm_pool.details();

                    const tx2 = await fabric.upgradePool(farm_pool);
                    await afterRun();

                    const pool_version = await farm_pool.version();
                    expect(pool_version.toString()).to.be.eq('1', 'Pool version not updated');

                    const new_details = await farm_pool.details();

                    for (const [key, value] of Object.entries(new_details)) {
                        const old_value = old_details[key];
                        // console.log(old_value, value);
                    }

                    // up to new abi
                    farm_pool = await FarmPool.from_addr(farm_pool.address, farm_pool.owner, 'TonFarmPoolV2');

                    const { value: { prev_version: _prev_version, new_version: _new_version} } = (await farm_pool.getEvents('PoolUpdated')).pop();
                    expect(_prev_version).to.be.equal('0', 'Bad event');
                    expect(_new_version).to.be.equal('1', 'Bad event');
                });

                it('Update user data', async function() {
                    const UserDataV2 = await locklift.factory.getContract('UserDataV2');
                    const tx = await fabric.installNewUserDataCode(UserDataV2.code);

                    const user_data_version_fabric = await fabric.user_data_version();
                    expect(user_data_version_fabric.toString()).to.be.eq('1', 'User data version not updated');

                    const tx2 = await fabric.updatePoolUserDataCode(farm_pool);
                    await afterRun();

                    const user_data_code_version = await farm_pool.user_data_version();
                    expect(user_data_code_version.toString()).to.be.eq('1', 'User data version not updated');

                    userData1 = await farm_pool.userData(user1);
                    const prev_details = await userData1.call({method: 'getDetails'});

                    const tx3 = await farm_pool.upgradeUserData(user1);
                    await afterRun();

                    userData1 = await farm_pool.userData(user1, 'UserDataV2');

                    const details = await userData1.call({method: 'getDetails'});
                    // console.log(prev_details, details);

                    const { value: { prev_version: _prev_version, new_version: _new_version} } = (await userData1.getEvents('UserDataUpdated')).pop();
                    expect(_prev_version).to.be.equal('0', 'Bad event');
                    expect(_new_version).to.be.equal('1', 'Bad event');
                });
            });

            describe('1st user continue farming (user data was updated)', async function() {
                it('Deposit 2nd time', async function() {
                    const details = await farm_pool.details();
                    const prev_reward_time = details.lastRewardTime;
                    const farmStart = details.rewardRounds[0].startTime;

                    unclaimed[0] += (prev_reward_time - farmStart) * rewardPerSec;
                    unclaimed[1] += (prev_reward_time - farmStart) * rewardPerSec;
                    unclaimed[2] += (prev_reward_time - farmStart) * rewardPerSec;

                    const user1_1_bal_before = await userFarmTokenWallet1_1.balance();
                    const user1_2_bal_before = await userFarmTokenWallet1_2.balance();
                    const user1_3_bal_before = await userFarmTokenWallet1_3.balance();
                    await sleep(2000);

                    const tx = await farm_pool.deposit(userTokenWallet1, minDeposit);
                    await afterRun();
                    await checkTokenBalances(
                        userTokenWallet1, minDeposit * 2, minDeposit * 2, userInitialTokenBal - minDeposit * 2
                    );

                    const details_1 = await farm_pool.details();
                    const new_reward_time = details_1.lastRewardTime;

                    await checkReward(userFarmTokenWallet1_1, user1_1_bal_before, prev_reward_time, new_reward_time, rewardPerSec);
                    await checkReward(userFarmTokenWallet1_2, user1_2_bal_before, prev_reward_time, new_reward_time, rewardPerSec);
                    await checkReward(userFarmTokenWallet1_3, user1_3_bal_before, prev_reward_time, new_reward_time, rewardPerSec);

                    const { value: { user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt } } = (await farm_pool.getEvents('Deposit')).pop();
                    expect(_user).to.be.equal(user1.address, 'Bad event');
                    expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');

                    const unclaimed_reward = details_1.unclaimedReward;
                    // console.log(details_1);
                    expect(unclaimed[0].toFixed(0)).to.be.equal(unclaimed_reward[0].toFixed(0), "Bad unclaimed reward 1");
                    expect(unclaimed[1].toFixed(0)).to.be.equal(unclaimed_reward[1].toFixed(0), "Bad unclaimed reward 2");
                    expect(unclaimed[2].toFixed(0)).to.be.equal(unclaimed_reward[2].toFixed(0), "Bad unclaimed reward 3");

                    const admin_balance_before_1 = await adminFarmTokenWallet_1.balance();
                    const admin_balance_before_2 = await adminFarmTokenWallet_2.balance();
                    const admin_balance_before_3 = await adminFarmTokenWallet_3.balance();

                    await farm_pool.withdrawUnclaimed();
                    await afterRun();

                    const admin_balance_after_1 = await adminFarmTokenWallet_1.balance();
                    const admin_balance_after_2 = await adminFarmTokenWallet_2.balance();
                    const admin_balance_after_3 = await adminFarmTokenWallet_3.balance();

                    const balance_delta_1 = admin_balance_after_1 - admin_balance_before_1;
                    const balance_delta_2 = admin_balance_after_2 - admin_balance_before_2;
                    const balance_delta_3 = admin_balance_after_3 - admin_balance_before_3;

                    expect(balance_delta_1.toFixed(0)).to.be.equal(unclaimed_reward[0].toFixed(0));
                    expect(balance_delta_2.toFixed(0)).to.be.equal(unclaimed_reward[1].toFixed(0));
                    expect(balance_delta_3.toFixed(0)).to.be.equal(unclaimed_reward[2].toFixed(0));

                    unclaimed = [0, 0, 0];
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

                    await checkReward(userFarmTokenWallet1_1, user1_bal_before_1, prev_reward_time, new_reward_time, rewardPerSec);
                    await checkReward(userFarmTokenWallet1_2, user1_bal_before_2, prev_reward_time, new_reward_time, rewardPerSec);

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

                    const reward1 = await checkReward(userFarmTokenWallet1_1, user1_bal_before_1, prev_reward_time.toNumber(), new_reward_time, rewardPerSec);
                    const reward2 = await checkReward(userFarmTokenWallet1_2, user1_bal_before_2, prev_reward_time.toNumber(), new_reward_time, rewardPerSec);

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

                    await checkReward(userFarmTokenWallet1_1, user1_bal_before_11, new_reward_time.toNumber(), new_reward_time_2, rewardPerSec);
                    await checkReward(userFarmTokenWallet1_2, user1_bal_before_22, new_reward_time.toNumber(), new_reward_time_2, rewardPerSec);

                    await checkTokenBalances(
                        userTokenWallet1, 0, 0, userInitialTokenBal
                    );
                    const { value: {
                        user: _user, amount: _amount, reward: _reward1, reward_debt: _reward_debt1
                    } } = (await farm_pool.getEvents('Withdraw')).pop();
                    expect(_user).to.be.equal(user1.address, 'Bad event');
                    expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
                });
            });

            describe('2nd user start farming (user data last version already)', async function() {
                it('Deposit tokens', async function() {
                    const tx = await farm_pool.deposit(userTokenWallet2, minDeposit);

                    await checkTokenBalances(
                        userTokenWallet2, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                    );

                    userFarmTokenWallet2_1 = await farming_root_1.wallet(user2);
                    userFarmTokenWallet2_2 = await farming_root_2.wallet(user2);
                    userFarmTokenWallet2_3 = await farming_root_3.wallet(user2);

                    const { value: { user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt } } = (await farm_pool.getEvents('Deposit')).pop();
                    expect(_user).to.be.equal(user2.address, 'Bad event');
                    expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');

                    userData2 = await farm_pool.userData(user2);
                    const details = await userData2.call({method: 'getDetails'});
                    expect(details.current_version.toString()).to.be.eq('1', 'Bad user data version');
                });

                it('Deposit 2nd time', async function() {
                    const details = await farm_pool.details();
                    const prev_reward_time = details.lastRewardTime;

                    const user2_1_bal_before = await userFarmTokenWallet2_1.balance();
                    const user2_2_bal_before = await userFarmTokenWallet2_2.balance();
                    const user2_3_bal_before = await userFarmTokenWallet2_3.balance();
                    await sleep(2000);

                    const tx = await farm_pool.deposit(userTokenWallet2, minDeposit);
                    await afterRun();
                    await checkTokenBalances(
                        userTokenWallet2, minDeposit * 2, minDeposit * 2, userInitialTokenBal - minDeposit * 2
                    );

                    const details_1 = await farm_pool.details();
                    const new_reward_time = details_1.lastRewardTime;

                    await checkReward(userFarmTokenWallet2_1, user2_1_bal_before, prev_reward_time, new_reward_time, rewardPerSec);
                    await checkReward(userFarmTokenWallet2_2, user2_2_bal_before, prev_reward_time, new_reward_time, rewardPerSec);
                    await checkReward(userFarmTokenWallet2_3, user2_3_bal_before, prev_reward_time, new_reward_time, rewardPerSec);

                    const { value: { user: _user, amount: _amount, reward: _reward, reward_debt: _reward_debt } } = (await farm_pool.getEvents('Deposit')).pop();
                    expect(_user).to.be.equal(user2.address, 'Bad event');
                    expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
                });

                it('User withdraw half of staked amount', async function() {
                    const prev_reward_time = await farm_pool.lastRewardTime();

                    const user2_bal_before_1 = await userFarmTokenWallet2_1.balance();
                    const user2_bal_before_2 = await userFarmTokenWallet2_2.balance();

                    await sleep(2000);

                    const tx = await farm_pool.withdrawTokens(user2, minDeposit);
                    await checkTokenBalances(
                        userTokenWallet2, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                    );

                    const new_reward_time = await farm_pool.lastRewardTime();

                    await checkReward(userFarmTokenWallet2_1, user2_bal_before_1, prev_reward_time, new_reward_time, rewardPerSec);
                    await checkReward(userFarmTokenWallet2_2, user2_bal_before_2, prev_reward_time, new_reward_time, rewardPerSec);

                    const { value: { user: _user, amount: _amount } } = (await farm_pool.getEvents('Withdraw')).pop();
                    expect(_user).to.be.equal(user2.address, 'Bad event');
                    expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
                });

                it('User withdraw other half', async function() {
                    const prev_reward_time = await farm_pool.lastRewardTime();

                    const user2_bal_before_1 = await userFarmTokenWallet2_1.balance();
                    const user2_bal_before_2 = await userFarmTokenWallet2_2.balance();

                    await sleep(1000);

                    // check claim reward func
                    const claim_tx = await farm_pool.claimReward(user2);
                    const new_reward_time = await farm_pool.lastRewardTime();
                    await afterRun();

                    const reward1 = await checkReward(userFarmTokenWallet2_1, user2_bal_before_1, prev_reward_time.toNumber(), new_reward_time, rewardPerSec);
                    const reward2 = await checkReward(userFarmTokenWallet2_2, user2_bal_before_2, prev_reward_time.toNumber(), new_reward_time, rewardPerSec);

                    // funds are not withdrawed
                    await checkTokenBalances(
                        userTokenWallet2, minDeposit, minDeposit, userInitialTokenBal - minDeposit
                    );

                    const { value: {
                        user: _user_0, reward: _reward, reward_debt: _reward_debt
                    } } = (await farm_pool.getEvents('Claim')).pop();
                    expect(_user_0).to.be.equal(user2.address, 'Bad event');
                    expect(_reward[0]).to.be.equal(reward1.toFixed(0), 'Bad event');
                    expect(_reward[1]).to.be.equal(reward2.toFixed(0), 'Bad event');

                    const user2_bal_before_11 = await userFarmTokenWallet2_1.balance();
                    const user2_bal_before_22 = await userFarmTokenWallet2_2.balance();

                    const tx = await farm_pool.withdrawTokens(user2, minDeposit);
                    const new_reward_time_2 = await farm_pool.lastRewardTime();

                    // console.log(user2_bal_before_1.toFixed(0), user2_bal_before_11.toFixed(0), new_reward_time.toNumber(), new_reward_time_2.toNumber());

                    await checkReward(userFarmTokenWallet2_1, user2_bal_before_11, new_reward_time.toNumber(), new_reward_time_2, rewardPerSec);
                    await checkReward(userFarmTokenWallet2_2, user2_bal_before_22, new_reward_time.toNumber(), new_reward_time_2, rewardPerSec);

                    await checkTokenBalances(
                        userTokenWallet2, 0, 0, userInitialTokenBal
                    );
                    const { value: {
                        user: _user, amount: _amount, reward: _reward1, reward_debt: _reward_debt1
                    } } = (await farm_pool.getEvents('Withdraw')).pop();
                    expect(_user).to.be.equal(user2.address, 'Bad event');
                    expect(_amount).to.be.equal(minDeposit.toFixed(0), 'Bad event');
                });
            });
        });

        describe('Additional upgrade hooks', async function() {
           it('Install new codes to fabric', async function() {
               const poolV2 = await locklift.factory.getContract('TonFarmPoolV2');
               const tx = await fabric.installNewFarmPoolCode(poolV2.code);

               const pool_version_fabric = await fabric.pool_version();
               expect(pool_version_fabric.toString()).to.be.eq('2', 'Pool version not updated');

               const UserDataV2 = await locklift.factory.getContract('UserDataV2');
               const tx2 = await fabric.installNewUserDataCode(UserDataV2.code);

               const user_data_version_fabric = await fabric.user_data_version();
               expect(user_data_version_fabric.toString()).to.be.eq('2', 'User data version not updated');
           });

           it('Request upgrade of farm pool', async function() {
               const old_details = await farm_pool.details();

               const tx = await farm_pool.requestUpgradePool();
               await afterRun();

               const pool_version = await farm_pool.version();
               expect(pool_version.toString()).to.be.eq('2', 'Pool version not updated');

               const new_details = await farm_pool.details();

               for (const [key, value] of Object.entries(new_details)) {
                   const old_value = old_details[key];
                   // console.log(old_value, value);
               }

               // up to new abi
               farm_pool = await FarmPool.from_addr(farm_pool.address, farm_pool.owner, 'TonFarmPoolV2');

               const { value: { prev_version: _prev_version, new_version: _new_version} } = (await farm_pool.getEvents('PoolUpdated')).pop();
               expect(_prev_version).to.be.equal('1', 'Bad event');
               expect(_new_version).to.be.equal('2', 'Bad event');
           });

           it('Request update of user data code', async function() {
               await farm_pool.requestUpdateUserDataCode();
               await afterRun();

               const user_data_code_version = await farm_pool.user_data_version();
               expect(user_data_code_version.toString()).to.be.eq('2', 'User data version not updated');
           });
        });
    });
});