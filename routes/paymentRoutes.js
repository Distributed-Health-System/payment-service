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

router.post("/intent", protect, authorizeRoles("patient"), createPaymentIntent);
router.post("/confirm", protect, authorizeRoles("patient"), confirmPayment);
router.get("/my", protect, authorizeRoles("patient"), getMyPayments);
router.get("/all", protect, authorizeRoles("admin"), getAllPayments);
router.get("/appointment/:appointmentId", protect, getPaymentsByAppointment);
router.get("/:id", protect, getPaymentById);
router.post("/:id/refund", protect, authorizeRoles("admin"), refundPayment);

module.exports = router;