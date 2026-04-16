const mongoose = require("mongoose");
const { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } = require("../config/paymentConfig");

const syncStateSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },
    lastAttemptAt: Date,
    lastSuccessAt: Date,
    lastError: String,
    lastSyncedPaymentStatus: String,
    retryCount: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: String,
      required: true,
    },
    patientId: {
      type: String,
      required: true,
    },
    doctorId: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      enum: SUPPORTED_CURRENCIES,
      lowercase: true,
      default: DEFAULT_CURRENCY,
    },
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "refunded"],
      default: "pending",
    },
    stripePaymentIntentId: {
      type: String,
    },
    stripeChargeId: {
      type: String,
    },
    refundId: {
      type: String,
    },
    description: {
      type: String,
    },
    sync: {
      appointment: {
        type: syncStateSchema,
        default: () => ({ status: "pending" }),
      },
      notification: {
        type: syncStateSchema,
        default: () => ({ status: "pending" }),
      },
    },
    processedWebhookEventIds: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

paymentSchema.index({ stripePaymentIntentId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ stripeChargeId: 1 }, { sparse: true });
paymentSchema.index({ appointmentId: 1, createdAt: -1 });
paymentSchema.index({ patientId: 1, createdAt: -1 });
paymentSchema.index({ doctorId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index(
  { appointmentId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

module.exports = mongoose.model("Payment", paymentSchema);