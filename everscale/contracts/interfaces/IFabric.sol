pragma ton-solidity ^0.57.1;
pragma AbiHeader expire;


import "./ITonFarmPool.sol";


interface IFabric {
    function onPoolDeploy(
        uint64 pool_deploy_nonce,
        address pool_owner,
        ITonFarmPool.RewardRound[] reward_rounds,
        address tokenRoot,
        address[] rewardTokenRoot,
        uint32 vestingPeriod,
        uint32 vestingRatio,
        uint32 withdrawAllLockPeriod
    ) external;
    function processUpgradePoolRequest(address send_gas_to) external;
    function processUpdatePoolUserDataRequest(address send_gas_to) external;
}
