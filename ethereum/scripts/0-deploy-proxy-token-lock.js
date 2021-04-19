const hre = require("hardhat");

const bridge = '0xAA5f2fc251b1387F8b828eD66d4508215B1b6ee7';

async function main() {
  const ProxyTokenLock = await hre.ethers.getContractFactory('ProxyTokenLock');

  const [{
    address: deployer
  }] = await ethers.getSigners();

  console.log(`Deployer: ${deployer} (${(await web3.eth.getBalance(deployer))})`);

  const proxyTokenLock = await hre.upgrades.deployProxy(
    ProxyTokenLock,
    [
      [
        '0x5811ec00d774de2c72a51509257d50d1305358aa',
        bridge,
        true,
        2,
        [0, 1000]
      ],
      '0xFaD2C3B926A2751aa27b4B24AcBAc3B13EED9771'
    ],
  );

  console.log(`Proxy token lock: ${proxyTokenLock.address}`);
  
  const admin = await hre.upgrades.admin.getInstance();
  console.log(`Proxy admin: ${admin.address}`);
  
  console.log(`Deployer: ${deployer} (${(await web3.eth.getBalance(deployer))})`);
}


main()
  .then(() => process.exit(0))
  .catch(e => {
    console.log(e);
    process.exit(1);
  });
