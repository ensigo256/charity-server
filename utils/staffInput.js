const EDITABLE_STAFF_FIELDS = [
  "name",
  "email",
  "phone",
  "role",
  "bio",
  "type",
  "status",
  "photo",
  "socialLinks",
];

function pickEditableStaffFields(data = {}) {
  return Object.fromEntries(
    EDITABLE_STAFF_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
      .map((field) => [field, data[field]]),
  );
}

module.exports = { pickEditableStaffFields };