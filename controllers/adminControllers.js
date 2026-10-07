const AdminSession = require("../models/adminSession");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("node:crypto");
const { validationResult } = require("express-validator");
const Admin = require('../models/admin')

const REFRESH_COOKIE_NAME = "charity-admin-refresh";
const ACCESS_TOKEN_EXPIRY = "15m";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

const minimumPasswordLength = () => 12;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function safeAdmin(admin, extra = {}) {
    return {
        id: String(admin._id),
        username: admin.username,
        role: admin.role,
        isActive: admin.isActive !== false,
        createdAt: admin.createdAt,
        lastLogin: admin.lastLogin || null,
        ...extra,
    };
}

function getSessionMetadata(req) {
    return {
        ipAddress: String(req.ip || "").slice(0, 100),
        userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
    };
}

async function revokeAdminSessions(adminId, reason) {
    const now = new Date();
    await AdminSession.updateMany(
        { admin: adminId, revokedAt: null, loggedOutAt: null },
        { $set: { revokedAt: now, revocationReason: reason } },
    );
    await Admin.updateOne({ _id: adminId }, { $inc: { tokenVersion: 1 }, $set: { loggedIn: false } });
}

async function protectsLastDeveloper(admin, nextRole = admin.role, nextActive = admin.isActive !== false) {
    if (admin.role !== "developer" || admin.isActive === false || (nextRole === "developer" && nextActive)) return false;
    return (await Admin.countDocuments({ role: "developer", isActive: { $ne: false } })) <= 1;
}

