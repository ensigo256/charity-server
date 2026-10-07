const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBlogUpdate } = require("./blogInput");

test("keeps editable blog fields and an explicitly supplied image", () => {
  const update = buildBlogUpdate({
    title: "New title",
    status: "draft",
    image: { url: "https://res.cloudinary.com/example/image/upload/v1/blog.jpg", public_id: "blog" },
  });

  assert.deepEqual(update, {
    title: "New title",
    status: "draft",
    image: { url: "https://res.cloudinary.com/example/image/upload/v1/blog.jpg", public_id: "blog" },
  });
});

test("drops engagement, feature, and publication fields from blog updates", () => {
  const update = buildBlogUpdate({
    title: "New title",
    likes: ["forged-user"],
    views: ["forged-user"],
    shares: ["forged-user"],
    comments: ["507f1f77bcf86cd799439011"],
    isFeatured: true,
    publishedOn: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  assert.deepEqual(update, { title: "New title" });
});

test("does not replace the stored image when an update omits image fields", () => {
  assert.deepEqual(buildBlogUpdate({ title: "Text-only edit" }), {
    title: "Text-only edit",
  });
});