const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Payment = require("../models/Payment");

const createPaymentIntent = async (req, res) => {
  const { appointmentId, doctorId, amount, currency = "lkr", description } = req.body;
  const patientId = req.user.id;

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
  const { paymentIntentId, paymentMethodId } = req.body;

  let paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

  const payment = await Payment.findOne({ stripePaymentIntentId: paymentIntentId });

  if (!payment) {
    const err = new Error("Payment record not found");
    err.statusCode = 404;
    throw err;
  }

  // For API-only testing (e.g., Postman), try confirming server-side when action is still required.
  if (
    paymentIntent.status === "requires_payment_method" ||
    paymentIntent.status === "requires_confirmation"
  ) {
    paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethodId || "pm_card_visa",
    });
  }

  if (paymentIntent.status === "succeeded") {
    payment.status = "succeeded";
    payment.stripeChargeId = paymentIntent.latest_charge;
    await payment.save();
  } else if (paymentIntent.status === "canceled") {
    payment.status = "failed";
    await payment.save();
  } else {
    // Keep non-terminal states as pending until Stripe finalizes the payment.
    payment.status = "pending";
    await payment.save();
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

  const isOwner = payment.patientId === req.user.id;
  const isAdmin = req.user.role === "admin";
  const isDoctor = payment.doctorId === req.user.id;

  if (!isOwner && !isAdmin && !isDoctor) {
    const err = new Error("Not authorized to view this payment");
    err.statusCode = 403;
    throw err;
  }

  res.json({ success: true, payment });
};

const getPaymentsByAppointment = async (req, res) => {
  const payments = await Payment.find({ appointmentId: req.params.appointmentId });
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

  const refund = await stripe.refunds.create({
    charge: payment.stripeChargeId,
  });

  payment.status = "refunded";
  payment.refundId = refund.id;
  await payment.save();

  res.json({ success: true, payment });
};

module.exports = {
  createPaymentIntent,
  confirmPayment,
  getPaymentById,
  getPaymentsByAppointment,
  getMyPayments,
  getAllPayments,
  refundPayment,
};