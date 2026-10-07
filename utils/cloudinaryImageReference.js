function isValidCloudinaryImageReference(image, cloudName = process.env.CLOUDINARY_CLOUD_NAME) {
  const normalizedCloudName = String(cloudName || "").trim();
  const publicId = String(image?.public_id || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalizedCloudName) || !publicId) {
    return false;
  }

  try {
    const url = new URL(String(image?.url || ""));
    if (
      url.protocol !== "https:" ||
      url.hostname !== "res.cloudinary.com" ||
      url.username ||
      url.password ||
      url.port
    ) {
      return false;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (
      segments[0] !== normalizedCloudName ||
      segments[1] !== "image" ||
      segments[2] !== "upload"
    ) {
      return false;
    }

    const versionIndex = segments.findIndex((segment, index) =>
      index > 2 && /^v\d+$/.test(segment),
    );
    if (versionIndex < 0 || versionIndex === segments.length - 1) {
      return false;
    }

    const encodedAssetPath = segments.slice(versionIndex + 1).join("/");
    const assetPath = decodeURIComponent(encodedAssetPath);
    const assetId = assetPath.replace(/\.[a-z0-9]{1,8}$/i, "");
    return assetId === publicId;
  } catch {
    return false;
  }
}

module.exports = { isValidCloudinaryImageReference };