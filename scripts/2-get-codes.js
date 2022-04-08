const {
    convertCrystal
} = locklift.utils;

const fs = require('fs')
const prompts = require('prompts');
const { isValidTonAddress } = require('../test/utils');


async function main() {

    const PoolFabric = await locklift.factory.getContract('FarmFabricV3');

    const TonFarmPool = await locklift.factory.getContract('EverFarmPoolV3');

    const UserData = await locklift.factory.getContract('UserDataV3');

    console.log('Fabric V3 code:\n', PoolFabric.code, '\n\n');
    console.log('Pool V3 code:\n', TonFarmPool.code, '\n\n');
    console.log('UserData V3 code:\n', UserData.code, '\n\n');
}

main()
    .then(() => process.exit(0))
    .catch(e => {
        console.log(e);
        process.exit(1);
    });