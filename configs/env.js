const dotenv = require("dotenv");

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function requireValue(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadConfig() {
  const jwtSecret = requireValue("JWT_SECRET");
  const dbUrl = requireValue("DB_URL");
  const allowedOrigins = parseOrigins(process.env.ALLOWED_ORIGINS);

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
  };
}

module.exports = { loadConfig };
