const {
    convertCrystal
} = locklift.utils;

const fs = require('fs')
let deploy_params = JSON.parse(fs.readFileSync('../deploy_config.json', 'utf-8'))
const BigNumber = require('bignumber.js');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const getRandomNonce = () => Math.random() * 64000 | 0;

const stringToBytesArray = (dataString) => {
    return Buffer.from(dataString).toString('hex')
};

async function main() {

    console.log(`Deploying Farm Pool with next params:`);
    console.dir(deploy_params, {depth: null, colors: true});
    const TonFarmPool = await locklift.factory.getContract(
        'TonFarmPool',
        './build'
    );

    const UserData = await locklift.factory.getContract(
        'UserData',
        './build'
    );

    const root = await locklift.factory.getContract(
        'RootTokenContract',
        './node_modules/broxus-ton-tokens-contracts/free-ton/build'
    );
    root.setAddress(deploy_params._lpTokenRoot);

    [keyPair] = await locklift.keys.getKeyPairs();

    farm_pool = await locklift.giver.deployContract({
        contract: TonFarmPool,
        constructorParams: deploy_params,
        initParams: {
            userDataCode: UserData.code
        },
        keyPair,
    }, convertCrystal(3, 'nano'));

    console.log(`Farm Pool address: ${farm_pool.address}`);

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
    await sleep(20000);
    const farm_pool_wallet_addr = await farm_pool.call({method: 'lpTokenWallet'});
    console.log(`Farm Pool token wallet: ${farm_pool_wallet_addr}`);

    farm_pool_wallet = await locklift.factory.getContract(
        'TONTokenWallet',
        './node_modules/broxus-ton-tokens-contracts/free-ton/build'
    );
    farm_pool_wallet.setAddress(farm_pool_wallet_addr);
    await sleep(80000);
    // call in order to check if wallet is deployed
    const details = await farm_pool_wallet.call({method: 'getDetails'});
    console.log(`Contract details:`)
    for (let [key, value] of Object.entries(details)) {
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