function getRefreshToken(req) {
    const cookieHeader = String(req.headers.cookie || "");
    const cookie = cookieHeader
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${REFRESH_COOKIE_NAME}=`));
    return cookie ? decodeURIComponent(cookie.slice(REFRESH_COOKIE_NAME.length + 1)) : null;
}

function refreshCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/api/auth/admin",
        maxAge: 7 * 24 * 60 * 60 * 1000,
    };
}

function issueAccessToken(admin, sessionId) {
    return jwt.sign(
        { id: admin._id, role: admin.role, sessionId, type: "access" },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY },
    );
}

function issueRefreshToken(admin, sessionId, refreshTokenId) {
    return jwt.sign(
        { id: admin._id, sessionId, refreshTokenId, tokenVersion: admin.tokenVersion || 0, type: "refresh" },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRY || "7d" },
    );
}

exports.registerAdmin = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: "Validation errors", errors: errors.array() });
        }

        const { password } = req.body;
        const username = String(req.body.username || "").trim();
        const role = req.body.role || "admin";
        if (password.length < minimumPasswordLength()) {
            return res.status(400).json({ message: `Password must be at least ${minimumPasswordLength()} characters.` });
        }
        const existingAdmin = await Admin.findOne({ username: new RegExp(`^${escapeRegExp(username)}$`, "i") });
        if (existingAdmin) {
            return res.status(400).json({ message: "Admin with this username already exists" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newAdmin = new Admin({
            username,
            password: hashedPassword,
            role: role || "admin",
            isActive: true,
        });
        await newAdmin.save();
        // logger.info(`New admin registered: ${username}`);
        res.status(201).json({ message: "Admin registered successfully", user: safeAdmin(newAdmin) });

    } catch (error) {
        //  logger.error('Admin registration error:', error);
        res.status(500).json({ message: "Server error", error: error.message });
    }
}

exports.loginAdmin = async (req, res) => { 
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: "Validation errors", errors: errors.array() });
        }

        const { username, password } = req.body;
        const normalizedUsername = String(username).trim();
        const admin = await Admin.findOne({ username: new RegExp(`^${escapeRegExp(normalizedUsername)}$`, "i") });
        if (!admin || admin.isActive === false) {
            return res.status(400).json({ message: "Invalid credentials" });
        }
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        const sessionId = randomUUID();
        const refreshTokenId = randomUUID();
        const loggedInAt = new Date();
        await AdminSession.create({
            admin: admin._id,
            sessionId,
            refreshTokenId,
            loginAt: loggedInAt,
            lastActivityAt: loggedInAt,
            expiresAt: new Date(loggedInAt.getTime() + SESSION_DURATION_MS),
            ...getSessionMetadata(req),
        });
        const token = issueAccessToken(admin, sessionId);
        const refreshToken = issueRefreshToken(admin, sessionId, refreshTokenId);
        admin.loggedIn = true;
        admin.lastLogin = loggedInAt;
        await admin.save();

        // logger.info(`Admin logged in: ${username}`);
        res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
        const adminData = {
            id: admin._id,
            username: admin.username,
            role: admin.role,
            token: token,
        };

        res.status(200).json(adminData);

    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
}

exports.refreshAdmin = async (req, res) => {
    try {
        const refreshToken = getRefreshToken(req);
        if (!refreshToken) {
            return res.status(401).json({ message: "Refresh session required" });
        }

        const payload = jwt.verify(refreshToken, process.env.JWT_SECRET);
        if (payload.type !== "refresh" || !payload.sessionId) {
            return res.status(401).json({ message: "Invalid refresh session" });
        }

        const admin = await Admin.findById(payload.id).select("_id username role tokenVersion isActive");
        if (!admin || admin.isActive === false || (admin.tokenVersion || 0) !== (payload.tokenVersion || 0)) {
            return res.status(401).json({ message: "Refresh session expired" });
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
        const nextRefreshTokenId = randomUUID();
        const sessionFilter = {
            sessionId: payload.sessionId,
            admin: payload.id,
            revokedAt: null,
            loggedOutAt: null,
            expiresAt: { $gt: now },
            refreshTokenId: payload.refreshTokenId || null,
        };
        const session = await AdminSession.findOneAndUpdate(
            sessionFilter,
            {
                $set: {
                    refreshTokenId: nextRefreshTokenId,
                    lastActivityAt: now,
                    expiresAt,
                },
            },
            { new: true },
        );
        if (!session) {
            return res.status(401).json({ message: "Refresh session expired or already rotated" });
        }

        res.cookie(REFRESH_COOKIE_NAME, issueRefreshToken(admin, session.sessionId, nextRefreshTokenId), refreshCookieOptions());
        return res.status(200).json({
            id: admin._id,
            username: admin.username,
            role: admin.role,
            token: issueAccessToken(admin, session.sessionId),
        });
    } catch {
        return res.status(401).json({ message: "Invalid or expired refresh session" });
    }
}

exports.getCurrentAdmin = async (req, res) => {
    try {
        const admin = await Admin.findById(req.admin.id).select("_id username role");
        if (!admin) {
            return res.status(404).json({ message: "Admin not found" });
        }

        return res.status(200).json({
            id: admin._id,
            username: admin.username,
            role: admin.role,
        });
    } catch (error) {
        return res.status(500).json({ message: "Server error", error: error.message });
    }
}

exports.logoutAdmin = async (req, res) => { 
    try {
        const admin = await Admin.findById(req.admin.id);
        if (!admin) {
            return res.status(404).json({ message: "Admin not found!" });
        }
        const now = new Date();
        await AdminSession.updateOne(
            { admin: admin._id, sessionId: req.admin.sessionId, loggedOutAt: null, revokedAt: null },
            { $set: { loggedOutAt: now, lastActivityAt: now } },
        );
        const hasOtherActiveSessions = await AdminSession.exists({
            admin: admin._id,
            sessionId: { $ne: req.admin.sessionId },
            revokedAt: null,
            loggedOutAt: null,
            expiresAt: { $gt: now },
        });
        admin.loggedIn = Boolean(hasOtherActiveSessions);
        await admin.save();
        res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
        // logger.info(`Admin logged out: ${admin.username}`);
        res.status(200).json({ message: "Logout successful" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
}

exports.listAdmins = async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
        const search = String(req.query.search || "").trim();
        const filter = search
            ? { username: { $regex: escapeRegExp(search), $options: "i" } }
            : {};
        const [admins, total] = await Promise.all([
            Admin.find(filter).select("_id username role isActive createdAt lastLogin").sort({ username: 1, _id: 1 }).skip((page - 1) * limit).limit(limit),
            Admin.countDocuments(filter),
        ]);
        const onlineCutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
        const onlineSessions = await AdminSession.aggregate([
            { $match: { admin: { $in: admins.map((admin) => admin._id) }, revokedAt: null, loggedOutAt: null, expiresAt: { $gt: new Date() }, lastActivityAt: { $gte: onlineCutoff } } },
            { $group: { _id: "$admin", count: { $sum: 1 } } },
        ]);
        const sessionCounts = new Map(onlineSessions.map((entry) => [String(entry._id), entry.count]));
        return res.status(200).json({
            users: admins.map((admin) => safeAdmin(admin, { recentActiveSessions: sessionCounts.get(String(admin._id)) || 0 })),
            pagination: { page, limit, total, pageCount: Math.ceil(total / limit) },
        });
    } catch (error) {
        return res.status(500).json({ message: "Unable to list users", error: error.message });
    }
};

exports.updateAdmin = async (req, res) => {
    try {
        const admin = await Admin.findById(req.params.id);
        if (!admin) return res.status(404).json({ message: "User not found" });
        const nextRole = req.body.role ?? admin.role;
        const nextActive = req.body.isActive ?? admin.isActive !== false;
        if (req.body.username !== undefined) {
            const username = String(req.body.username).trim();
            const duplicate = await Admin.findOne({ _id: { $ne: admin._id }, username: { $regex: `^${escapeRegExp(username)}$`, $options: "i" } });
            if (duplicate) return res.status(409).json({ message: "A user with this username already exists" });
            admin.username = username;
        }
        if (req.admin.id === String(admin._id) && (nextActive === false || nextRole !== "developer")) {
            return res.status(400).json({ message: "You cannot deactivate or demote your own account" });
        }
        const passwordChanged = req.body.password !== undefined;
        if (nextRole === "developer" && admin.role !== "developer" && !passwordChanged) {
            return res.status(400).json({ message: "Promoting an account to developer requires a new password of at least 12 characters." });
        }
        if (passwordChanged) {
            const password = String(req.body.password);
            const minimum = minimumPasswordLength();
            if (password.length < minimum || password.length > 128) {
                return res.status(400).json({ message: `Password must be between ${minimum} and 128 characters.` });
            }
            admin.password = await bcrypt.hash(password, 10);
        }
        if (await protectsLastDeveloper(admin, nextRole, nextActive)) {
            return res.status(409).json({ message: "The last active developer account cannot be deactivated or demoted" });
        }
        const accessChanged = nextRole !== admin.role || nextActive !== (admin.isActive !== false) || passwordChanged;
        admin.role = nextRole;
        admin.isActive = nextActive;
        await admin.save();
        if (accessChanged) await revokeAdminSessions(admin._id, "Account access changed");
        return res.status(200).json({ message: "User updated", user: safeAdmin(admin) });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: "A user with this username already exists" });
        return res.status(500).json({ message: "Unable to update user", error: error.message });
    }
};

exports.resetAdminPassword = async (req, res) => {
    try {
        const admin = await Admin.findById(req.params.id);
        if (!admin) return res.status(404).json({ message: "User not found" });
        const password = String(req.body.password || "");
        const minimum = minimumPasswordLength();
        if (password.length < minimum || password.length > 128) {
            return res.status(400).json({ message: `Password must be between ${minimum} and 128 characters.` });
        }
        admin.password = await bcrypt.hash(password, 10);
        await admin.save();
        await revokeAdminSessions(admin._id, "Password reset");
        return res.status(200).json({ message: "Password reset; all active sessions were revoked" });
    } catch (error) {
        return res.status(500).json({ message: "Unable to reset password", error: error.message });
    }
};

exports.deactivateAdmin = async (req, res) => {
    try {
        const admin = await Admin.findById(req.params.id);
        if (!admin) return res.status(404).json({ message: "User not found" });
        if (req.admin.id === String(admin._id)) return res.status(400).json({ message: "You cannot deactivate your own account" });
        if (await protectsLastDeveloper(admin, admin.role, false)) {
            return res.status(409).json({ message: "The last active developer account cannot be deactivated" });
        }
        admin.isActive = false;
        await admin.save();
        await revokeAdminSessions(admin._id, "Account deactivated");
        return res.status(200).json({ message: "User deactivated", user: safeAdmin(admin) });
    } catch (error) {
        return res.status(500).json({ message: "Unable to deactivate user", error: error.message });
    }
};

exports.getAdminSessions = async (req, res) => {
    try {
        const admin = await Admin.findById(req.params.id).select("_id");
        if (!admin) return res.status(404).json({ message: "User not found" });
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
        const sessions = await AdminSession.find({ admin: admin._id }).sort({ loginAt: -1, _id: -1 }).limit(limit).select("sessionId loginAt lastActivityAt expiresAt loggedOutAt revokedAt revocationReason ipAddress userAgent");
        const onlineCutoff = Date.now() - ONLINE_WINDOW_MS;
        return res.status(200).json({ sessions: sessions.map((session) => ({
            ...session.toObject(),
            isRecentlyActive: !session.loggedOutAt && !session.revokedAt && session.expiresAt > new Date() && session.lastActivityAt.getTime() >= onlineCutoff,
        })) });
    } catch (error) {
        return res.status(500).json({ message: "Unable to load login history", error: error.message });
    }
};

exports.revokeAdminSession = async (req, res) => {
    try {
        const session = await AdminSession.findOne({ admin: req.params.id, sessionId: req.params.sessionId });
        if (!session) return res.status(404).json({ message: "Session not found" });
        if (!session.loggedOutAt && !session.revokedAt) {
            session.revokedAt = new Date();
            session.revocationReason = "Revoked by developer";
            await session.save();
        }
        return res.status(200).json({ message: "Session revoked" });
    } catch (error) {
        return res.status(500).json({ message: "Unable to revoke session", error: error.message });
    }
};

exports.revokeAllAdminSessions = async (req, res) => {
    try {
        if (!(await Admin.exists({ _id: req.params.id }))) return res.status(404).json({ message: "User not found" });
        await revokeAdminSessions(req.params.id, "Revoked by developer");
        return res.status(200).json({ message: "All user sessions revoked" });
    } catch (error) {
        return res.status(500).json({ message: "Unable to revoke sessions", error: error.message });
    }
};

