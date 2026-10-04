const jwt = require("jsonwebtoken");
const Admin = require("../models/admin");
const AdminSession = require("../models/adminSession");

const permissions = {
  developer: new Set([
    "dashboard.view",
    "analytics.view",
    "children.view",
    "children.manage",
    "sponsorships.view",
    "sponsorships.manage",
    "staff.view",
    "staff.manage",
    "blogs.view",
    "blogs.manage",
    "events.view",
    "events.manage",
    "gallery.view",
    "gallery.manage",
    "content.view",
    "content.manage",
    "donations.view",
    "settings.view",
    "messages.view",
    "messages.manage",
    "newsletter.view",
    "notifications.view",
    "notifications.manage",
    "comments.manage",
    "data.export",
    "users.manage",
  ]),
  admin: new Set([
    "dashboard.view",
    "children.view",
    "children.manage",
    "sponsorships.view",
    "sponsorships.manage",
    "staff.view",
    "staff.manage",
    "messages.view",
    "messages.manage",
  ]),
  editor: new Set([
    "blogs.view",
    "blogs.manage",
    "events.view",
    "events.manage",
    "gallery.view",
    "gallery.manage",
  ]),
};

async function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== "access" || !payload.sessionId) {
      return res.status(401).json({ message: "Invalid access token" });
    }

    const [admin, session] = await Promise.all([
      Admin.findById(payload.id).select("_id role isActive"),
      AdminSession.findOne({
        sessionId: payload.sessionId,
        admin: payload.id,
        revokedAt: null,
        loggedOutAt: null,
        expiresAt: { $gt: new Date() },
      }).select("_id lastActivityAt"),
    ]);
    if (!admin || admin.isActive === false || !session) {
      return res.status(401).json({ message: "Session is no longer valid" });
    }

    req.admin = { ...payload, role: admin.role };
    const activityCutoff = new Date(Date.now() - 60 * 1000);
    if (!session.lastActivityAt || session.lastActivityAt < activityCutoff) {
      void AdminSession.updateOne(
        { _id: session._id, lastActivityAt: { $lt: activityCutoff } },
        { $set: { lastActivityAt: new Date() } },
      ).catch(() => {});
    }
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    const role = String(req.admin?.role || "").toLowerCase();
    if (!permissions[role] || !permissions[role].has(permission)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    return next();
  };
}

module.exports = { requireAuth, requirePermission };
