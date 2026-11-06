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
