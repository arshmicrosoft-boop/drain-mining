import { ethers } from 'ethers';

/** Derive the checksummed address for a private key without touching the network. */
export const deriveAddress = (privateKey: string): string => ethers.utils.computeAddress(privateKey);
