const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidCloudinaryImageReference } = require("./cloudinaryImageReference");

const cloudName = "charity-images";

test("accepts a versioned image URL from the configured Cloudinary account", () => {
  assert.equal(
    isValidCloudinaryImageReference(
      {
        url: "https://res.cloudinary.com/charity-images/image/upload/v123456789/sponsors/profile_1.jpg",
        public_id: "sponsors/profile_1",
      },
      cloudName,
    ),
    true,
  );
});

test("rejects other hosts, Cloudinary accounts, and mismatched public IDs", () => {
  const validImage = {
    url: "https://res.cloudinary.com/charity-images/image/upload/v123456789/sponsors/profile_1.jpg",
    public_id: "sponsors/profile_1",
  };

  assert.equal(
    isValidCloudinaryImageReference(
      { ...validImage, url: "https://example.com/sponsors/profile_1.jpg" },
      cloudName,
    ),
    false,
  );
  assert.equal(
    isValidCloudinaryImageReference(
      { ...validImage, url: validImage.url.replace(cloudName, "other-cloud") },
      cloudName,
    ),
    false,
  );
  assert.equal(
    isValidCloudinaryImageReference(
      { ...validImage, public_id: "sponsors/another-image" },
      cloudName,
    ),
    false,
  );
});

test("rejects unversioned or malformed asset URLs", () => {
  assert.equal(
    isValidCloudinaryImageReference(
      {
        url: "https://res.cloudinary.com/charity-images/image/upload/sponsors/profile_1.jpg",
        public_id: "sponsors/profile_1",
      },
      cloudName,
    ),
    false,
  );
  assert.equal(
    isValidCloudinaryImageReference(
      { url: "not a URL", public_id: "sponsors/profile_1" },
      cloudName,
    ),
    false,
  );
});