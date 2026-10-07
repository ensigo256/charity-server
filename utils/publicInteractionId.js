const PUBLIC_INTERACTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidPublicInteractionId(value) {
  return typeof value === "string" && PUBLIC_INTERACTION_ID_PATTERN.test(value);
}

module.exports = { isValidPublicInteractionId };