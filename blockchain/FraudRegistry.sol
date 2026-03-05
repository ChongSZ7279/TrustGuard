// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FraudRegistry {
    struct FraudReport {
        bytes32 txHash;
        uint256 riskScoreBps;
        uint256 timestamp;
    }

    FraudReport[] private _reports;

    event FraudReported(bytes32 indexed txHash, uint256 riskScoreBps, uint256 timestamp, address indexed reporter);

    function reportFraud(bytes32 transactionHash, uint256 riskScoreBps) external {
        require(transactionHash != bytes32(0), "invalid hash");
        require(riskScoreBps <= 10_000, "score out of range");

        _reports.push(FraudReport({txHash: transactionHash, riskScoreBps: riskScoreBps, timestamp: block.timestamp}));

        emit FraudReported(transactionHash, riskScoreBps, block.timestamp, msg.sender);
    }

    function getFraudReports() external view returns (FraudReport[] memory) {
        return _reports;
    }
}

