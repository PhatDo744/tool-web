import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sessionCookie,
  validSession,
  SESSION_SECONDS,
} from "../lib/admin-session.js";
test("sessions expire, reject tampering and invalidate when admin secret changes", () => {
  const old = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "session-unit-test-secret-".repeat(3);
  try {
    const now = Date.now();
    const cookie = sessionCookie(now).split(";")[0];
    const request = { headers: { cookie } };
    assert.equal(validSession(request, now), true);
    assert.equal(validSession(request, now + SESSION_SECONDS * 1000), false);
    assert.equal(
      validSession({ headers: { cookie: cookie + "x" } }, now),
      false,
    );
    assert.equal(
      validSession({ headers: { cookie: cookie + "; " + cookie } }, now),
      false,
    );
    process.env.ADMIN_TOKEN = "changed-session-secret-".repeat(3);
    assert.equal(validSession(request, now), false);
  } finally {
    if (old === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = old;
  }
});
