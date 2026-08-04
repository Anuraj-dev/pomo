import { schnorr, utils } from "noble-secp256k1";
import { bytesToHex, hexToBytes, isLowerHex } from "../shared/hex";

export interface Identity {
  privateKey: string;
  publicKey: string;
}

export function generateIdentity(): Identity {
  const privateKey = utils.randomPrivateKey();
  const publicKey = schnorr.getPublicKey(privateKey);
  return { privateKey: bytesToHex(privateKey), publicKey: bytesToHex(publicKey) };
}

export function publicKeyOf(privateKeyHex64: string): string {
  if (!isLowerHex(privateKeyHex64, 64)) throw new Error("publicKeyOf requires a 64-char lowercase hex private key");
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privateKeyHex64)));
}

export async function signSchnorr(messageHashHex64: string, privateKeyHex64: string): Promise<string> {
  if (!isLowerHex(messageHashHex64, 64) || !isLowerHex(privateKeyHex64, 64)) {
    throw new Error("signSchnorr requires 64 lowercase hex message and private key");
  }
  const signature = await schnorr.sign(hexToBytes(messageHashHex64), hexToBytes(privateKeyHex64));
  return bytesToHex(signature);
}

export async function verifySchnorr(
  messageHashHex64: string,
  signatureHex128: string,
  publicKeyHex64: string,
): Promise<boolean> {
  if (!isLowerHex(messageHashHex64, 64) || !isLowerHex(signatureHex128, 128) || !isLowerHex(publicKeyHex64, 64)) {
    return false;
  }
  try {
    return await schnorr.verify(hexToBytes(signatureHex128), hexToBytes(messageHashHex64), hexToBytes(publicKeyHex64));
  } catch {
    return false;
  }
}

export function fingerprint(publicKeyHex64: string): string {
  return publicKeyHex64.slice(-8);
}
