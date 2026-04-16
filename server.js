require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const paymentRoutes = require("./routes/paymentRoutes");

const app = express();

connectDB();

app.use(cors());
app.use(express.json());

app.use("/api/payments", paymentRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => console.log(`Payment Service running on port ${PORT}`));