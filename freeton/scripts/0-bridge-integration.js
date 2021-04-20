const logger = require('mocha-logger');
const fs = require('fs');
const BigNumber = require('bignumber.js');
BigNumber.config({ EXPONENTIAL_AT: 257 });

const stringToBytesArray = (dataString) => {
  return Buffer.from(dataString).toString('hex')
};


const getRandomNonce = () => Math.random() * 64000 | 0;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const afterRun = async (tx) => {
  if (locklift.network === 'dev' || locklift.network === 'main') {
    await sleep(60000);
  }
};


const {
  utils: {
    convertCrystal
  }
} = locklift;


let tx;

const logTx = (tx) => logger.success(`Transaction: ${tx.transaction.id}`);


const data = {
  bridge: '0:fe823b5e869ab06396ae5cdf798cac3cd5eb90e2ae379a20b37ce93573b30277',
  ethereumEvent: {
    eventAddress: new BigNumber('0x0758e8FFa90843292B19b81214d3789b19e19F38'.toLowerCase()),
    eventBlocksToConfirm: 1,
    // Apr-18-2021 06:22:26 PM +UTC
    startBlockNumber: 12265670,
  },
  tonEvent: {
    proxyAddress: new BigNumber('0x0758e8FFa90843292B19b81214d3789b19e19F38'.toLowerCase()),
    // Sun Apr 18 2021 21:23:18 GMT+0300 (Moscow Standard Time)
    startTimestamp: 1618770198,
  },
  multisig: '0:ad091843febdbaf72308bf9c45067817e254965c28a692b5c4187f8c7fab6c81',
};


