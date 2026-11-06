import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { ApiError } from "./core.js";
function configured(name) {
  const value = process.env[name]?.trim();
  return value && value.length >= 32 ? value : null;
}
export function vaultConfigured() {
  return Boolean(
    configured("LICENSE_ENCRYPTION_KEY") || configured("ADMIN_TOKEN"),
  );
}
function derive(value, version) {
  const hash = createHash("sha256");
  if (version === "a1") hash.update("ModPDT/license-vault/a1\0");
  return hash.update(value).digest();
}
export function sealKey(key, id) {
  const explicit = configured("LICENSE_ENCRYPTION_KEY");
  const value = explicit || configured("ADMIN_TOKEN");
  if (!value) throw new ApiError(503, "KEY_STORAGE_NOT_CONFIGURED");
  const version = explicit ? "v1" : "a1";
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", derive(value, version), iv);
  cipher.setAAD(Buffer.from(id));
  const data = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return [
    version,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(".");
}
export function openKey(envelope, id) {
  if (!vaultConfigured()) throw new ApiError(503, "KEY_STORAGE_NOT_CONFIGURED");
  const [version, iv, tag, data, ...extra] = envelope.split(".");
  if (!["v1", "a1"].includes(version) || extra.length || !iv || !tag || !data)
    throw new ApiError(503, "KEY_DECRYPTION_FAILED");
  // Keep previously issued v1 keys readable. Automatic envelopes can also be pinned
  // to the old admin secret via the optional dedicated key before admin rotation.
  const candidates =
    version === "v1"
      ? [configured("LICENSE_ENCRYPTION_KEY")]
      : [configured("LICENSE_ENCRYPTION_KEY"), configured("ADMIN_TOKEN")];
  for (const value of new Set(candidates.filter(Boolean))) {
    try {
      const cipher = createDecipheriv(
        "aes-256-gcm",
        derive(value, version),
        Buffer.from(iv, "base64"),
      );
      cipher.setAAD(Buffer.from(id));
      cipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([
        cipher.update(Buffer.from(data, "base64")),
        cipher.final(),
      ]).toString("utf8");
    } catch {
      /* Try only configured server-side sources; never expose cryptographic details. */
    }
  }
  throw new ApiError(503, "KEY_DECRYPTION_FAILED");
}
