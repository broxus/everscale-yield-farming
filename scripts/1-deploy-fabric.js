const {
    convertCrystal
} = locklift.utils;

const fs = require('fs')
let deploy_params = JSON.parse(fs.readFileSync('fabric_config.json', 'utf-8'))


async function main() {
    console.log(`Deploying Farm Pool with next params:`);
    console.dir(deploy_params, {depth: null, colors: true});

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

    const Platform = await locklift.factory.getContract('Platform');

    const [keyPair] = await locklift.keys.getKeyPairs();

    fabric = await locklift.giver.deployContract({
        contract: PoolFabric,
        constructorParams: deploy_params,
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