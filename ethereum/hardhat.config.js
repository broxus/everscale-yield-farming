require('hardhat-abi-exporter');
require("@nomiclabs/hardhat-web3");
require('@openzeppelin/hardhat-upgrades');
require("@nomiclabs/hardhat-etherscan");


/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.7.3",
  abiExporter: {
    path: './abi',
    clear: true,
    flat: true,
    spacing: 2
  }
};
