const {
    convertCrystal
} = locklift.utils;

const fs = require('fs')
let deploy_params = JSON.parse(fs.readFileSync('pool_config.json', 'utf-8'))
const BigNumber = require('bignumber.js');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const afterRun = async (tx) => {
    if (locklift.network === 'dev' || locklift.network === 'main') {
        await sleep(100000);
    }
};

const getRandomNonce = () => Math.random() * 64000 | 0;

const stringToBytesArray = (dataString) => {
    return Buffer.from(dataString).toString('hex')
};

async function main() {
    console.log(`Deploying Farm Pool with next params:`);
    console.dir(deploy_params, {depth: null, colors: true});
    const [keyPair] = await locklift.keys.getKeyPairs();

    const fabric = await locklift.factory.getContract(
        'FarmFabric',
        './build'
    );
    fabric.setAddress(deploy_params.fabric);
    fabric.setKeyPair(keyPair);
    delete deploy_params.fabric;

    const Account = await locklift.factory.getAccount('Wallet');
    const admin_user = await locklift.giver.deployContract({
        contract: Account,
        constructorParams: {},
        initParams: {
            _randomNonce: getRandomNonce()
        },
        keyPair,
    }, convertCrystal(11, 'nano'));
    admin_user.setKeyPair(keyPair);
    admin_user.afterRun = afterRun;

    console.log(`Deployed account: ${admin_user.address}`);
    // Wait until account is indexed
    await locklift.ton.client.net.wait_for_collection({
        collection: 'accounts',
        filter: {
            id: { eq: admin_user.address },
            balance: { gt: `0x0` }
        },
        result: 'id',
        timeout: 120000
    });

    await admin_user.runTarget({
        contract: fabric,
        method: 'deployFarmPool',
        params: deploy_params,
        value: convertCrystal(10, 'nano')
    });

    const {
        value: {
            pool: _pool,
            pool_owner: _owner,
            reward_rounds: _reward_rounds,
            tokenRoot: _tokenRoot,
            rewardTokenRoot: _rewardTokenRoot,
            vestingPeriod: _vestingPeriod,
            vestingRatio: _vestingRatio
        }
    } = (await fabric.getEvents('NewFarmPool')).pop();

    console.log(`Farm Pool address: ${_pool}`);
    console.log(`Pool owner ${_owner}`);

    // Wait until farm farm pool is indexed
    await locklift.ton.client.net.wait_for_collection({
        collection: 'accounts',
        filter: {
            id: { eq: _pool },
            balance: { gt: `0x0` }
        },
        result: 'id',
        timeout: 120000
    });

    const _farm_pool = await locklift.factory.getContract(
        'TonFarmPool',
        './build'
    );
    _farm_pool.setAddress(_pool);
    farm_pool = _farm_pool;

    const root = await locklift.factory.getContract(
        'RootTokenContract',
        './node_modules/broxus-ton-tokens-contracts/free-ton/build'
    );
    root.setAddress(deploy_params.tokenRoot);

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

    const farm_pool_details = await farm_pool.call({method: 'getDetails'});
    const farm_pool_wallet_addr = farm_pool_details.tokenWallet;
    console.log(`\nFarm Pool token wallet: ${farm_pool_wallet_addr}`);

    farm_pool_wallet = await locklift.factory.getContract(
        'TONTokenWallet',
        './node_modules/broxus-ton-tokens-contracts/free-ton/build'
    );
    farm_pool_wallet.setAddress(farm_pool_wallet_addr);
    await afterRun();
    // call in order to check if wallet is deployed
    const details = await farm_pool_wallet.call({method: 'getDetails'});
    console.log(`Farm pool token details:`)
    for (let [key, value] of Object.entries(details)) {
        if (key === 'code') continue;
        if (BigNumber.isBigNumber(value)) {
            value = value.toNumber();
        }
        console.log(`${key}: ${value}`);
    }

    const farm_pool_reward_wallet_addrs = farm_pool_details.rewardTokenWallet;
    for (const i of farm_pool_reward_wallet_addrs) {
        console.log(`\nFarm Pool reward token wallet: ${i}`);

        farm_pool_reward_wallet = await locklift.factory.getContract(
            'TONTokenWallet',
            './node_modules/broxus-ton-tokens-contracts/free-ton/build'
        );
        farm_pool_reward_wallet.setAddress(i);

        // call in order to check if wallet is deployed
        // call in order to check if wallet is deployed
        const details2 = await farm_pool_reward_wallet.call({method: 'getDetails'});
        console.log(`Farm pool reward token details:`)
        for (let [key, value] of Object.entries(details2)) {
            if (key === 'code') continue;
            if (BigNumber.isBigNumber(value)) {
                value = value.toNumber();
            }
            console.log(`${key}: ${value}`);
        }
    }

    console.log('\nFarm pool final details:')
    for (let [key, value] of Object.entries(farm_pool_details)) {
        if (key === 'rewardRounds') {
            value.map((val, idx, arr) => {
                console.log(`Reward round ${idx+1} start time: ${val['startTime']}, rewards: ${val['rewardPerSecond']}`)

            })
            continue;
        }
        if (BigNumber.isBigNumber(value)) {
            value = value.toNumber();
        }
        console.log(`${key}: ${value}`);
    }
}


main()
    .then(() => process.exit(0))
    .catch(e => {
        console.log(e);
        process.exit(1);
    });