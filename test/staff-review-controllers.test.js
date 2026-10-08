const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalModules = new Map();

function mockModule(modulePath, exports) {
  const resolvedPath = require.resolve(modulePath);
  if (!originalModules.has(resolvedPath)) {
    originalModules.set(resolvedPath, require.cache[resolvedPath]);
  }
  const mockedModule = new Module(resolvedPath, module);
  mockedModule.filename = resolvedPath;
  mockedModule.loaded = true;
  mockedModule.exports = exports;
  require.cache[resolvedPath] = mockedModule;
  return resolvedPath;
}

function restoreModule(resolvedPath) {
  const original = originalModules.get(resolvedPath);
  if (original) require.cache[resolvedPath] = original;
  else delete require.cache[resolvedPath];
  originalModules.delete(resolvedPath);
}

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    set() {},
  };
}

test("staff create persists bio and returns the database document", async () => {
  let savedStaff;
  class StaffStub {
    constructor(data) {
      Object.assign(this, data);
      this._id = "staff-document-id";
    }

    async save() {
      savedStaff = this;
    }
  }

  const modelPath = mockModule("../models/staff", StaffStub);
  const controllerPath = require.resolve("../controllers/staffControllers");
  delete require.cache[controllerPath];

  try {
    const { createStaff } = require("../controllers/staffControllers");
    const res = responseRecorder();
    await createStaff(
      {
        body: {
          name: "Amina Example",
          email: "amina@example.test",
          phone: "+256700000000",
          role: "Program Manager",
          bio: "Supports local education programs.",
          type: "staff",
          status: "active",
        },
      },
      res,
    );

    assert.equal(res.statusCode, 201);
    assert.equal(savedStaff.bio, "Supports local education programs.");
    assert.equal(savedStaff._id, "staff-document-id");
    assert.equal(res.body.staff._id, "staff-document-id");
    assert.equal("gender" in savedStaff, false);
  } finally {
    delete require.cache[controllerPath];
    restoreModule(modelPath);
  }
});

test("public staff query filters active staff and selects only public fields", async () => {
  const query = {};
  const selected = {};
  const publicStaff = [{
    _id: "public-staff-id",
    name: "Amina Example",
    role: "Program Manager",
    bio: "Supports local education programs.",
    photo: { url: "https://images.example.test/amina.jpg" },
  }];
  const queryBuilder = {
    sort(value) {
      query.sort = value;
      return this;
    },
    select(value) {
      selected.fields = value;
      return this;
    },
    lean() {
      return Promise.resolve(publicStaff);
    },
  };
  const StaffStub = { find: (filter) => Object.assign(query, filter) && queryBuilder };
  const modelPath = mockModule("../models/staff", StaffStub);
  const controllerPath = require.resolve("../controllers/staffControllers");
  delete require.cache[controllerPath];

  try {
    const { getPublicStaff } = require("../controllers/staffControllers");
    const res = responseRecorder();
    await getPublicStaff({}, res);

    assert.deepEqual(query, {
      type: "staff",
      status: "active",
      sort: { createdAt: -1, _id: -1 },
    });
    assert.equal(selected.fields, "name role bio photo.url");
    assert.deepEqual(res.body, publicStaff);
    assert.equal(res.statusCode, 200);
  } finally {
    delete require.cache[controllerPath];
    restoreModule(modelPath);
  }
});

test("review creation defaults to draft and public query selects published fields", async () => {
  let createdReview;
  const publicReview = [{
    _id: "public-review-id",
    name: "Amina Example",
    role: "Parent",
    review: "The program helped my child stay in school.",
    photo: { url: "https://images.example.test/amina.jpg" },
  }];
  const query = {};
  const selected = {};
  const queryBuilder = {
    sort(value) {
      query.sort = value;
      return this;
    },
    select(value) {
      selected.fields = value;
      return this;
    },
    lean() {
      return Promise.resolve(publicReview);
    },
  };
  const ReviewStub = {
    create: async (data) => {
      createdReview = { _id: "review-document-id", ...data };
      return createdReview;
    },
    find: (filter) => Object.assign(query, filter) && queryBuilder,
  };
  const modelPath = mockModule("../models/review", ReviewStub);
  const controllerPath = require.resolve("../controllers/reviewControllers");
  delete require.cache[controllerPath];

  try {
    const { createReview, getPublicReviews } = require("../controllers/reviewControllers");
    const createRes = responseRecorder();
    await createReview(
      {
        body: {
          name: "Amina Example",
          role: "Parent",
          review: "The program helped my child stay in school.",
        },
      },
      createRes,
    );

    assert.equal(createRes.statusCode, 201);
    assert.equal(createdReview.status, "draft");
    assert.equal(createRes.body.review._id, "review-document-id");

    const publicRes = responseRecorder();
    await getPublicReviews({}, publicRes);
    assert.deepEqual(query, {
      status: "published",
      sort: { createdAt: -1, _id: -1 },
    });
    assert.equal(selected.fields, "name role review photo.url");
    assert.deepEqual(publicRes.body, publicReview);
    assert.equal(publicRes.statusCode, 200);
  } finally {
    delete require.cache[controllerPath];
    restoreModule(modelPath);
  }
});
