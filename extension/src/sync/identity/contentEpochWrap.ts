import { utf8ToBytes } from "../../shared/bytes";
import { openHpkeBase, sealHpkeBase } from "../crypto/PomoCrypto";
import { contentEpochAad, type ContentRecipient } from "./MemberIdentity";
import type { ContentEpochWrap } from "./types";

export const CONTENT_EPOCH_INFO = utf8ToBytes("content-epoch");

export async function wrapContentEpochKey(input: {
  readonly memberId: string;
  readonly contentEpoch: number;
  readonly authorizationFrontierHash: string;
  readonly contentKey: Uint8Array;
  readonly recipient: ContentRecipient;
  readonly recipientPublicKey: CryptoKey;
}): Promise<ContentEpochWrap> {
  if (input.contentKey.length !== 32) throw new Error("content epoch key must be 32 bytes");
  const aad = contentEpochAad(
    input.memberId,
    input.contentEpoch,
    input.authorizationFrontierHash,
    { recipientType: input.recipient.recipientType, recipientId: input.recipient.recipientId },
  );
  const sealed = await sealHpkeBase(input.recipientPublicKey, input.contentKey, CONTENT_EPOCH_INFO, aad);
  return {
    recipientKind: input.recipient.recipientType === "DEVICE" ? "DEVICE" : "RECOVERY",
    recipientId: input.recipient.recipientId,
    encapsulatedKey: sealed.encapsulatedKey,
    ciphertext: sealed.ciphertext,
  };
}

export async function openContentEpochKey(input: {
  readonly memberId: string;
  readonly contentEpoch: number;
  readonly authorizationFrontierHash: string;
  readonly wrap: ContentEpochWrap;
  readonly recipient: ContentRecipient;
  readonly recipientKey: CryptoKey | CryptoKeyPair;
}): Promise<Uint8Array> {
  const aad = contentEpochAad(
    input.memberId,
    input.contentEpoch,
    input.authorizationFrontierHash,
    { recipientType: input.recipient.recipientType, recipientId: input.recipient.recipientId },
  );
  return openHpkeBase(
    input.recipientKey,
    { encapsulatedKey: input.wrap.encapsulatedKey, ciphertext: input.wrap.ciphertext },
    CONTENT_EPOCH_INFO,
    aad,
  );
}
