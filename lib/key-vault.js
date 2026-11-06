import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { ApiError } from "./core.js";
export function vaultConfigured() {
  return (
    typeof process.env.LICENSE_ENCRYPTION_KEY === "string" &&
    process.env.LICENSE_ENCRYPTION_KEY.trim().length >= 32
  );
}
function secret() {
  if (!vaultConfigured()) throw new ApiError(503, "KEY_STORAGE_NOT_CONFIGURED");
  return createHash("sha256")
    .update(process.env.LICENSE_ENCRYPTION_KEY.trim())
    .digest();
}
export function sealKey(key, id) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", secret(), iv);
  cipher.setAAD(Buffer.from(id));
  const data = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(".");
}
export function openKey(envelope, id) {
  const encryptionKey = secret();
  try {
    const [version, iv, tag, data, ...extra] = envelope.split(".");
    if (version !== "v1" || extra.length || !iv || !tag || !data) throw Error();
    const cipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(iv, "base64"),
    );
    cipher.setAAD(Buffer.from(id));
    cipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      cipher.update(Buffer.from(data, "base64")),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ApiError(503, "KEY_DECRYPTION_FAILED");
  }
}
