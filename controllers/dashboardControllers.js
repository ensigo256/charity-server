const ChildProfile = require("../models/childProfile");
const Sponsor = require("../models/sponsor");
const Sponsorships = require("../models/sponsorships");

const ACTIVE_SPONSORSHIP_STATUSES = ["Active", "Pending"];

exports.getDashboardSummary = async (_req, res) => {
  try {
    const [children, sponsors, sponsorships] = await Promise.all([
      ChildProfile.find(
        {},
        "firstName secondName sponsorshipStatus reportCards",
      ).lean(),
      Sponsor.countDocuments({ isArchived: { $ne: true } }),
      Sponsorships.find({})
        .populate("child", "firstName secondName")
        .populate("donor", "profile sponsor")
        .lean(),
    ]);

    const currentSponsorships = sponsorships.filter((item) =>
      ACTIVE_SPONSORSHIP_STATUSES.includes(item.status),
    );
    const allPayments = sponsorships.flatMap((sponsorship) =>
      (sponsorship.payments || []).map((payment) => ({
        ...payment,
        sponsorshipId: sponsorship._id,
        child: sponsorship.child,
        sponsor: sponsorship.donor,
      })),
    );
    const completedPayments = allPayments.filter(
      (payment) => payment.status === "Completed",
    );

    const getSponsorName = (sponsor) =>
      sponsor?.profile?.fullName ||
      sponsor?.sponsor?.name ||
      sponsor?.name ||
      "Unknown sponsor";
    const getChildName = (child) =>
      [child?.firstName, child?.secondName].filter(Boolean).join(" ") ||
      "Unknown child";
    const sponsoredChildIds = new Set(
      currentSponsorships
        .map((item) => item.child?._id || item.child)
        .filter(Boolean)
        .map(String),
    );

    const recentPayments = [...allPayments]
      .sort(
        (left, right) => new Date(right.date || 0) - new Date(left.date || 0),
      )
      .slice(0, 8)
      .map((payment) => ({
        id: payment._id,
        sponsorshipId: payment.sponsorshipId,
        amount: Number(payment.amount || 0),
        currency: payment.currency || "UGX",
        method: payment.method || "Unknown",
        status: payment.status || "Pending",
        date: payment.date,
        transactionId: payment.transactionId,
        childName: getChildName(payment.child),
        sponsorName: getSponsorName(payment.sponsor),
      }));

    return res.status(200).json({
      children: {
        total: children.length,
        sponsored: sponsoredChildIds.size,
        available: Math.max(children.length - sponsoredChildIds.size, 0),
      },
      sponsors: { totalActive: sponsors },
      sponsorships: {
        active: sponsorships.filter((item) => item.status === "Active").length,
        pending: sponsorships.filter((item) => item.status === "Pending")
          .length,
        cancelled: sponsorships.filter((item) => item.status === "Cancelled")
          .length,
        totalPledged: currentSponsorships.reduce(
          (total, item) => total + Number(item.amount || 0),
          0,
        ),
      },
      payments: {
        completedCount: completedPayments.length,
        totalReceived: completedPayments.reduce(
          (total, payment) => total + Number(payment.amount || 0),
          0,
        ),
        pendingCount: allPayments.filter(
          (payment) => payment.status === "Pending",
        ).length,
        failedCount: allPayments.filter(
          (payment) => payment.status === "Failed",
        ).length,
        currency: "UGX",
      },
      reportCards: {
        total: children.reduce(
          (total, child) =>
            total +
            (Array.isArray(child.reportCards) ? child.reportCards.length : 0),
          0,
        ),
      },
      recentPayments,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unable to load dashboard summary",
      error: error.message,
    });
  }
};
