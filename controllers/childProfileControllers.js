const Profiles = require("../models/childProfile");
const deleteImage = require("../utils/deleteCloudImg");
const mongoose = require("mongoose");
const { calculateGraduation, normalizeStage } = require("../utils/educationGraduation");
const { getPagination, setPaginationHeaders } = require("../utils/pagination");
const { pickEditableChildProfileFields } = require("../utils/childProfileInput");

const PUBLIC_PROFILE_FIELDS = [
  "firstName",
  "secondName",
  "givenName",
  "gender",
  "age",
  "ageGroup",
  "class",
  "nationality",
  "familyStatus",
  "numberOfParents",
  "image.url",
  "background",
  "school",
  "location",
  "needs",
  "monthlyNeed",
  "publicPosterApproved",
  "sponsorshipStatus",
  "education.currentLevel",
  "education.schoolName",
  "education.currentClass",
  "education.academicYear",
  "education.expectedGraduationYear",
].join(" ");

const normalizeEducation = (education = {}, school = "") => {
  if (!education || typeof education !== "object") {
    return {
      isStudying: false,
      educationStage: "",
      currentLevel: "",
      schoolName: school || "",
      classGrade: "",
      currentClass: "",
      academicYear: "",
      enrollmentDate: "",
      courseName: "",
      courseDurationValue: "",
      courseDurationUnit: "",
      expectedGraduationDate: "",
      expectedGraduationYear: "",
      graduationStage: "",
      lastTermResult: "",
      graduationTarget: "",
      educationNotes: "",
    };
  }

  const classGrade = education.classGrade || education.currentClass || "";
  const expectedGraduationYear =
    education.expectedGraduationYear || education.estimatedGraduationYear || "";

  return {
    isStudying: education.isStudying === true || education.isStudying === "true",
    educationStage: normalizeStage(education.educationStage || education.currentLevel),
    currentLevel: education.currentLevel || "",
    schoolName: education.schoolName || school || "",
    classGrade,
    currentClass: classGrade,
    academicYear: education.academicYear || "",
    enrollmentDate: education.enrollmentDate || "",
    courseName: education.courseName || "",
    courseDurationValue: education.courseDurationValue || "",
    courseDurationUnit: education.courseDurationUnit || "",
    expectedGraduationDate: education.expectedGraduationDate || "",
    expectedGraduationYear,
    graduationStage: education.graduationStage || "",
    lastTermResult: education.lastTermResult || "",
    graduationTarget: education.graduationTarget || "",
    educationNotes: education.educationNotes || "",
  };
};

const prepareEducation = (education, school) => {
  const normalized = normalizeEducation(education, school);
  const calculation = calculateGraduation(normalized);

  if (normalized.isStudying && !calculation) {
    const error = new Error(
      "Studying profiles require a valid education stage, enrollment date, and course duration for vocational or university courses.",
    );
    error.statusCode = 400;
    throw error;
  }

  return calculation ? { ...normalized, ...calculation } : normalized;
};

const normalizeReportCards = (reportCards = []) => {
  if (!Array.isArray(reportCards)) {
    return [];
  }

  return reportCards
    .filter((card) => card && (card.url || card.public_id || card.name))
    .map((card) => ({
      ...(card._id ? { _id: card._id } : {}),
      name: card.name || "",
      description: card.description || "",
      url: card.url || "",
      public_id: card.public_id || "",
      fileType: card.fileType || "",
      uploadedAt: card.uploadedAt || new Date(),
    }));
};

//create child profile
exports.createChildProfile = async (req, res) => {
  try {
    const data = req.body || {};
    const stringNeeds = Array.isArray(data.needs)
      ? data.needs.join(", ")
      : data.needs || "";
    const education = prepareEducation(data.education, data.school);

    const payLoad = {
      ...pickEditableChildProfileFields(data),
      needs: stringNeeds,
      education,
    };

    const newProfile = new Profiles({
      ...payLoad,
      sponsorshipStatus: "Available",
      sponsor: null,
    });
    await newProfile.save();
    res
      .status(201)
      .json({
        message: "Child profile created successfully",
        profile: newProfile,
      });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Server error", error: error.message });
    console.log("====================================");
    console.log(error);
    console.log("====================================");
  }
};

