const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Payment = require("../models/Payment");
const {
  getAppointmentBilling,
  updateAppointmentPaymentStatus,
  sendPaymentNotification,
} = require("../services/downstreamClients");
const { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } = require("../config/paymentConfig");
const logger = require("../utils/logger");

const mapStripeStatusToLocalStatus = (stripeStatus) => {
  if (stripeStatus === "succeeded") return "succeeded";
  if (stripeStatus === "canceled" || stripeStatus === "requires_payment_method") {
    return "failed";
  }

  return "pending";
};

const mapLocalStatusToAppointmentStatus = (paymentStatus) => {
  if (paymentStatus === "succeeded") return "CONFIRMED";
  if (paymentStatus === "pending") return "PENDING";
  return "FAILED";
};

const canAccessPayment = (payment, user) => {
  if (user.role === "admin" || user.role === "service") return true;
  if (user.role === "patient" && payment.patientId === user.id) return true;
  if (user.role === "doctor" && payment.doctorId === user.id) return true;
  return false;
};

const resolveCurrency = (requestedCurrency, appointmentCurrency) => {
  const candidate = (requestedCurrency || appointmentCurrency || DEFAULT_CURRENCY).toLowerCase();
  if (!SUPPORTED_CURRENCIES.includes(candidate)) {
    const err = new Error(`Unsupported currency '${candidate}'`);
    err.statusCode = 400;
    throw err;
  }

  return candidate;
};

const createSyncState = (status, errorMessage, previousRetryCount = 0) => {
  const now = new Date();
  const state = {
    status,
    lastAttemptAt: now,
  };

  if (status === "success") {
    state.lastSuccessAt = now;
    state.lastError = null;
    state.retryCount = 0;
  } else {
    state.lastError = errorMessage;
    state.retryCount = previousRetryCount + 1;
  }

  return state;
};

const syncPaymentLifecycle = async (payment) => {
  const appointmentStatus = mapLocalStatusToAppointmentStatus(payment.status);
  const notificationStatus = payment.status.toUpperCase();

  payment.sync = payment.sync || {};
  payment.sync.appointment = payment.sync.appointment || { status: "pending", retryCount: 0 };
  payment.sync.notification = payment.sync.notification || { status: "pending", retryCount: 0 };

  const shouldSkipAppointmentSync =
    payment.sync.appointment.status === "success" &&
    payment.sync.appointment.lastSyncedPaymentStatus === appointmentStatus;

  const shouldSkipNotificationSync =
    payment.sync.notification.status === "success" &&
    payment.sync.notification.lastSyncedPaymentStatus === notificationStatus;

  if (!shouldSkipAppointmentSync) {
    try {
      await updateAppointmentPaymentStatus({
        appointmentId: payment.appointmentId,
        paymentStatus: appointmentStatus,
        paymentId: payment._id.toString(),
      });

      payment.sync.appointment = {
        ...createSyncState("success", null, payment.sync.appointment.retryCount || 0),
        lastSyncedPaymentStatus: appointmentStatus,
      };
    } catch (error) {
      payment.sync.appointment = {
        ...createSyncState(
          "failed",
          error.message,
          payment.sync.appointment.retryCount || 0
        ),
        lastSyncedPaymentStatus: appointmentStatus,
      };
      logger.error("Appointment sync failed", {
        appointmentId: payment.appointmentId,
        paymentId: payment._id.toString(),
        error: error.message,
      });
    }
  }

  if (!shouldSkipNotificationSync) {
    try {
      await sendPaymentNotification({
        patientId: payment.patientId,
        doctorId: payment.doctorId,
        appointmentId: payment.appointmentId,
        paymentStatus: notificationStatus,
        amount: payment.amount,
        currency: payment.currency,
      });

      payment.sync.notification = {
        ...createSyncState("success", null, payment.sync.notification.retryCount || 0),
        lastSyncedPaymentStatus: notificationStatus,
      };
    } catch (error) {
      payment.sync.notification = {
        ...createSyncState(
          "failed",
          error.message,
          payment.sync.notification.retryCount || 0
        ),
        lastSyncedPaymentStatus: notificationStatus,
      };
      logger.error("Notification sync failed", {
        appointmentId: payment.appointmentId,
        paymentId: payment._id.toString(),
        error: error.message,
      });
    }
  }

  await payment.save();
};