async function main() {
  logger.log(`Giver balance: ${convertCrystal(await locklift.ton.getBalance(locklift.networkConfig.giver.address), 'ton')}`);

  const [keyPair] = await locklift.keys.getKeyPairs();
  
  logger.log(`Deploying owner`);
  
  const Account = await locklift.factory.getAccount();
  
  const owner = await locklift.giver.deployContract({
    contract: Account,
    constructorParams: {},
    initParams: {
      _randomNonce: getRandomNonce(),
    },
    keyPair,
  }, locklift.utils.convertCrystal(30, 'nano'));
  
  owner.setKeyPair(keyPair);
  owner.afterRun = afterRun;
  
  logger.success(`Owner: ${owner.address}`);
  
  logger.log(`Deploying cell encoder`);
  
  const CellEncoder = await locklift.factory.getContract(
    'CellEncoder',
    './../node_modules/ethereum-freeton-bridge-contracts/free-ton/build'
  );
  
  const cellEncoder = await locklift.giver.deployContract({
    contract: CellEncoder,
    constructorParams: {},
    initParams: {
      _randomNonce: getRandomNonce(),
    },
    keyPair,
  });
  
  logger.success(`Cell encoder: ${cellEncoder.address}`);
  
  logger.log(`Deploying token event proxy`);
  
  const TokenEventProxy = await locklift.factory.getContract(
    'TokenEventProxy',
    './../node_modules/broxus-ton-tokens-contracts/free-ton/build'
  );
  
  const EthereumEvent = await locklift.factory.getContract(
    'EthereumEvent',
    './../node_modules/ethereum-freeton-bridge-contracts/free-ton/build/'
  );
  
  const tokenEventProxy = await locklift.giver.deployContract({
    contract: TokenEventProxy,
    constructorParams: {
      external_owner_pubkey_: 0,
      internal_owner_address_: owner.address,
    },
    initParams: {
      _randomNonce: getRandomNonce(),
      ethereum_event_code: EthereumEvent.code,
      outdated_token_roots: []
    },
    keyPair
  });
  
  tokenEventProxy.setKeyPair(keyPair);
  
  logger.success(`Token event proxy: ${tokenEventProxy.address}`);
  
  logger.log(`Deploying LP token`);
  
  const RootToken = await locklift.factory.getContract(
    'RootTokenContract',
    './../node_modules/broxus-ton-tokens-contracts/free-ton/build'
  );
  
  const TokenWallet = await locklift.factory.getContract(
    'TONTokenWallet',
    './../node_modules/broxus-ton-tokens-contracts/free-ton/build'
  );
  
  const root = await locklift.giver.deployContract({
    contract: RootToken,
    constructorParams: {
      root_public_key_: `0x0`,
      root_owner_address_: tokenEventProxy.address
    },
    initParams: {
      name: stringToBytesArray('Uniswap V2: USDT-WTON'),
      symbol: stringToBytesArray('UNI-V2-USDT-WTON'),
      decimals: 18,
      wallet_code: TokenWallet.code,
      _randomNonce: getRandomNonce(),
    },
    keyPair,
  });
  
  root.afterRun = afterRun;
  
  logger.success(`LP token root: ${root.address}`);
  
  logger.log(`Deploying ethereum event configuration`);
  
  const eventMeta = await cellEncoder.call({
    method: 'encodeConfigurationMeta',
    params: {
      rootToken: root.address,
    }
  });
  
  logger.log(`Ethereum / TON event meta: ${eventMeta}`);
  
  const EthereumEventConfiguration = await locklift.factory.getContract(
    'EthereumEventConfiguration',
    './../node_modules/ethereum-freeton-bridge-contracts/free-ton/build'
  );
  
  const [ethereumEventAbi] = JSON
    .parse(fs.readFileSync('./../ethereum/abi/ProxyTokenLock.json').toString())
    .filter(f => f.name === 'TokenLock' && f.type === 'event');
  
  logger.log(`Ethereum event ABI: ${JSON.stringify(ethereumEventAbi)}`);
  
  const ethereumEventConfiguration = await locklift.giver.deployContract({
    contract: EthereumEventConfiguration,
    constructorParams: {},
    initParams: {
      basicInitData: {
        eventABI: stringToBytesArray(JSON.stringify(ethereumEventAbi)),
        eventRequiredConfirmations: 2,
        eventRequiredRejects: 2,
        eventCode: EthereumEvent.code,
        bridgeAddress: data.bridge,
        eventInitialBalance: convertCrystal('10', 'nano'),
        meta: eventMeta
      },
      initData: {
        proxyAddress: tokenEventProxy.address,
        ...data.ethereumEvent
      }
    },
    keyPair,
  }, convertCrystal(50, 'nano'));
  
  logger.success(`Ethereum event configuration: ${ethereumEventConfiguration.address}`);
  
  logger.log(`Deploying TON event configuration`);
  
  const TonEventConfiguration = await locklift.factory.getContract(
    'TonEventConfiguration',
    './../node_modules/ethereum-freeton-bridge-contracts/free-ton/build'
  );
  
  const TonEvent = await locklift.factory.getContract(
    'TonEvent',
    './../node_modules/ethereum-freeton-bridge-contracts/free-ton/build'
  );
  
  const [tonEventABI] = JSON
    .parse(fs.readFileSync('./../freeton/build/TokenEventProxy.abi.json').toString())
    .events
    .filter(f => f.name === 'TokenBurn');
  
  logger.log(`TON event ABI: ${JSON.stringify(tonEventABI)}`);
  
  const tonEventConfiguration = await locklift.giver.deployContract({
    contract: TonEventConfiguration,
    constructorParams: {},
    initParams: {
      basicInitData: {
        eventABI: stringToBytesArray(JSON.stringify(tonEventABI)),
        eventRequiredConfirmations: 2,
        eventRequiredRejects: 2,
        eventCode: TonEvent.code,
        bridgeAddress: data.bridge,
        eventInitialBalance: convertCrystal('10', 'nano'),
        meta: eventMeta
      },
      initData: {
        eventAddress: tokenEventProxy.address,
        ...data.tonEvent,
      }
    },
    keyPair,
  }, convertCrystal(50, 'nano'));
  
  logger.success(`Ton event configuration: ${tonEventConfiguration.address}`);
  
  logger.log(`Setting up token event proxy root`);
  
  tx = await owner.runTarget({
    contract: tokenEventProxy,
    method: 'setTokenRootAddressOnce',
    params: {
      value: root.address
    },
  });
  
  logTx(tx);
  
  logger.log(`Setting up ethereum event public key`);
  
  tx = await owner.runTarget({
    contract: tokenEventProxy,
    method: 'setEthEventDeployPubkeyOnce',
    params: {
      value: `0x${keyPair.public}`,
    }
  });
  
  logTx(tx);
  
  logger.log(`Setting up ethereum event configuration address`);
  
  tx = await owner.runTarget({
    contract: tokenEventProxy,
    method: 'setEthEventConfigAddressOnce',
    params: {
      value: ethereumEventConfiguration.address
    }
  });
  
  logTx(tx);
  
  logger.log(`Transferring token event ownership to multisig`);
  
  tx = await owner.runTarget({
    contract: tokenEventProxy,
    method: 'transferOwner',
    params: {
      external_owner_pubkey_: 0,
      internal_owner_address_: data.multisig
    }
  });
  
  logTx(tx);
  
  // TODO: root meta setup
  const RootMetaFactory = await locklift.factory.getContract(
    'RootMetaFactory',
    './../node_modules/wton/freeton/build'
  );
  const rootMeta = await locklift.factory.getContract(
    'RootMeta',
    './../node_modules/wton/freeton/build'
  );
  
  const rootMetaFactory = await locklift.giver.deployContract({
    contract: RootMetaFactory,
    constructorParams: {
      code_: rootMeta.code,
    },
    initParams: {
      _randomNonce: getRandomNonce(),
    },
    keyPair,
  }, locklift.utils.convertCrystal(10, 'nano'));
  
  logger.success(`Root meta factory: ${rootMetaFactory.address}`);
  
  logger.log(`Setting up root meta for ${root.address}`);
  
  tx = await owner.runTarget({
    contract: rootMetaFactory,
    method: 'deploy',
    params: {
      owner: owner.address,
      root: root.address
    }
  });
  
  logger.log(`Deploy root meta tx: ${tx.transaction.id}`);
  
  const rootMetaAddress = await rootMetaFactory.call({
    method: 'deploy',
    params: {
      owner: owner.address,
      root: root.address
    }
  });
  
  logger.success(`Root meta address: ${rootMetaAddress}`);
  
  const encodedEventProxy = await cellEncoder.call({
    method: 'encodeConfigurationMeta',
    params: {
      rootToken: tokenEventProxy.address,
    }
  });
  
  logger.log(`Encoded event proxy: ${encodedEventProxy}`);
  
  // Set meta
  rootMeta.setAddress(rootMetaAddress);
  
  await owner.runTarget({
    contract: rootMeta,
    method: 'setValue',
    params: {
      key: 0,
      value: encodedEventProxy,
    }
  });
  
  logger.log(`Transferring root meta ownership`);
  
  tx = await owner.runTarget({
    contract: rootMeta,
    method: 'transferOwnership',
    params: {
      owner_: data.multisig
    }
  });
  
  logger.success(`Transfer root meta ownership tx: ${tx.transaction.id}`);
  
  logger.log(`Giver balance: ${convertCrystal(await locklift.ton.getBalance(locklift.networkConfig.giver.address), 'ton')}`);
}


main()
  .then(() => process.exit(0))
  .catch(e => {
    console.log(e);
    process.exit(1);
  });
