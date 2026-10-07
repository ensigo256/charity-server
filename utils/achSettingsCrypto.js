const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey(value = process.env.ACH_SETTINGS_ENCRYPTION_KEY) {
  const encoded = String(value || "").trim();
  if (!/^[a-fA-F0-9]{64}$/.test(encoded)) {
    throw new Error("ACH_SETTINGS_ENCRYPTION_KEY must be 64 hexadecimal characters");
  }
  return Buffer.from(encoded, "hex");
}

function encryptAchSettings(settings, keyValue) {
  const key = getEncryptionKey(keyValue);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(settings), "utf8"),
    cipher.final(),
  ]);

  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function decryptAchSettings(value, keyValue) {
  const [encodedIv, encodedTag, encodedCiphertext, extra] = String(value || "").split(".");
  if (!encodedIv || !encodedTag || !encodedCiphertext || extra) {
    throw new Error("Encrypted ACH settings are malformed");
  }

  const key = getEncryptionKey(keyValue);
  const iv = Buffer.from(encodedIv, "base64url");
  const authTag = Buffer.from(encodedTag, "base64url");
  if (iv.length !== IV_LENGTH || authTag.length !== 16) {
    throw new Error("Encrypted ACH settings are malformed");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext);
}

module.exports = { getEncryptionKey, encryptAchSettings, decryptAchSettings };