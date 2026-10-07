const dotenv = require("dotenv");

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

function parseOrigins(value, isProduction = false) {
  const origins = String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      (isProduction && parsed.protocol !== "https:")
    ) {
      throw new Error(`ALLOWED_ORIGINS must contain exact${isProduction ? " HTTPS" : " HTTP(S)"} origins: ${origin}`);
    }
  }

  return [...new Set(origins)];
}

function requireValue(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseTrustProxyHops(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return 0;
  }

  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
    throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 10");
  }
  return hops;
}

function loadConfig() {
  const jwtSecret = requireValue("JWT_SECRET");
  const dbUrl = requireValue("DB_URL");
  if (!/^mongodb(?:\+srv)?:\/\//i.test(dbUrl)) {
    throw new Error('DB_URL in .env must be a MongoDB URI starting with "mongodb://" or "mongodb+srv://"');
  }
  
  const allowedOrigins = parseOrigins(process.env.ALLOWED_ORIGINS, isProduction);

  if (isProduction && allowedOrigins.length === 0) {
    throw new Error("ALLOWED_ORIGINS must contain at least one origin in production");
  }

  if (isProduction && jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }

  return {
    dbUrl,
    jwtSecret,
    allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : ["http://localhost:3000", "http://localhost:3001"],
    isProduction,
    port: Number(process.env.PORT || 5000),
    trustProxyHops: parseTrustProxyHops(process.env.TRUST_PROXY_HOPS),
  };
}

module.exports = { loadConfig, parseOrigins, parseTrustProxyHops };
