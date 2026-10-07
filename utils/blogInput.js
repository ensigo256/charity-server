const EDITABLE_BLOG_FIELDS = [
  "title",
  "excerpt",
  "content",
  "author",
  "category",
  "status",
  "videoId",
];

function buildBlogUpdate(data = {}) {
  const update = Object.fromEntries(
    EDITABLE_BLOG_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
      .map((field) => [field, data[field]]),
  );

  if (Object.prototype.hasOwnProperty.call(data, "imageUrl")) {
    update.image = { url: data.imageUrl, public_id: "" };
  } else if (Object.prototype.hasOwnProperty.call(data, "image")) {
    update.image = data.image;
  }

  return update;
}

module.exports = { buildBlogUpdate };