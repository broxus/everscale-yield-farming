const {
    convertCrystal
} = locklift.utils;

const fs = require('fs')
const prompts = require('prompts');
const { isValidTonAddress } = require('../test/utils');


async function main() {
    const response = await prompts({
        type: 'text',
        name: 'owner',
        message: 'Fabric owner (can upgrade pool/user data codes)',
        validate: value => isValidTonAddress(value) ? true : 'Invalid address'
    });

    console.log(`Deploying Farm Pool with owner: ${response.owner}`)

    const PoolFabric = await locklift.factory.getContract('FarmFabric');

    const TonFarmPool = await locklift.factory.getContract('EverFarmPool');

    const UserData = await locklift.factory.getContract('UserData');

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