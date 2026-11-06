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
test("a valid returning session receives a fresh 30-day lifetime", () => {
  const previous = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "sliding-session-test-secret-".repeat(3);
  try {
    assert.equal(SESSION_SECONDS, 30 * 24 * 60 * 60);
    const issued = Date.now(),
      returning = issued + 20 * 24 * 60 * 60 * 1000;
    const oldCookie = sessionCookie(issued).split(";")[0];
    assert.equal(
      validSession({ headers: { cookie: oldCookie } }, returning),
      true,
    );
    const renewed = sessionCookie(returning).split(";")[0];
    const afterOldExpiry = issued + 35 * 24 * 60 * 60 * 1000;
    assert.equal(
      validSession({ headers: { cookie: oldCookie } }, afterOldExpiry),
      false,
    );
    assert.equal(
      validSession({ headers: { cookie: renewed } }, afterOldExpiry),
      true,
    );
  } finally {
    if (previous === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previous;
  }
});
