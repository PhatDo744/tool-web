import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createHandler } from "../api/index.js";
const db = new PGlite();
await db.exec(
  await readFile(new URL("../schema.sql", import.meta.url), "utf8"),
);
const handler = createHandler(async () => ({
  query: (...args) => db.query(...args),
  release() {},
}));
process.env.LICENSE_ENCRYPTION_KEY = "test-only-vault-encryption-key-".repeat(
  3,
);
process.env.ADMIN_TOKEN = "test-only-admin-secret-".repeat(3);
async function call(body, auth = true, method = "POST", ip = "127.0.0.10") {
  const req = {
    method,
    body,
    headers: { authorization: auth ? `Bearer ${process.env.ADMIN_TOKEN}` : "" },
    socket: { remoteAddress: ip },
  };
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(s) {
      this.code = s;
      return this;
    },
    json(v) {
      this.body = v;
    },
  };
  await handler(req, res);
  return res;
}
after(() => db.close());
test("API lifecycle: admin creates, client activates, admin revokes, client refused", async () => {
  assert.equal((await call({ action: "create" }, false)).code, 401);
  const created = await call({
    action: "create",
    label: "<script>not HTML</script>",
    durationDays: 14,
    maxDevices: 1,
  });
  assert.equal(created.code, 201);
  assert.ok(created.body.key);
  const list = await call({ action: "list" });
  assert.equal(list.code, 200);
  assert.equal(list.body.licenses.length, 1);
  assert.equal(list.body.licenses[0].key_hash, undefined);
  assert.equal(list.body.licenses[0].key, undefined);
  const input = {
    key: created.body.key,
    deviceId: "installation-0000001",
    platform: "android",
  };
  assert.equal((await call({ action: "check", ...input }, false)).code, 403);
  assert.equal(
    (await call({ action: "activate", ...input }, false)).body.valid,
    true,
  );
  assert.equal(
    (await call({ action: "check", ...input }, false)).body.valid,
    true,
  );
  assert.equal(
    (await call({ action: "revoke", id: created.body.id })).code,
    200,
  );
  assert.equal((await call({ action: "check", ...input }, false)).code, 403);
});
test("API rejects malformed bodies, unsupported methods, and invalid ids", async () => {
  assert.equal((await call("{broken")).code, 400);
  assert.equal((await call("x".repeat(4097))).code, 413);
  assert.equal((await call({ action: "list" }, true, "GET")).code, 405);
  assert.equal((await call({ action: "revoke", id: "' OR 1=1" })).code, 400);
  assert.equal((await call({ action: "unsupported" })).code, 400);
});
test("unauthenticated admin attempts hit a persistent rate limit", async () => {
  for (let i = 0; i < 60; i++)
    assert.equal(
      (await call({ action: "list" }, false, "POST", "192.0.2.1")).code,
      401,
    );
  const result = await call({ action: "list" }, false, "POST", "192.0.2.1");
  assert.equal(result.code, 429);
  assert.equal(result.headers["Retry-After"], "60");
});
test("missing and too short admin config are distinguished from wrong credentials", async () => {
  const saved = process.env.ADMIN_TOKEN;
  try {
    for (const value of ["", "short", " ".repeat(64)]) {
      process.env.ADMIN_TOKEN = value;
      const result = await call({ action: "list" }, true, "POST", "192.0.2.20");
      assert.equal(result.code, 503);
      assert.equal(result.body.error, "ADMIN_NOT_CONFIGURED");
    }
  } finally {
    process.env.ADMIN_TOKEN = saved;
  }
  assert.equal(
    (await call({ action: "list" }, false, "POST", "192.0.2.21")).code,
    401,
  );
});
test("admin can release devices without renewing expiry; old checks stop and new device can activate", async () => {
  const created = await call({
    action: "create",
    durationDays: 2,
    maxDevices: 1,
  });
  const old = {
    key: created.body.key,
    deviceId: "old-installation-0001",
    platform: "pc",
  };
  const fresh = { ...old, deviceId: "shared-installation-0001" };
  const activated = await call({ action: "activate", ...old }, false);
  assert.equal(activated.code, 200);
  assert.equal((await call({ action: "activate", ...fresh }, false)).code, 403);
  assert.equal(
    (await call({ action: "reset-devices", id: created.body.id }, false)).code,
    401,
  );
  assert.equal(
    (await call({ action: "reset-devices", id: created.body.id })).code,
    200,
  );
  assert.equal(
    (await call({ action: "check", ...old }, false)).body.error,
    "ACTIVATION_REQUIRED",
  );
  const again = await call({ action: "activate", ...fresh }, false);
  assert.equal(again.code, 200);
  assert.equal(
    new Date(again.body.expiresAt).getTime(),
    new Date(activated.body.expiresAt).getTime(),
  );
  assert.equal(
    (await call({ action: "activate", ...old }, false)).body.error,
    "DEVICE_LIMIT",
  );
  await call({ action: "revoke", id: created.body.id });
  await call({ action: "reset-devices", id: created.body.id });
  assert.equal(
    (await call({ action: "activate", ...fresh }, false)).body.error,
    "LICENSE_INVALID",
  );
});
test("vault: admin can reveal encrypted key; list never exposes ciphertext or key", async () => {
  const created = await call({ action: "create", label: "Vault test" });
  assert.equal(created.code, 201);
  const {
    rows: [stored],
  } = await db.query("SELECT encrypted_key FROM licenses WHERE id=$1", [
    created.body.id,
  ]);
  assert.ok(stored.encrypted_key.startsWith("v1."));
  assert.ok(!stored.encrypted_key.includes(created.body.key));
  assert.equal(
    (await call({ action: "reveal", id: created.body.id }, false)).code,
    401,
  );
  assert.equal(
    (await call({ action: "reveal", id: created.body.id })).body.key,
    created.body.key,
  );
  const list = await call({ action: "list" });
  const item = list.body.licenses.find((l) => l.id === created.body.id);
  assert.equal(item.recoverable, true);
  assert.equal(item.encrypted_key, undefined);
  assert.equal(item.key, undefined);
  await call({ action: "reset-devices", id: created.body.id });
  assert.equal(
    (await call({ action: "reveal", id: created.body.id })).body.key,
    created.body.key,
  );
});
test("legacy key backfills from client even when device check is denied, without granting access", async () => {
  const created = await call({ action: "create" });
  await db.query("UPDATE licenses SET encrypted_key=NULL WHERE id=$1", [
    created.body.id,
  ]);
  assert.equal(
    (await call({ action: "reveal", id: created.body.id })).body.error,
    "KEY_NOT_RECOVERABLE",
  );
  const result = await call(
    {
      action: "check",
      key: created.body.key,
      deviceId: "unregistered-device-0001",
      platform: "pc",
    },
    false,
  );
  assert.equal(result.code, 403);
  assert.equal(result.body.error, "ACTIVATION_REQUIRED");
  assert.equal(
    (await call({ action: "reveal", id: created.body.id })).body.key,
    created.body.key,
  );
});
test("reissue invalidates old key but preserves expiry, activation and device allowance", async () => {
  const created = await call({
    action: "create",
    durationDays: 5,
    maxDevices: 2,
  });
  const input = {
    key: created.body.key,
    deviceId: "rotation-test-device-001",
    platform: "pc",
  };
  const first = await call({ action: "activate", ...input }, false);
  const {
    rows: [before],
  } = await db.query(
    "SELECT activated_at,expires_at,max_devices FROM licenses WHERE id=$1",
    [created.body.id],
  );
  assert.equal(
    (await call({ action: "rotate", id: created.body.id }, false)).code,
    401,
  );
  const replacement = await call({
    action: "rotate",
    id: created.body.id.toUpperCase(),
  });
  assert.equal(replacement.code, 200);
  assert.notEqual(replacement.body.key, created.body.key);
  assert.equal(
    (await call({ action: "activate", ...input }, false)).body.error,
    "LICENSE_INVALID",
  );
  const next = await call(
    { action: "activate", ...input, key: replacement.body.key },
    false,
  );
  assert.equal(next.code, 200);
  assert.equal(
    new Date(next.body.expiresAt).getTime(),
    new Date(first.body.expiresAt).getTime(),
  );
  const {
    rows: [after],
  } = await db.query(
    "SELECT activated_at,expires_at,max_devices FROM licenses WHERE id=$1",
    [created.body.id],
  );
  assert.deepEqual(after, before);
  await call({ action: "revoke", id: created.body.id });
  assert.equal(
    (await call({ action: "rotate", id: created.body.id })).body.error,
    "LICENSE_REVOKED",
  );
});
test("keys can be created and revealed automatically without a dedicated encryption variable", async () => {
  const previous = process.env.LICENSE_ENCRYPTION_KEY;
  try {
    delete process.env.LICENSE_ENCRYPTION_KEY;
    const created = await call({ action: "create", label: "Automatic vault" });
    assert.equal(created.code, 201);
    const {
      rows: [stored],
    } = await db.query("SELECT encrypted_key FROM licenses WHERE id=$1", [
      created.body.id,
    ]);
    assert.ok(stored.encrypted_key.startsWith("a1."));
    assert.equal(
      (await call({ action: "reveal", id: created.body.id })).body.key,
      created.body.key,
    );
    const activated = await call(
      {
        action: "activate",
        key: created.body.key,
        deviceId: "auto-vault-client-device-001",
        platform: "pc",
      },
      false,
    );
    assert.equal(activated.body.valid, true);
    await call({ action: "reset-devices", id: created.body.id });
    assert.equal(
      (await call({ action: "reveal", id: created.body.id })).body.key,
      created.body.key,
    );
    const replacement = await call({ action: "rotate", id: created.body.id });
    assert.equal(replacement.code, 200);
    assert.equal(
      (await call({ action: "reveal", id: created.body.id })).body.key,
      replacement.body.key,
    );
  } finally {
    if (previous === undefined) delete process.env.LICENSE_ENCRYPTION_KEY;
    else process.env.LICENSE_ENCRYPTION_KEY = previous;
  }
});