const assertAppointmentAccess = async (appointmentId, reqUser) => {
  if (reqUser.role === "admin" || reqUser.role === "service") {
    return;
  }

  const billing = await getAppointmentBilling(appointmentId);
  const isAllowed = billing.patientId === reqUser.id || billing.doctorId === reqUser.id;

  if (!isAllowed) {
    const err = new Error("Not authorized to view payments for this appointment");
    err.statusCode = 403;
    throw err;
  }
};

const getActivePaymentForAppointment = async (appointmentId) => {
  const pendingPayment = await Payment.findOne({ appointmentId, status: "pending" }).sort({
    createdAt: -1,
  });
  if (pendingPayment) return pendingPayment;

  const latestPayment = await Payment.findOne({ appointmentId }).sort({ createdAt: -1 });
  return latestPayment;
};

const createPaymentIntent = async (req, res) => {
  const { appointmentId, currency: requestedCurrency, description } = req.body;

  const billing = await getAppointmentBilling(appointmentId);

  if (req.user.role !== "service" && billing.patientId !== req.user.id) {
    const err = new Error("Not authorized to pay for this appointment");
    err.statusCode = 403;
    throw err;
  }

  const existingSucceeded = await Payment.findOne({ appointmentId, status: "succeeded" });
  if (existingSucceeded) {
    return res.status(409).json({
      success: false,
      message: "Appointment is already paid",
      paymentId: existingSucceeded._id,
      paymentIntentId: existingSucceeded.stripePaymentIntentId,
    });
  }

  const existingPending = await Payment.findOne({ appointmentId, status: "pending" }).sort({
    createdAt: -1,
  });

  if (existingPending?.stripePaymentIntentId) {
    const existingIntent = await stripe.paymentIntents.retrieve(existingPending.stripePaymentIntentId);

    return res.status(200).json({
      success: true,
      reused: true,
      clientSecret: existingIntent.client_secret,
      paymentIntentId: existingIntent.id,
      paymentId: existingPending._id,
    });
  }

  const amount = billing.amount;
  const patientId = billing.patientId;
  const doctorId = billing.doctorId;
  const currency = resolveCurrency(requestedCurrency, billing.currency);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency,
    automatic_payment_methods: {
      enabled: true,
      allow_redirects: "never",
    },
    metadata: { appointmentId, patientId, doctorId },
    description,
  });

  const payment = await Payment.create({
    appointmentId,
    patientId,
    doctorId,
    amount,
    currency,
    description,
    status: "pending",
    stripePaymentIntentId: paymentIntent.id,
  });

  res.status(201).json({
    success: true,
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    paymentId: payment._id,
  });
};

const confirmPayment = async (req, res) => {
  const { paymentIntentId, appointmentId, paymentMethodId } = req.body;

  let payment;

  if (paymentIntentId) {
    payment = await Payment.findOne({ stripePaymentIntentId: paymentIntentId });
  } else {
    payment = await getActivePaymentForAppointment(appointmentId);
  }

  if (!payment || !payment.stripePaymentIntentId) {
    const err = new Error("Payment record not found");
    err.statusCode = 404;
    throw err;
  }

  if (!canAccessPayment(payment, req.user)) {
    const err = new Error("Not authorized to confirm this payment");
    err.statusCode = 403;
    throw err;
  }

  let paymentIntent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);

  if (
    paymentIntent.status === "requires_payment_method" ||
    paymentIntent.status === "requires_confirmation"
  ) {
    paymentIntent = await stripe.paymentIntents.confirm(payment.stripePaymentIntentId, {
      payment_method: paymentMethodId || "pm_card_visa",
    });
  }

  payment.status = mapStripeStatusToLocalStatus(paymentIntent.status);

  if (payment.status === "succeeded") {
    payment.stripeChargeId =
      typeof paymentIntent.latest_charge === "string"
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id;
  }

  await payment.save();

  if (["succeeded", "failed", "refunded"].includes(payment.status)) {
    await syncPaymentLifecycle(payment);
  }

  res.json({
    success: true,
    stripeStatus: paymentIntent.status,
    stripeLastError: paymentIntent.last_payment_error?.message || null,
    payment,
  });
};

