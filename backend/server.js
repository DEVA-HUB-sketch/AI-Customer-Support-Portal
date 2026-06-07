const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

// Initialize Firebase Config / Local Fallback Database
const { db, isMock } = require("./config/firebase");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(require("path").join(__dirname, "../frontend")));

// Routes Mount
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/tickets", require("./routes/ticketRoutes"));
app.use("/api/chat", require("./routes/chatRoutes"));
app.use("/api/kb", require("./routes/kbRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));

app.get("/", (req, res) => {
  res.json({
    message: "DeskFlow AI Backend Running",
    database: isMock ? "Local Mock JSON DB" : "Firebase Firestore",
    status: "Healthy"
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`DeskFlow Server running on port ${PORT}`);
  console.log(`Mode: ${isMock ? "LOCAL MOCK (No credentials)" : "FIREBASE ENGINE (Live Cert)"}`);
});