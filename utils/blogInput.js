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

  if (
    data.image &&
    typeof data.image === "object" &&
    typeof data.image.url === "string" &&
    data.image.url.trim()
  ) {
    update.image = data.image;
  } else if (
    typeof data.imageUrl === "string" &&
    data.imageUrl.trim()
  ) {
    update.image = { url: data.imageUrl.trim(), public_id: "" };
  } else if (
    Object.prototype.hasOwnProperty.call(data, "image") &&
    data.image &&
    typeof data.image === "object"
  ) {
    update.image = data.image;
  }

  return update;
}

module.exports = { buildBlogUpdate };