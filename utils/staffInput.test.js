const test = require("node:test");
const assert = require("node:assert/strict");
const { pickEditableStaffFields } = require("./staffInput");

test("preserves intended staff editor fields", () => {
  const editable = {
    name: "Amina N.",
    email: "amina@example.org",
    phone: "+256700000000",
    role: "Coordinator",
    type: "staff",
    status: "active",
    photo: { url: "https://res.cloudinary.com/example/image/upload/v1/staff.jpg", public_id: "staff" },
    socialLinks: [],
  };

  assert.deepEqual(pickEditableStaffFields(editable), editable);
});

test("drops database-managed and unrelated fields from staff updates", () => {
  assert.deepEqual(
    pickEditableStaffFields({
      name: "Amina N.",
      _id: "attacker-id",
      createdAt: "2000-01-01",
      __v: 10,
      password: "unexpected",
    }),
    { name: "Amina N." },
  );
});