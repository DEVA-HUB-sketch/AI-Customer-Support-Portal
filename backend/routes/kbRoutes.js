// backend/routes/kbRoutes.js
const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");

// Get all KB articles / FAQs
router.get("/", async (req, res) => {
  try {
    const search = (req.query.search || "").toLowerCase();
    const category = req.query.category || "";
    
    const kbRef = db.collection("kb");
    let snapshot;
    
    if (category) {
      snapshot = await kbRef.where("category", "==", category).get();
    } else {
      snapshot = await kbRef.get();
    }
    
    const articles = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (!search || data.question.toLowerCase().includes(search) || data.answer.toLowerCase().includes(search)) {
        articles.push({ id: doc.id, ...data });
      }
    });
    
    res.json(articles);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get unique categories
router.get("/categories", async (req, res) => {
  try {
    const snapshot = await db.collection("kb").get();
    const categories = new Set();
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.category) {
        categories.add(data.category);
      }
    });
    res.json(Array.from(categories));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
