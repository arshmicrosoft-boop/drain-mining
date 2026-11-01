/** Multicall3 is deployed at the same address on Ethereum, L2s and most testnets. */
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
  'function getEthBalance(address addr) view returns (uint256 balance)',
];

export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];
