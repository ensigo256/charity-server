const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidPublicInteractionId } = require("./publicInteractionId");

test("accepts generated UUIDv4 interaction identifiers", () => {
  assert.equal(
    isValidPublicInteractionId("f47ac10b-58cc-4372-a567-0e02b2c3d479"),
    true,
  );
});

test("rejects missing, malformed, oversized, and non-v4 identifiers", () => {
  for (const value of [
    undefined,
    "",
    "visitor",
    "f47ac10b-58cc-1372-a567-0e02b2c3d479",
    "f47ac10b-58cc-4372-a567-0e02b2c3d479".repeat(100),
  ]) {
    assert.equal(isValidPublicInteractionId(value), false);
  }
});