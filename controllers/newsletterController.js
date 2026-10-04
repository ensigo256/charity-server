const mongoose = require('mongoose');
const crypto = require('crypto');
const Subscriber = require('../models/subscriber');
const { sendNewsletterWelcomeEmail } = require('../utils/mail');
const { getPagination, setPaginationHeaders } = require('../utils/pagination');
const notifUtil = require('../utils/notificationUtil');

const VERIFICATION_TOKEN_TTL_MS = Number(process.env.NEWSLETTER_VERIFICATION_TTL_HOURS || 24) * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = Number(process.env.NEWSLETTER_RESEND_COOLDOWN_SECONDS || 300) * 1000;

function normalizeEmail(email = '') {
  return String(email || '').trim().toLowerCase();
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function requireDatabase() {
  if (mongoose.connection.readyState !== 1) {
    const error = new Error('Newsletter service is temporarily unavailable.');
    error.statusCode = 503;
    throw error;
  }
}

function publicSubscriber(subscriber) {
  return {
    _id: subscriber._id,
    email: subscriber.email,
    name: subscriber.name,
    status: subscriber.status,
  };
}

async function sendVerificationEmail(subscriber, verificationToken) {
  await sendNewsletterWelcomeEmail({
    email: subscriber.email,
    name: subscriber.name,
    verificationToken,
    unsubscribeToken: subscriber.unsubscribeToken,
  });
}

async function issueVerification(subscriber) {
  const verificationToken = generateToken();
  const updatedSubscriber = await Subscriber.findByIdAndUpdate(
    subscriber._id,
    {
      status: 'pending',
      verified: false,
      verificationToken,
      verificationTokenExpiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      unsubscribeToken: subscriber.unsubscribeToken || generateToken(),
      lastEmailSentAt: new Date(),
    },
    { new: true, runValidators: true },
  );

  try {
    await sendVerificationEmail(updatedSubscriber, verificationToken);
  } catch (error) {
    console.error('Newsletter verification email failed:', error.message);
    const deliveryError = new Error('Subscription saved, but the verification email could not be sent. Please try again later.');
    deliveryError.statusCode = 503;
    throw deliveryError;
  }

  return updatedSubscriber;
}

exports.subscribeToNewsletter = async (req, res) => {
  try {
    requireDatabase();

    const email = normalizeEmail(req.body?.email);
    const name = String(req.body?.name || '').trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }

    const existingSubscriber = await Subscriber.findOne({ email });

    if (existingSubscriber?.status === 'active') {
      return res.status(200).json({
        message: 'You are already subscribed to our newsletter.',
        subscriber: publicSubscriber(existingSubscriber),
      });
    }

    const subscriber = existingSubscriber || await Subscriber.create({
      email,
      name: name || email.split('@')[0],
      status: 'pending',
      verified: false,
      unsubscribeToken: generateToken(),
      unsubscribed: false,
      unsubscribedAt: null,
      subscribedOn: new Date(),
    });

    if (name && !subscriber.name) subscriber.name = name;

    const updatedSubscriber = await issueVerification(subscriber);

    notifUtil.notifyNewsletterSubscription({ subscriber: updatedSubscriber }).catch((error) => {
      console.error('Newsletter notification failed:', error.message);
    });

    return res.status(existingSubscriber ? 200 : 201).json({
      message: 'A verification email has been sent to confirm your subscription.',
      subscriber: publicSubscriber(updatedSubscriber),
    });
  } catch (error) {
    console.error('Newsletter subscribe error:', error);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to subscribe to the newsletter.' });
  }
};

exports.resendNewsletterVerification = async (req, res) => {
  try {
    requireDatabase();

    const email = normalizeEmail(req.body?.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }

    const subscriber = await Subscriber.findOne({ email });
    if (!subscriber || subscriber.status === 'active') {
      return res.status(200).json({ message: 'If the address requires verification, a new email will be sent shortly.' });
    }

    if (subscriber.lastEmailSentAt && Date.now() - subscriber.lastEmailSentAt.getTime() < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ message: 'Please wait a few minutes before requesting another verification email.' });
    }

    await issueVerification(subscriber);
    return res.status(200).json({ message: 'If the address requires verification, a new email will be sent shortly.' });
  } catch (error) {
    console.error('Newsletter verification resend error:', error);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Unable to resend verification email.' });
  }
};

exports.unsubscribeFromNewsletter = async (req, res) => {
  try {
    requireDatabase();

    const token = String(req.params?.token || '').trim();
    if (!token) return res.status(400).json({ message: 'A valid unsubscribe token is required.' });

    const subscriber = await Subscriber.findOneAndUpdate(
      { unsubscribeToken: token },
      { status: 'unsubscribed', unsubscribed: true, unsubscribedAt: new Date() },
      { new: true, runValidators: true },
    );

    if (!subscriber) return res.status(404).json({ message: 'Unsubscribe link is invalid or expired.' });

    return res.status(200).json({
      message: 'You have been unsubscribed from the newsletter.',
      subscriber: publicSubscriber(subscriber),
    });
  } catch (error) {
    console.error('Newsletter unsubscribe error:', error);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to unsubscribe from the newsletter.' });
  }
};

exports.verifyNewsletterSubscription = async (req, res) => {
  try {
    requireDatabase();

    const token = String(req.params?.token || '').trim();
    if (!token) return res.status(400).json({ message: 'Verification token is required.' });

    const subscriber = await Subscriber.findOne({
      verificationToken: token,
      verificationTokenExpiresAt: { $gt: new Date() },
    });

    if (!subscriber) return res.status(404).json({ message: 'Verification token is invalid or expired.' });

    const updatedSubscriber = await Subscriber.findByIdAndUpdate(
      subscriber._id,
      {
        status: 'active',
        verified: true,
        verificationToken: null,
        verificationTokenExpiresAt: null,
        unsubscribed: false,
        unsubscribedAt: null,
      },
      { new: true, runValidators: true },
    );

    return res.status(200).json({
      message: 'Your newsletter subscription has been confirmed.',
      subscriber: publicSubscriber(updatedSubscriber),
    });
  } catch (error) {
    console.error('Newsletter verification error:', error);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to verify newsletter subscription.' });
  }
};

exports.getNewsletterSubscribers = async (req, res) => {
  try {
    requireDatabase();
    const pagination = getPagination(req);
    const [subscribers, total] = await Promise.all([
      Subscriber.find()
        .sort({ subscribedOn: -1, _id: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .select('-__v -verificationToken -verificationTokenExpiresAt -unsubscribeToken'),
      Subscriber.countDocuments(),
    ]);
    setPaginationHeaders(res, { ...pagination, total });
    return res.status(200).json(subscribers);
  } catch (error) {
    console.error('Get newsletter subscribers error:', error);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to fetch newsletter subscribers.' });
  }
};
