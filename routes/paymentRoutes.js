const express = require("express");
const router = express.Router();
const {
  createPaymentIntent,
  confirmPayment,
  getPaymentById,
  getPaymentsByAppointment,
  getMyPayments,
  getAllPayments,
  refundPayment,
} = require("../controllers/paymentController");
const { protect, authorizeRoles } = require("../middleware/auth");
const {
  validateCreateIntent,
  validateConfirmPayment,
  validateMongoIdParam,
  validateAppointmentIdParam,
} = require("../middleware/validation");

// Patient-facing payment creation and confirmation endpoints.
router.post("/intent", protect, authorizeRoles("patient"), validateCreateIntent, createPaymentIntent);
router.post("/confirm", protect, authorizeRoles("patient"), validateConfirmPayment, confirmPayment);

// Scoped payment queries and admin reporting paths.
router.get("/my", protect, authorizeRoles("patient"), getMyPayments);
router.get("/all", protect, authorizeRoles("admin"), getAllPayments);
router.get(
  "/appointment/:appointmentId",
  protect,
  validateAppointmentIdParam,
  getPaymentsByAppointment
);
router.get("/:id", protect, validateMongoIdParam("id"), getPaymentById);
router.post("/:id/refund", protect, authorizeRoles("admin"), validateMongoIdParam("id"), refundPayment);

module.exports = router;