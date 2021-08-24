pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;


interface IFabric {
    function onPoolDeploy(
        uint64 pool_deploy_nonce,
        address pool_owner,
        uint128[] rewardPerSecond,
        uint32 farmStartTime,
        uint32 farmEndTime,
        address tokenRoot,
        address[] rewardTokenRoot
    ) external;
}
