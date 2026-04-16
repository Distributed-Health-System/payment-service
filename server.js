require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const paymentRoutes = require("./routes/paymentRoutes");
const { handleStripeWebhook } = require("./controllers/paymentController");
const logger = require("./utils/logger");

const app = express();

// Connect once at startup so request handling fails fast if persistence is unavailable.
connectDB();

app.use(cors());

// Stripe webhook needs the raw request body for signature verification.
app.post("/payments/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

app.use(express.json());

// Keep both the gateway-aligned and legacy API prefixes available.
app.use("/payments", paymentRoutes);
app.use("/api/payments", paymentRoutes);

// Return safe messages to clients while logging full context for operators.
app.use((err, req, res, next) => {
  const statusCode = Number.isInteger(err.statusCode) ? err.statusCode : 500;
  const safeMessage = statusCode >= 500 ? "Internal Server Error" : err.message;

  logger.error("Request failed", {
    path: req.originalUrl,
    method: req.method,
    statusCode,
    message: err.message,
  });

  res.status(statusCode).json({
    success: false,
    message: safeMessage,
  });
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => console.log(`Payment Service running on port ${PORT}`));