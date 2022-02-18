const {
    convertCrystal
} = locklift.utils;

const fs = require('fs')
const prompts = require('prompts');
const { isValidTonAddress } = require('../test/utils');


async function main() {

    const PoolFabric = await locklift.factory.getContract('FarmFabricV2');

    const TonFarmPool = await locklift.factory.getContract('EverFarmPoolV2');

    const UserData = await locklift.factory.getContract('UserDataV2');

    console.log('Fabric V2 code:\n', PoolFabric.code, '\n\n');
    console.log('Pool V2 code:\n', TonFarmPool.code, '\n\n');
    console.log('UserData V2 code:\n', UserData.code, '\n\n');
}

main()
    .then(() => process.exit(0))
    .catch(e => {
        console.log(e);
        process.exit(1);
    });