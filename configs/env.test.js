const test = require("node:test");
const assert = require("node:assert/strict");
const { parseOrigins, parseTrustProxyHops } = require("./env");

test("proxy trust defaults to disabled and accepts bounded integer hop counts", () => {
  assert.equal(parseTrustProxyHops(undefined), 0);
  assert.equal(parseTrustProxyHops(""), 0);
  assert.equal(parseTrustProxyHops("1"), 1);
  assert.equal(parseTrustProxyHops("10"), 10);
});

test("proxy trust rejects invalid or unbounded hop counts", () => {
  for (const value of ["-1", "1.5", "11", "true", "any"]) {
    assert.throws(() => parseTrustProxyHops(value), /TRUST_PROXY_HOPS/);
  }
});

test("allowed origins must be exact HTTP(S) origins without paths", () => {
  assert.deepEqual(
    parseOrigins("https://example.org,http://localhost:3000"),
    ["https://example.org", "http://localhost:3000"],
  );
  for (const value of ["*", "https://example.org/path", "not-an-origin"]) {
    assert.throws(() => parseOrigins(value), /ALLOWED_ORIGINS/);
  }
});

test("production allowed origins must use HTTPS", () => {
  assert.deepEqual(parseOrigins("https://example.org", true), ["https://example.org"]);
  assert.throws(() => parseOrigins("http://example.org", true), /HTTPS origins/);
});