import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}
export function adminTokenConfigured(token = process.env.ADMIN_TOKEN) {
  return typeof token === "string" && token.trim().length >= 32;
}
export function adminAuthorized(header, token = process.env.ADMIN_TOKEN) {
  if (!adminTokenConfigured(token) || typeof header !== "string") return false;
  return timingSafeEqual(
    Buffer.from(hash(header)),
    Buffer.from(hash(`Bearer ${token.trim()}`)),
  );
}
export function newLicense(input) {
  const { label = "", durationDays = 30, maxDevices = 1 } = input;
  if (
    typeof label !== "string" ||
    label.trim().length > 120 ||
    !Number.isInteger(durationDays) ||
    durationDays < 1 ||
    durationDays > 3650 ||
    !Number.isInteger(maxDevices) ||
    maxDevices < 1 ||
    maxDevices > 100
  )
    throw new ApiError(400, "INVALID_INPUT");
  const key = `NRO-${randomBytes(24).toString("hex").toUpperCase()}`;
  return {
    id: randomUUID(),
    key,
    keyHash: hash(key),
    label: label.trim(),
    durationDays,
    maxDevices,
  };
}
export async function verifyLicense(db, input, activate = false) {
  const { key, deviceId, platform } = input;
  if (
    typeof key !== "string" ||
    !/^NRO-[A-Fa-f0-9]{48}$/.test(key) ||
    typeof deviceId !== "string" ||
    deviceId.length < 16 ||
    deviceId.length > 256 ||
    !["pc", "android", "ios"].includes(platform)
  )
    throw new ApiError(400, "INVALID_INPUT");
  if (!activate) {
    const {
      rows: [result],
    } = await db.query(
      `WITH license AS (
    SELECT id,expires_at,revoked_at FROM licenses WHERE key_hash=$1
  ), seen AS (
    UPDATE devices d SET last_seen=now() FROM license l
    WHERE d.license_id=l.id AND d.device_hash=$2 AND l.revoked_at IS NULL AND l.expires_at>now()
    RETURNING l.expires_at
  ) SELECT (SELECT expires_at FROM seen LIMIT 1) AS expires_at,now() AS server_time,
    CASE WHEN EXISTS(SELECT 1 FROM seen) THEN NULL
    WHEN EXISTS(SELECT 1 FROM license WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())) THEN 'ACTIVATION_REQUIRED'
    ELSE 'LICENSE_INVALID' END AS error_code`,
      [hash(key.toUpperCase()), hash(deviceId)],
    );
    if (result.error_code) throw new ApiError(403, result.error_code);
    return {
      valid: true,
      expiresAt: result.expires_at,
      serverTime: result.server_time,
      checkAfterSeconds: 300,
    };
  }
  await db.query("BEGIN");
  try {
    const {
      rows: [license],
    } = await db.query(
      "SELECT *, now() AS server_now FROM licenses WHERE key_hash=$1 FOR UPDATE",
      [hash(key.toUpperCase())],
    );
    if (
      !license ||
      license.revoked_at ||
      (license.expires_at &&
        new Date(license.expires_at) <= new Date(license.server_now))
    )
      throw new ApiError(403, "LICENSE_INVALID");
    const deviceHash = hash(deviceId);
    const { rows: devices } = await db.query(
      "SELECT device_hash FROM devices WHERE license_id=$1",
      [license.id],
    );
    if (!devices.some((d) => d.device_hash === deviceHash)) {
      if (!activate) throw new ApiError(403, "ACTIVATION_REQUIRED");
      if (devices.length >= license.max_devices)
        throw new ApiError(403, "DEVICE_LIMIT");
      await db.query(
        "INSERT INTO devices(license_id,device_hash,platform) VALUES($1,$2,$3)",
        [license.id, deviceHash, platform],
      );
    }
    const {
      rows: [result],
    } = await db.query(
      "UPDATE licenses SET activated_at=COALESCE(activated_at,now()),expires_at=COALESCE(expires_at,now()+duration_days*interval '1 day') WHERE id=$1 RETURNING expires_at,now() AS server_time",
      [license.id],
    );
    await db.query(
      "UPDATE devices SET last_seen=now() WHERE license_id=$1 AND device_hash=$2",
      [license.id, deviceHash],
    );
    await db.query("COMMIT");
    return {
      valid: true,
      expiresAt: result.expires_at,
      serverTime: result.server_time,
      checkAfterSeconds: 300,
    };
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
}
