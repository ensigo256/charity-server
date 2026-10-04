const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const { connectDb } = require("./configs/connectDb.js");
const { loadConfig } = require("./configs/env.js");
const { generateSponsorDueReminders } = require("./utils/notificationUtil");
const { processSponsorReminderEmails } = require("./utils/sponsorReminderService");
const Admin = require("./models/admin");
const Sponsorships = require("./models/sponsorships");

const app = express();
const config = loadConfig();
const PORT = config.port;

const corsOptions = {
  origin(origin, callback) {
    if (!origin || config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin is not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["X-Page", "X-Page-Size", "X-Total-Count", "X-Page-Count"],
};

app.use(cors(corsOptions));

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Compression
app.use(compression());

// parse JSON request bodies
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

// Import routes
const blogRoutes = require("./routes/blogRoutes");
const eventRoutes = require("./routes/eventRoutes.js");
const staffRoutes = require("./routes/staffRoutes");
const messageRoutes = require("./routes/messageRoutes");
const authRoutes = require("./routes/authRoutes");
const commentRoutes = require("./routes/commentRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const galleryRoutes = require("./routes/galleryRoutes");
const childProfileRoutes = require("./routes/childProfileRoutes");
const sponsorshipRoutes = require("./routes/sponsorshipRoutes");
const contentRoutes = require("./routes/contentRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const newsletterRoutes = require("./routes/newsletterRoutes");

app.use("/api/blogs", blogRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/gallery", galleryRoutes);
app.use("/api/children", childProfileRoutes);
app.use("/api/sponsors", sponsorshipRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/newsletter", newsletterRoutes);

// Error handling middleware (must be last)
// app.use(errorHandler);

async function checkSponsorReminders() {
  try {
    const admins = await Admin.find({ isActive: true }).select("_id");
    if (!admins.length) {
      return [];
    }

    const sponsorships = await Sponsorships.find({
      status: { $in: ["Active", "Pending"] },
    })
      .populate("donor")
      .sort({ lastPayment: 1, createdAt: -1 });

    const sponsorSummaries = sponsorships.map((sponsorship) => {
      const donor = sponsorship.donor || {};
      return {
        _id: donor._id || sponsorship.donor,
        profile: donor.profile || {},
        sponsor: donor.sponsor || {},
        donation: donor.donation || {
          amount: sponsorship.amount,
          period: sponsorship.frequency || "Monthly",
        },
        email: donor.profile?.email || donor.email || "",
        amount: sponsorship.amount,
        lastPaymentDate: sponsorship.lastPayment || sponsorship.startDate || sponsorship.createdAt,
        paymentPeriod: sponsorship.frequency || donor.donation?.period || "Monthly",
        startDate: sponsorship.startDate,
        frequency: sponsorship.frequency,
        expectedFundsDate: sponsorship.expectedFundsDate || donor.donation?.expectedFundsDate,
      };
    });

    return generateSponsorDueReminders({
      sponsors: sponsorSummaries,
      userIds: admins.map((admin) => admin._id),
      referenceDate: new Date(),
      dueWindowDays: 7,
    });
  } catch (error) {
    console.error("Sponsor reminder check failed:", error.message);
    return [];
  }
}

let reminderChecksRunning = false;

async function runReminderChecks() {
  if (reminderChecksRunning) return;
  reminderChecksRunning = true;

  try {
    const results = await Promise.allSettled([
      checkSponsorReminders(),
      processSponsorReminderEmails(),
    ]);
    results.forEach((result) => {
      if (result.status === "rejected") {
        console.error("Reminder check failed:", result.reason?.message || result.reason);
      }
    });
  } finally {
    reminderChecksRunning = false;
  }
}

// Connect to DB, then start server
connectDb(config.dbUrl)
  .then(() => {
    void runReminderChecks();
    setInterval(() => {
      void runReminderChecks();
    }, 60 * 60 * 1000);

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    // logger.error('Failed to start server due to DB connection error:', err);
    console.error(
      "Failed to start server due to DB connection error:",
      err.message,
    );
    process.exit(1);
  });
