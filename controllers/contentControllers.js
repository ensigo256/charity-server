const Content = require("../models/content");

const defaultContent = [
  {
    id: "hero",
    title: "Hero Section",
    section: "Home",
    content: "Planting Seeds of Love & Hope - Empowering communities through education, nutrition, and sustainable development. One seed at a time.",
    status: "published",
  },
  {
    id: "hero-subtitle",
    title: "Hero Subtitle",
    section: "Home",
    content: "Empowering communities through education, nutrition, and sustainable development. One seed at a time.",
    status: "published",
  },
  {
    id: "about",
    title: "About Us",
    section: "About",
    content: "Founded in 2015, Seeds of Love Foundation has been at the forefront of creating sustainable change in communities across Africa. We believe that education and proper nutrition are the seeds to unlock potential in every child.",
    status: "published",
  },
  {
    id: "mission",
    title: "Mission Statement",
    section: "About",
    content: "To empower individuals and communities by providing access to quality education, nutritious food, and sustainable development opportunities that transform lives and create lasting positive change.",
    status: "published",
  },
  {
    id: "vision",
    title: "Vision Statement",
    section: "About",
    content: "A world where every child has access to quality education and nutrition, enabling them to reach their full potential and contribute meaningfully to their communities.",
    status: "published",
  },
  {
    id: "cta-primary",
    title: "Primary CTA",
    section: "Home",
    content: "Get Involved Today - Make a lasting impact by supporting our programs. Your contribution helps us reach more children and communities in need.",
    status: "draft",
  },
  {
    id: "donate-info",
    title: "Donation Page Intro",
    section: "Get Involved",
    content: "Your support makes a real difference. Every donation, regardless of size, helps us expand our programs and reach more children in need of education and nutrition support.",
    status: "published",
  },
  {
    id: "volunteer-info",
    title: "Volunteer Information",
    section: "Get Involved",
    content: "Join our team of dedicated volunteers. We offer flexible opportunities to contribute your time and skills to our various programs and initiatives.",
    status: "published",
  },
  {
    id: "programs-intro",
    title: "Programs Page Introduction",
    section: "Programs",
    content: "Our comprehensive programs are designed to address the most pressing challenges in education and nutrition. Each program is tailored to meet the specific needs of the communities we serve.",
    status: "published",
  },
  {
    id: "contact-intro",
    title: "Contact Page Introduction",
    section: "Contact",
    content: "We would love to hear from you. Please reach out with any questions, inquiries, or opportunities to collaborate. Our team is here to help.",
    status: "published",
  },
];

async function ensureDefaults() {
  if ((await Content.countDocuments()) === 0) {
    await Content.insertMany(defaultContent);
  }
}

function cleanPayload(body) {
  return {
    title: String(body.title || "").trim(),
    section: String(body.section || "").trim(),
    content: String(body.content || ""),
    status: body.status === "published" ? "published" : "draft",
  };
}

exports.getContent = async (req, res) => {
  try {
    await ensureDefaults();
    const query = {};
    if (typeof req.query.section === "string" && req.query.section) {
      query.section = req.query.section;
    }
    query.status = req.query.status === "draft" ? "draft" : "published";
    const items = await Content.find(query).sort({ updatedAt: -1 }).select("-__v");
    return res.status(200).json(items);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load content", error: error.message });
  }
};

exports.getContentById = async (req, res) => {
  try {
    const item = await Content.findOne({ id: req.params.id }).select("-__v");
    if (!item || item.status !== "published") {
      return res.status(404).json({ message: "Content not found" });
    }
    return res.status(200).json(item);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load content", error: error.message });
  }
};

exports.createContent = async (req, res) => {
  try {
    const payload = cleanPayload(req.body);
    if (!payload.title || !payload.section || !payload.content) {
      return res.status(400).json({ message: "Title, section, and content are required" });
    }
    const item = await Content.create({
      ...payload,
      id: req.body.id || `content-${Date.now()}`,
      publishedAt: payload.status === "published" ? new Date() : undefined,
    });
    return res.status(201).json(item);
  } catch (error) {
    const status = error.code === 11000 ? 409 : 500;
    return res.status(status).json({ message: "Unable to create content", error: error.message });
  }
};

exports.updateContent = async (req, res) => {
  try {
    const payload = cleanPayload(req.body);
    if (!payload.title || !payload.section || !payload.content) {
      return res.status(400).json({ message: "Title, section, and content are required" });
    }
    const update = {
      ...payload,
      publishedAt: payload.status === "published" ? new Date() : null,
    };
    const item = await Content.findOneAndUpdate({ id: req.params.id }, update, {
      new: true,
      runValidators: true,
    }).select("-__v");
    if (!item) return res.status(404).json({ message: "Content not found" });
    return res.status(200).json(item);
  } catch (error) {
    return res.status(500).json({ message: "Unable to update content", error: error.message });
  }
};

exports.deleteContent = async (req, res) => {
  try {
    const item = await Content.findOneAndDelete({ id: req.params.id });
    if (!item) return res.status(404).json({ message: "Content not found" });
    return res.status(200).json({ message: "Content deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Unable to delete content", error: error.message });
  }
};