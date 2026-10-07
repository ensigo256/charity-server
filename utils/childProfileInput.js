const EDITABLE_CHILD_PROFILE_FIELDS = [
  "firstName",
  "secondName",
  "givenName",
  "gender",
  "dateOfBirth",
  "age",
  "ageGroup",
  "class",
  "nationality",
  "familyStatus",
  "numberOfParents",
  "guardianName",
  "guardianContact",
  "guardianRelation",
  "image",
  "background",
  "location",
  "needs",
  "school",
  "monthlyNeed",
  "publicPosterApproved",
  "education",
];

function pickEditableChildProfileFields(data = {}) {
  return Object.fromEntries(
    EDITABLE_CHILD_PROFILE_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
      .map((field) => [field, data[field]]),
  );
}

module.exports = { pickEditableChildProfileFields };