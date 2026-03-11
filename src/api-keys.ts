import { createHash, randomBytes } from "node:crypto";

const PUBLIC_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PUBLIC_ID_LENGTH = 8;
const SECRET_BYTES = 32;

export function hashApiKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generatePublicId(): string {
  const bytes = randomBytes(PUBLIC_ID_LENGTH);
  let publicId = "";

  for (let index = 0; index < PUBLIC_ID_LENGTH; index += 1) {
    publicId += PUBLIC_ID_ALPHABET[bytes[index]! % PUBLIC_ID_ALPHABET.length];
  }

  return publicId;
}

export function generateApiKey(): {
  key: string;
  publicId: string;
  keyHash: string;
} {
  const publicId = generatePublicId();
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const key = `${publicId}_${secret}`;

  return {
    key,
    publicId,
    keyHash: hashApiKey(key),
  };
}

export function getPublicIdFromApiKey(value: string): string | null {
  const underscoreIndex = value.indexOf("_");
  if (underscoreIndex <= 0) {
    return null;
  }

  const publicId = value.slice(0, underscoreIndex).trim();
  const secret = value.slice(underscoreIndex + 1).trim();

  if (!isValidPublicId(publicId) || secret.length === 0) {
    return null;
  }

  return publicId;
}

export function isValidPublicId(value: string): boolean {
  return /^[a-z0-9]{8}$/.test(value);
}
