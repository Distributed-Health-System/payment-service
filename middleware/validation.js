const mongoose = require("mongoose");
const { SUPPORTED_CURRENCIES } = require("../config/paymentConfig");

const sendValidationError = (res, errors) => {
  // Keep validation responses machine-readable and consistent across endpoints.
  return res.status(400).json({
    success: false,
    message: "Validation error",
    errors,
  });
};

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

// Intent creation only accepts the appointment identifier plus optional display fields.
const validateCreateIntent = (req, res, next) => {
  const errors = [];
  const { appointmentId, currency, description } = req.body || {};

  if (!isNonEmptyString(appointmentId)) {
    errors.push("appointmentId is required and must be a non-empty string");
  }

  if (currency !== undefined) {
    if (!isNonEmptyString(currency)) {
      errors.push("currency must be a non-empty string when provided");
    } else if (!SUPPORTED_CURRENCIES.includes(currency.toLowerCase())) {
      errors.push(`currency must be one of: ${SUPPORTED_CURRENCIES.join(", ")}`);
    }
  }

  if (description !== undefined) {
    if (typeof description !== "string") {
      errors.push("description must be a string when provided");
    } else if (description.length > 500) {
      errors.push("description must be 500 characters or fewer");
    }
  }

  if (errors.length > 0) {
    return sendValidationError(res, errors);
  }

  next();
};

// Confirm supports either identifier to stay backward compatible with older clients.
const validateConfirmPayment = (req, res, next) => {
  const errors = [];
  const { appointmentId, paymentIntentId, paymentMethodId } = req.body || {};

  if (!isNonEmptyString(appointmentId) && !isNonEmptyString(paymentIntentId)) {
    errors.push("Either appointmentId or paymentIntentId is required");
  }

  if (appointmentId !== undefined && !isNonEmptyString(appointmentId)) {
    errors.push("appointmentId must be a non-empty string when provided");
  }

  if (paymentIntentId !== undefined && !isNonEmptyString(paymentIntentId)) {
    errors.push("paymentIntentId must be a non-empty string when provided");
  }

  if (paymentMethodId !== undefined && !isNonEmptyString(paymentMethodId)) {
    errors.push("paymentMethodId must be a non-empty string when provided");
  }

  if (errors.length > 0) {
    return sendValidationError(res, errors);
  }

  next();
};

// Mongo-backed routes use a defensive ObjectId guard before querying the database.
const validateMongoIdParam = (paramName) => {
  return (req, res, next) => {
    const value = req.params?.[paramName];

    if (!mongoose.Types.ObjectId.isValid(value)) {
      return sendValidationError(res, [`${paramName} must be a valid Mongo ObjectId`]);
    }

    next();
  };
};

// Appointment identifiers are validated as non-empty strings because they are upstream-managed ids.
const validateAppointmentIdParam = (req, res, next) => {
  const appointmentId = req.params?.appointmentId;

  if (!isNonEmptyString(appointmentId)) {
    return sendValidationError(res, ["appointmentId path parameter is required"]);
  }

  next();
};

module.exports = {
  validateCreateIntent,
  validateConfirmPayment,
  validateMongoIdParam,
  validateAppointmentIdParam,
};
