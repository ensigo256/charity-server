const mongoose = require("mongoose");

const reportCardSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    description: { type: String, trim: true },
    url: { type: String, trim: true },
    public_id: { type: String, trim: true },
    fileType: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const educationSchema = new mongoose.Schema(
  {
    isStudying: { type: Boolean, default: false },
    educationStage: { type: String, trim: true },
    currentLevel: { type: String, trim: true },
    schoolName: { type: String, trim: true },
    classGrade: { type: String, trim: true },
    currentClass: { type: String, trim: true },
    academicYear: { type: String, trim: true },
    enrollmentDate: { type: Date },
    courseName: { type: String, trim: true },
    courseDurationValue: { type: Number, min: 0 },
    courseDurationUnit: { type: String, enum: ['months', 'years'] },
    expectedGraduationDate: { type: Date },
    expectedGraduationYear: { type: String, trim: true },
    graduationStage: { type: String, trim: true },
    lastTermResult: { type: String, trim: true },
    graduationTarget: { type: String, trim: true },
    educationNotes: { type: String, trim: true },
  },
  { _id: false },
);

const estimateEducationGraduationYear = (currentLevel = '', currentClass = '') => {
  const raw = `${currentLevel} ${currentClass}`.toLowerCase();

  if (raw.includes('primary')) return String(new Date().getFullYear() + 5);
  if (raw.includes('secondary') || raw.includes('senior')) return String(new Date().getFullYear() + 4);
  if (raw.includes('college') || raw.includes('university') || raw.includes('tertiary')) return String(new Date().getFullYear() + 4);
  if (raw.includes('vocational')) return String(new Date().getFullYear() + 2);

  return String(new Date().getFullYear() + 3);
};

const childrenProfilesSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    secondName: { type: String, required: true },
    givenName: { type: String, required: true },
    gender: { type: String, required: true, enum: ['Male', 'Female'] },
    dateOfBirth: { type: Date, required: true },
    age: { type: Number, required: true },
    ageGroup: { type: String, required: true },
    class: { type: String, required: true },
    nationality: { type: String, required: true },
    familyStatus: { type: String, required: true, enum: ['Single Parent', 'Total Orphans'] },
    numberOfParents: { type: Number, required: true },
    guardianName: { type: String, trim: true },
    guardianContact: { type: String, trim: true },
    guardianRelation: {
      type: String,
      enum: ['caretaker', 'mom', 'dad', 'sibling', 'uncle', 'aunt', 'grandparent'],
      trim: true,
    },
    image: { url: { type: String }, public_id: { type: String } },
    background: { type: String, trim: true },
    location: { type: String, trim: true },
    needs: { type: String, trim: true },
    sponsorshipStatus: { type: String, enum: ['Sponsored', 'Available'], default: 'Available' },
    sponsor: { type: mongoose.Schema.Types.ObjectId, ref: 'Sponsor' },
    school: { type: String, trim: true },
    monthlyNeed: { type: Number, trim: true },
    publicPosterApproved: { type: Boolean, default: false },
    education: {
      type: educationSchema,
      default: {
        educationStage: '',
        currentLevel: '',
        schoolName: '',
        currentClass: '',
        academicYear: '',
        enrollmentDate: '',
        courseName: '',
        courseDurationValue: '',
        courseDurationUnit: '',
        expectedGraduationDate: '',
        lastTermResult: '',
        graduationTarget: '',
        expectedGraduationYear: '',
        graduationStage: '',
        educationNotes: '',
      },
    },
    reportCards: [reportCardSchema],
  },

  { timestamps: true },
);
childrenProfilesSchema.index({ createdAt: -1, _id: -1 });
childrenProfilesSchema.index({ sponsorshipStatus: 1, createdAt: -1, _id: -1 });
childrenProfilesSchema.index({ sponsor: 1, createdAt: -1, _id: -1 });

childrenProfilesSchema.pre('save', function(next) {
  next();
});

const ChildProfile = mongoose.model("ChildProfile", childrenProfilesSchema);

module.exports = ChildProfile;
