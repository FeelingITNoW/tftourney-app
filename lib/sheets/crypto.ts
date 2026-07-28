import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyBytes(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptGoogleRefreshToken(token: string, encryptionKey: string): string {
  if (!encryptionKey) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is required.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((value) => value.toString("base64url")).join(".");
}

export function decryptGoogleRefreshToken(encrypted: string, encryptionKey: string): string {
  if (!encryptionKey) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is required.");
  const [ivValue, tagValue, ciphertextValue] = encrypted.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Invalid encrypted Google token.");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(encryptionKey), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
}