exports.updateChildProfile = async (req, res) => {
  try {
    const data = req.body || {};
    const existingProfile = await Profiles.findById(req.params.id);
    if (!existingProfile) {
      return res.status(404).json({ message: "Child profile not found" });
    }
    const stringNeeds = Array.isArray(data.needs)
      ? data.needs.join(", ")
      : data.needs ?? existingProfile.needs ?? "";
    const education = Object.prototype.hasOwnProperty.call(data, "education")
      ? prepareEducation(data.education, data.school)
      : existingProfile.education;

    const payLoad = {
      ...pickEditableChildProfileFields(data),
      needs: stringNeeds,
      education,
    };

    const updatedProfile = await Profiles.findByIdAndUpdate(
      req.params.id,
      payLoad,
      { new: true, runValidators: true },
    );
    if (!updatedProfile) {
      return res.status(404).json({ message: "Child profile not found" });
    }
    res
      .status(200)
      .json({
        message: "Child profile updated successfully",
        profile: updatedProfile,
      });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Server error", error: error.message });
    console.log("====================================");
    console.log(error);
    console.log("====================================");
  }
};

exports.getProfiles = async (req, res) => {
  try {
    const pagination = getPagination(req);
    const [profiles, total] = await Promise.all([
      Profiles.find()
        .populate("sponsor")
        .sort({ createdAt: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit),
      Profiles.countDocuments(),
    ]);

    setPaginationHeaders(res, { ...pagination, total });
    res.status(200).json(profiles);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.log("====================================");
    console.log(error);
    console.log("====================================");
  }
};

exports.getPublicProfiles = async (_req, res) => {
  try {
    const profiles = await Profiles.find({ sponsorshipStatus: "Available" })
      .select(PUBLIC_PROFILE_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    return res.status(200).json(profiles);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load profiles" });
  }
};

exports.deleteChildProfile = async (req, res) => {
  try {
    const deletedProfile = await Profiles.findById(req.params.id);
    if (!deletedProfile) {
      return res.status(404).json({ message: "Child profile not found" });
    }
    await deleteImage(deletedProfile.image);
    await Profiles.findByIdAndDelete(req.params.id);
    res
      .status(200)
      .json({
        message: "Child profile deleted successfully",
        profile: deletedProfile,
      });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.log("====================================");
    console.log(error);
    console.log("====================================");
  }
};

exports.getChildProfileById = async (req, res) => {
  try {
    const profile = await Profiles.findById(req.params.id).populate("sponsor");
    if (!profile) {
      return res.status(404).json({ message: "Child profile not found" });
    }
    res.status(200).json(profile);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.log("====================================");
    console.log(error);
    console.log("====================================");
  }
};

exports.getPublicChildProfileById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Child profile not found" });
    }

    const profile = await Profiles.findOne({
      _id: req.params.id,
      sponsorshipStatus: "Available",
    })
      .select(PUBLIC_PROFILE_FIELDS)
      .lean();

    if (!profile) {
      return res.status(404).json({ message: "Child profile not found" });
    }

    return res.status(200).json(profile);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load profile" });
  }
};

exports.addReportCard = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, url, public_id, fileType } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid child profile id" });
    }
    if (
      !String(name || "").trim() ||
      !String(url || "").trim() ||
      !String(public_id || "").trim()
    ) {
      return res
        .status(400)
        .json({
          message:
            "Report title, image URL, and Cloudinary public ID are required",
        });
    }

    const updatedProfile = await Profiles.findByIdAndUpdate(
      id,
      {
        $push: {
          reportCards: {
            name: String(name).trim(),
            url: String(url).trim(),
            public_id: String(public_id).trim(),
            fileType: String(fileType || "image").trim(),
            uploadedAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    );

    if (!updatedProfile) {
      return res.status(404).json({ message: "Child profile not found" });
    }

    return res.status(201).json({
      message: "Report card uploaded successfully",
      profile: updatedProfile,
      reportCard:
        updatedProfile.reportCards[updatedProfile.reportCards.length - 1],
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Unable to save report card", error: error.message });
  }
};

exports.deleteReportCard = async (req, res) => {
  try {
    const { id, reportCardId } = req.params;
    if (
      !mongoose.isValidObjectId(id) ||
      !mongoose.isValidObjectId(reportCardId)
    ) {
      return res
        .status(400)
        .json({ message: "Invalid child or report card id" });
    }

    const profile = await Profiles.findById(id);
    if (!profile)
      return res.status(404).json({ message: "Child profile not found" });

    const reportCard = profile.reportCards.id(reportCardId);
    if (!reportCard)
      return res.status(404).json({ message: "Report card not found" });

    if (reportCard.public_id) {
      await deleteImage(reportCard.public_id, "image");
    }

    const updatedProfile = await Profiles.findByIdAndUpdate(
      id,
      { $pull: { reportCards: { _id: reportCardId } } },
      { new: true },
    );

    return res.status(200).json({
      message: "Report card deleted successfully",
      profile: updatedProfile,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Unable to delete report card", error: error.message });
  }
};
