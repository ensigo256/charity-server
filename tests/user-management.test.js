const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../models/admin");
const AdminSession = require("../models/adminSession");
const adminControllers = require("../controllers/adminControllers");
const { requireAuth, requirePermission } = require("../middleware/auth");

const originalMethods = new Map();

function replace(object, name, implementation) {
  if (!originalMethods.has(`${object.modelName || object.name}.${name}`)) {
    originalMethods.set(`${object.modelName || object.name}.${name}`, [object, name, object[name]]);
  }
  object[name] = implementation;
}

afterEach(() => {
  for (const [object, name, original] of originalMethods.values()) object[name] = original;
  originalMethods.clear();
  delete process.env.JWT_SECRET;
});

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    cookie(name, value) { this.cookieValue = { name, value }; return this; },
    clearCookie() { return this; },
  };
}

test("user creation accepts six-character normal-user passwords and never returns hashes", async () => {
  let persisted;
  replace(Admin, "findOne", async () => null);
  replace(Admin.prototype, "save", async function save() { persisted = this; return this; });
  const response = responseRecorder();

  await adminControllers.registerAdmin({ body: { username: "caseworker", password: "abc123", role: "admin" } }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(persisted.username, "caseworker");
  assert.notEqual(persisted.password, "abc123");
  assert.equal(await bcrypt.compare("abc123", persisted.password), true);
  assert.equal("password" in response.body.user, false);
});

test("user creation rejects a short developer password", async () => {
  let lookupCalled = false;
  replace(Admin, "findOne", async () => { lookupCalled = true; return null; });
  const response = responseRecorder();

  await adminControllers.registerAdmin({ body: { username: "newdev", password: "abc123", role: "developer" } }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(lookupCalled, false);
});

test("only developer role passes users.manage authorization", () => {
  let passed = false;
  requirePermission("users.manage")({ admin: { role: "developer" } }, responseRecorder(), () => { passed = true; });
  assert.equal(passed, true);

  const denied = responseRecorder();
  requirePermission("users.manage")({ admin: { role: "admin" } }, denied, () => assert.fail("admin must not pass"));
  assert.equal(denied.statusCode, 403);
});

test("login issues a session-bound access token and records metadata", async () => {
  process.env.JWT_SECRET = "test-secret-for-user-management";
  const passwordHash = await bcrypt.hash("abc123", 4);
  const admin = {
    _id: "65a000000000000000000001",
    username: "caseworker",
    password: passwordHash,
    role: "admin",
    isActive: true,
    loginLogs: [],
    async save() {},
  };
  let storedSession;
  replace(Admin, "findOne", async () => admin);
  replace(AdminSession, "create", async (session) => { storedSession = session; return session; });
  const response = responseRecorder();

  await adminControllers.loginAdmin({
    body: { username: "caseworker", password: "abc123" },
    headers: { "user-agent": "test-agent", "x-forwarded-for": "spoofed" },
    ip: "127.0.0.1",
  }, response);

  const access = jwt.verify(response.body.token, process.env.JWT_SECRET);
  assert.equal(response.statusCode, 200);
  assert.equal(typeof access.sessionId, "string");
  assert.equal(storedSession.sessionId, access.sessionId);
  assert.equal(storedSession.userAgent, "test-agent");
  assert.equal(storedSession.ipAddress, "127.0.0.1");
  assert.notEqual(storedSession.ipAddress, "spoofed");
});

test("authenticated requests reject tokens without a persisted active session", async () => {
  process.env.JWT_SECRET = "test-secret-for-user-management";
  replace(Admin, "findById", () => ({ select: async () => ({ role: "developer", isActive: true }) }));
  replace(AdminSession, "findOne", () => ({ select: async () => null }));
  const token = jwt.sign({ id: "65a000000000000000000001", role: "developer", sessionId: "session-1", type: "access" }, process.env.JWT_SECRET);
  const response = responseRecorder();
  let passed = false;

  await requireAuth({ headers: { authorization: `Bearer ${token}` } }, response, () => { passed = true; });

  assert.equal(passed, false);
  assert.equal(response.statusCode, 401);
});