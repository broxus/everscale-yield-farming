const {
    convertCrystal
} = locklift.utils;

const fs = require('fs')
const prompts = require('prompts');
const { isValidTonAddress } = require('../test/utils');


async function main() {
    const response = await prompts([
        {
            type: 'text',
            name: 'owner',
            message: 'Fabric owner (can upgrade pool/user data codes)',
            validate: value => isValidTonAddress(value) ? true : 'Invalid address'
        },
        {
            type: 'number',
            name: 'version',
            message: 'Fabric version',
            validate: value => value <= 1
        },
    ]);

    console.log(`Deploying Farm Pool with owner: ${response.owner}`)

    let PoolFabric, TonFarmPool, UserData;
    if (response.version === 1) {
        PoolFabric = await locklift.factory.getContract('FarmFabricV2');
        TonFarmPool = await locklift.factory.getContract('EverFarmPoolV2');
        UserData = await locklift.factory.getContract('UserDataV2');
    } else {
        PoolFabric = await locklift.factory.getContract('FarmFabric');
        TonFarmPool = await locklift.factory.getContract('EverFarmPool');
        UserData = await locklift.factory.getContract('UserData');
    }

    const Platform = await locklift.factory.getContract('Platform');

    const [keyPair] = await locklift.keys.getKeyPairs();

    const fabric = await locklift.giver.deployContract({
        contract: PoolFabric,
        constructorParams: { _owner: response.owner },
        initParams: {
            FarmPoolCode: TonFarmPool.code,
            FarmPoolUserDataCode: UserData.code,
            PlatformCode: Platform.code,
            nonce: locklift.utils.getRandomNonce()
        },
        keyPair,
    }, convertCrystal(2, 'nano'));

    // Wait until farm token wallet is indexed
    await locklift.ton.client.net.wait_for_collection({
        collection: 'accounts',
        filter: {
            id: { eq: fabric.address },
            balance: { gt: `0x0` }
        },
        result: 'id'
    });

    const {
        acc_type_name
    } = await locklift.ton.getAccountType(fabric.address);

    console.log(`Fabric account state - ${acc_type_name}`)
    console.log(`Pool Fabric address: ${fabric.address}`);
}

main()
    .then(() => process.exit(0))
    .catch(e => {
        console.log(e);
        process.exit(1);
    });