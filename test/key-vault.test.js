import { test } from "node:test";
import assert from "node:assert/strict";
import { sealKey, openKey } from "../lib/key-vault.js";
test("AES-GCM rejects row swapping, ciphertext tampering and incorrect secret", () => {
  const previous = process.env.LICENSE_ENCRYPTION_KEY;
  process.env.LICENSE_ENCRYPTION_KEY = "vault-unit-test-secret-".repeat(3);
  try {
    const encrypted = sealKey("NRO-" + "A".repeat(48), "license-one");
    assert.equal(openKey(encrypted, "license-one"), "NRO-" + "A".repeat(48));
    assert.throws(() => openKey(encrypted, "license-two"), {
      message: "KEY_DECRYPTION_FAILED",
    });
    const parts = encrypted.split(".");
    const bytes = Buffer.from(parts[3], "base64");
    bytes[0] ^= 1;
    parts[3] = bytes.toString("base64");
    assert.throws(() => openKey(parts.join("."), "license-one"), {
      message: "KEY_DECRYPTION_FAILED",
    });
    process.env.LICENSE_ENCRYPTION_KEY = "wrong-secret-".repeat(4);
    assert.throws(() => openKey(encrypted, "license-one"), {
      message: "KEY_DECRYPTION_FAILED",
    });
  } finally {
    if (previous === undefined) delete process.env.LICENSE_ENCRYPTION_KEY;
    else process.env.LICENSE_ENCRYPTION_KEY = previous;
  }
});
test("automatic encryption is compatible with optional override and admin-secret rotation", () => {
  const originalAdmin = process.env.ADMIN_TOKEN,
    originalVault = process.env.LICENSE_ENCRYPTION_KEY;
  const oldAdmin = "automatic-admin-test-".repeat(4);
  try {
    process.env.ADMIN_TOKEN = oldAdmin;
    delete process.env.LICENSE_ENCRYPTION_KEY;
    const key = "NRO-" + "B".repeat(48);
    const envelope = sealKey(key, "auto-license");
    assert.ok(envelope.startsWith("a1."));
    assert.equal(openKey(envelope, "auto-license"), key);
    process.env.LICENSE_ENCRYPTION_KEY = "independent-vault-test-".repeat(3);
    assert.equal(openKey(envelope, "auto-license"), key);
    const dedicated = sealKey(key, "auto-license");
    assert.ok(dedicated.startsWith("v1."));
    assert.equal(openKey(dedicated, "auto-license"), key);
    process.env.LICENSE_ENCRYPTION_KEY = oldAdmin;
    process.env.ADMIN_TOKEN = "new-admin-test-".repeat(4);
    assert.equal(openKey(envelope, "auto-license"), key);
    assert.throws(() => openKey(envelope, "different-license"), {
      message: "KEY_DECRYPTION_FAILED",
    });
  } finally {
    if (originalAdmin === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalAdmin;
    if (originalVault === undefined) delete process.env.LICENSE_ENCRYPTION_KEY;
    else process.env.LICENSE_ENCRYPTION_KEY = originalVault;
  }
});
