pragma ton-solidity ^0.39.0;
pragma AbiHeader expire;


interface IFabric {
    function onPoolDeploy(
        uint64 pool_deploy_nonce,
        address pool_owner,
        uint256[] rewardPerSecond,
        uint256 farmStartTime,
        uint256 farmEndTime,
        address tokenRoot,
        address[] rewardTokenRoot
    ) external;
}
