function getRequestOrigin(req) {
  const origin = String(req.get("origin") || "").trim();
  if (origin) return origin;

  const referer = String(req.get("referer") || "").trim();
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function requireTrustedOrigin(allowedOrigins) {
  const origins = new Set(allowedOrigins);

  return (req, res, next) => {
    const requestOrigin = getRequestOrigin(req);

    if (!requestOrigin || !origins.has(requestOrigin)) {
      return res.status(403).json({ message: "Request origin is not trusted" });
    }

    return next();
  };
}

module.exports = { requireTrustedOrigin };
