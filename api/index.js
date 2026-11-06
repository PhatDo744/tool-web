import {
  sessionCookie,
  clearSessionCookie,
  validSession,
  requireSameOrigin,
} from "../lib/admin-session.js";
import { sealKey, openKey, vaultConfigured } from "../lib/key-vault.js";
import { connect } from "../lib/db.js";
import {
  adminTokenConfigured,
  adminAuthorized,
  ApiError,
  hash,
  newLicense,
  verifyLicense,
} from "../lib/core.js";
export function createHandler(getConnection = connect) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const send = (status, data) => res.status(status).json(data);
    let db;
    try {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return send(405, { error: "METHOD_NOT_ALLOWED" });
      }
      let input = req.body;
      if (Buffer.isBuffer(input)) input = input.toString();
      if (typeof input === "string") {
        if (Buffer.byteLength(input) > 4096)
          throw new ApiError(413, "BODY_TOO_LARGE");
        try {
          input = JSON.parse(input);
        } catch {
          throw new ApiError(400, "INVALID_JSON");
        }
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new ApiError(400, "INVALID_INPUT");
      if (Buffer.byteLength(JSON.stringify(input)) > 4096)
        throw new ApiError(413, "BODY_TOO_LARGE");
      const { action } = input;
      if (
        ![
          "login",
          "logout",
          "session",
          "list",
          "create",
          "revoke",
          "reset-devices",
          "reveal",
          "rotate",
          "activate",
          "check",
        ].includes(action)
      )
        throw new ApiError(400, "UNKNOWN_ACTION");
      db = await getConnection();
      // Vercel overwrites x-vercel-forwarded-for. Local development uses socket IP.
      const ip = process.env.VERCEL
        ? req.headers["x-vercel-forwarded-for"]
        : req.socket?.remoteAddress;
      const bucket = hash(
        `${ip || "unknown"}:${["activate", "check"].includes(action) ? "client" : "admin"}`,
      );
      await db.query("DELETE FROM rate_limits WHERE reset_at < now()");
      const {
        rows: [limit],
      } = await db.query(
        "INSERT INTO rate_limits(bucket,hits,reset_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(bucket) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits",
        [bucket],
      );
      if (limit.hits > 60) {
        res.setHeader("Retry-After", "60");
        throw new ApiError(429, "RATE_LIMITED");
      }
      if (action === "activate" || action === "check") {
        // Recover old hash-only keys when a client presents the correct key, without granting access.
        if (
          vaultConfigured() &&
          typeof input.key === "string" &&
          /^NRO-[A-Fa-f0-9]{48}$/.test(input.key)
        ) {
          const key = input.key.toUpperCase();
          const {
            rows: [legacy],
          } = await db.query(
            "SELECT id FROM licenses WHERE key_hash=$1 AND encrypted_key IS NULL",
            [hash(key)],
          );
          if (legacy)
            await db.query(
              "UPDATE licenses SET encrypted_key=$1 WHERE id=$2 AND encrypted_key IS NULL",
              [sealKey(key, legacy.id), legacy.id],
            );
        }
        return send(200, await verifyLicense(db, input, action === "activate"));
      }
      if (action === "logout") {
        requireSameOrigin(req);
        res.setHeader("Set-Cookie", clearSessionCookie());
        return send(200, { ok: true });
      }
      if (!adminTokenConfigured())
        throw new ApiError(503, "ADMIN_NOT_CONFIGURED");
      const bearer = adminAuthorized(req.headers.authorization);
      const cookie = validSession(req);
      if (!bearer && !cookie) throw new ApiError(401, "UNAUTHORIZED");
      if (cookie && !bearer) requireSameOrigin(req);
      if (action === "login") {
        if (!bearer) throw new ApiError(401, "UNAUTHORIZED");
        requireSameOrigin(req);
        res.setHeader("Set-Cookie", sessionCookie());
        return send(200, { authenticated: true });
      }
      if (action === "session") return send(200, { authenticated: true });
      if (action === "create") {
        const value = newLicense(input);
        await db.query(
          "INSERT INTO licenses(id,key_hash,label,duration_days,max_devices,encrypted_key) VALUES($1,$2,$3,$4,$5,$6)",
          [
            value.id,
            value.keyHash,
            value.label,
            value.durationDays,
            value.maxDevices,
            sealKey(value.key, value.id),
          ],
        );
        return send(201, { id: value.id, key: value.key });
      }
      if (action === "reveal" || action === "rotate") {
        if (
          typeof input.id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            input.id,
          )
        )
          throw new ApiError(400, "INVALID_ID");
        if (action === "reveal") {
          const {
            rows: [license],
          } = await db.query(
            "SELECT id,encrypted_key FROM licenses WHERE id=$1",
            [input.id],
          );
          if (!license) throw new ApiError(404, "NOT_FOUND");
          if (!license.encrypted_key)
            throw new ApiError(409, "KEY_NOT_RECOVERABLE");
          return send(200, { key: openKey(license.encrypted_key, license.id) });
        }
        const replacement = newLicense({});
        const encrypted = sealKey(replacement.key, input.id.toLowerCase());
        await db.query("BEGIN");
        try {
          const {
            rows: [license],
          } = await db.query(
            "SELECT id,revoked_at FROM licenses WHERE id=$1 FOR UPDATE",
            [input.id],
          );
          if (!license) throw new ApiError(404, "NOT_FOUND");
          if (license.revoked_at) throw new ApiError(409, "LICENSE_REVOKED");
          await db.query(
            "UPDATE licenses SET key_hash=$1,encrypted_key=$2 WHERE id=$3",
            [replacement.keyHash, encrypted, input.id],
          );
          await db.query("DELETE FROM devices WHERE license_id=$1", [input.id]);
          await db.query("COMMIT");
        } catch (error) {
          await db.query("ROLLBACK");
          throw error;
        }
        return send(200, { key: replacement.key });
      }
      if (action === "reset-devices") {
        if (
          typeof input.id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            input.id,
          )
        )
          throw new ApiError(400, "INVALID_ID");
        await db.query("BEGIN");
        try {
          const { rows } = await db.query(
            "SELECT id FROM licenses WHERE id=$1 FOR UPDATE",
            [input.id],
          );
          if (!rows.length) throw new ApiError(404, "NOT_FOUND");
          await db.query("DELETE FROM devices WHERE license_id=$1", [input.id]);
          await db.query("COMMIT");
        } catch (error) {
          await db.query("ROLLBACK");
          throw error;
        }
        return send(200, { ok: true });
      }
      if (action === "revoke") {
        if (
          typeof input.id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            input.id,
          )
        )
          throw new ApiError(400, "INVALID_ID");
        const result = await db.query(
          "UPDATE licenses SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 RETURNING id",
          [input.id],
        );
        if (!result.rows.length) throw new ApiError(404, "NOT_FOUND");
        return send(200, { ok: true });
      }
      const { rows } = await db.query(
        "SELECT (l.encrypted_key IS NOT NULL) AS recoverable,l.id,l.label,l.duration_days,l.max_devices,l.created_at,l.activated_at,l.expires_at,l.revoked_at,(SELECT count(*)::int FROM devices d WHERE d.license_id=l.id) AS devices FROM licenses l ORDER BY created_at DESC LIMIT 200",
      );
      return send(200, { licenses: rows });
    } catch (e) {
      if (!e.status) console.error("API failure:", e.code || e.name);
      return send(e.status || 503, {
        error: e.status ? e.message : "SERVICE_UNAVAILABLE",
      });
    } finally {
      db?.release();
    }
  };
}
export default createHandler();
