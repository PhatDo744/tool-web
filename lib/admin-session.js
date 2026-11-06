import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError, adminTokenConfigured } from "./core.js";
export const SESSION_SECONDS = 8 * 60 * 60;
const name = "__Host-modpdt_admin";
function sign(payload) {
  return createHmac("sha256", process.env.ADMIN_TOKEN.trim())
    .update("ModPDT/admin-session/v1\0" + payload)
    .digest("base64url");
}
export function sessionCookie(now = Date.now()) {
  if (!adminTokenConfigured()) throw new ApiError(503, "ADMIN_NOT_CONFIGURED");
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(now / 1000) + SESSION_SECONDS,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return `${name}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}
export function clearSessionCookie() {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
export function validSession(req, now = Date.now()) {
  if (
    !adminTokenConfigured() ||
    typeof req.headers.cookie !== "string" ||
    req.headers.cookie.length > 8192
  )
    return false;
  try {
    const cookies = req.headers.cookie
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.startsWith(name + "="));
    if (cookies.length !== 1) return false;
    const [payload, signature, ...extra] = cookies[0]
      .slice(name.length + 1)
      .split(".");
    if (!payload || !signature || extra.length) return false;
    const actual = Buffer.from(signature),
      expected = Buffer.from(sign(payload));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const current = Math.floor(now / 1000);
    return (
      Number.isSafeInteger(data.exp) &&
      data.exp > current &&
      data.exp <= current + SESSION_SECONDS
    );
  } catch {
    return false;
  }
}
export function requireSameOrigin(req) {
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new ApiError(403, "FORBIDDEN_ORIGIN");
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) throw Error();
    } catch {
      throw new ApiError(403, "FORBIDDEN_ORIGIN");
    }
  }
}
