pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;


import "./ITonFarmPool.sol";


interface IFabric {
    function onPoolDeploy(
        uint64 pool_deploy_nonce,
        address pool_owner,
        ITonFarmPool.RewardRound[] reward_rounds,
        address tokenRoot,
        address[] rewardTokenRoot
    ) external;
}