const getPaymentById = async (req, res) => {
  const payment = await Payment.findById(req.params.id);

  if (!payment) {
    const err = new Error("Payment not found");
    err.statusCode = 404;
    throw err;
  }

  if (!canAccessPayment(payment, req.user)) {
    const err = new Error("Not authorized to view this payment");
    err.statusCode = 403;
    throw err;
  }

  res.json({ success: true, payment });
};

const getPaymentsByAppointment = async (req, res) => {
  await assertAppointmentAccess(req.params.appointmentId, req.user);

  const payments = await Payment.find({ appointmentId: req.params.appointmentId }).sort({
    createdAt: -1,
  });

  res.json({ success: true, payments });
};

const getMyPayments = async (req, res) => {
  const payments = await Payment.find({ patientId: req.user.id }).sort({ createdAt: -1 });
  res.json({ success: true, payments });
};

const getAllPayments = async (req, res) => {
  const payments = await Payment.find().sort({ createdAt: -1 });
  res.json({ success: true, count: payments.length, payments });
};

const refundPayment = async (req, res) => {
  const payment = await Payment.findById(req.params.id);

  if (!payment) {
    const err = new Error("Payment not found");
    err.statusCode = 404;
    throw err;
  }

  if (payment.status !== "succeeded") {
    const err = new Error("Only succeeded payments can be refunded");
    err.statusCode = 400;
    throw err;
  }

  if (!payment.stripeChargeId) {
    const err = new Error("Payment charge ID is missing for refund");
    err.statusCode = 409;
    throw err;
  }

  const refund = await stripe.refunds.create({
    charge: payment.stripeChargeId,
  });

  payment.status = "refunded";
  payment.refundId = refund.id;
  await payment.save();

  await syncPaymentLifecycle(payment);

  res.json({ success: true, payment });
};

const updatePaymentFromIntent = async ({ payment, intentStatus, latestCharge }) => {
  const mappedStatus = mapStripeStatusToLocalStatus(intentStatus);
  payment.status = mappedStatus;

  if (mappedStatus === "succeeded" && latestCharge) {
    payment.stripeChargeId = typeof latestCharge === "string" ? latestCharge : latestCharge.id;
  }

  await payment.save();
};

const handleStripeWebhook = async (req, res) => {
  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    const err = new Error("STRIPE_WEBHOOK_SECRET is not configured");
    err.statusCode = 500;
    throw err;
  }

  if (!signature) {
    const err = new Error("Missing Stripe signature");
    err.statusCode = 400;
    throw err;
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    const err = new Error(`Invalid webhook signature: ${error.message}`);
    err.statusCode = 400;
    throw err;
  }

  if (
    ![
      "payment_intent.succeeded",
      "payment_intent.payment_failed",
      "payment_intent.canceled",
      "charge.refunded",
    ].includes(event.type)
  ) {
    return res.status(200).json({ success: true, ignored: true });
  }

  let payment;

  if (event.type === "charge.refunded") {
    const charge = event.data.object;
    payment = await Payment.findOne({ stripeChargeId: charge.id });
  } else {
    const paymentIntent = event.data.object;
    payment = await Payment.findOne({ stripePaymentIntentId: paymentIntent.id });
  }

  if (!payment) {
    return res.status(200).json({ success: true, ignored: true, reason: "payment_not_found" });
  }

  if (payment.processedWebhookEventIds.includes(event.id)) {
    return res.status(200).json({ success: true, duplicate: true });
  }

  payment.processedWebhookEventIds.push(event.id);

  if (event.type === "charge.refunded") {
    payment.status = "refunded";
  } else {
    const paymentIntent = event.data.object;
    await updatePaymentFromIntent({
      payment,
      intentStatus: paymentIntent.status,
      latestCharge: paymentIntent.latest_charge,
    });
  }

  await payment.save();

  if (["succeeded", "failed", "refunded"].includes(payment.status)) {
    await syncPaymentLifecycle(payment);
  }

  return res.status(200).json({ success: true });
};

module.exports = {
  createPaymentIntent,
  confirmPayment,
  getPaymentById,
  getPaymentsByAppointment,
  getMyPayments,
  getAllPayments,
  refundPayment,
  handleStripeWebhook,
};
