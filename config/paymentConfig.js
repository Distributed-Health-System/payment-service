// Central place for billing defaults and service-to-service reliability settings.
const SUPPORTED_CURRENCIES = ["lkr", "usd"];
const DEFAULT_CURRENCY = "lkr";

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

module.exports = {
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY,
  APPOINTMENT_SERVICE_URL: process.env.APPOINTMENT_SERVICE_URL || "http://localhost:3001",
  NOTIFICATION_SERVICE_URL: process.env.NOTIFICATION_SERVICE_URL || "http://localhost:3003",
  SERVICE_NAME: process.env.SERVICE_NAME || "payment-service",
  DOWNSTREAM_TIMEOUT_MS: toInt(process.env.DOWNSTREAM_TIMEOUT_MS, 5000),
  DOWNSTREAM_MAX_RETRIES: toInt(process.env.DOWNSTREAM_MAX_RETRIES, 2),
};
