// backend/routes/aiRoutes.js
const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");
const {
  geminiChat,
  geminiSentiment,
  geminiCategorize,
  geminiSuggestResponses,
  geminiFaqSearch
} = require("../services/geminiService");

// POST /api/ai/chat
// Gemini-powered chatbot with persistent history in Firestore
router.post("/chat", async (req, res) => {
  try {
    const { message, email, history = [], sessionId } = req.body;
    if (!message) return res.status(400).json({ message: "message is required" });

    const result = await geminiChat(message, history);

    // Persist conversation to Firestore
    if (email) {
      const sid = sessionId || `session_${Date.now()}`;
      const convRef = db.collection("ai_conversations").doc(sid);
      const existing = await convRef.get();
      const msgs = existing.exists ? (existing.data().messages || []) : [];
      msgs.push(
        { role: "user", text: message, timestamp: new Date().toISOString() },
        { role: "model", text: result.reply, timestamp: new Date().toISOString() }
      );
      await convRef.set({
        email: email.toLowerCase(),
        sessionId: sid,
        messages: msgs,
        updatedAt: new Date().toISOString(),
        createdAt: existing.exists ? existing.data().createdAt : new Date().toISOString()
      }, { merge: true });
      result.sessionId = sid;
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/ai/sentiment
router.post("/sentiment", async (req, res) => {
  try {
    const { text, email, ticketId } = req.body;
    if (!text) return res.status(400).json({ message: "text is required" });

    const result = await geminiSentiment(text);

    // Store in Firestore if ticketId provided
    if (ticketId) {
      await db.collection("ai_sentiment").add({
        ticketId,
        email: (email || "").toLowerCase(),
        text: text.substring(0, 500),
        ...result,
        analyzedAt: new Date().toISOString()
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/ai/categorize
router.post("/categorize", async (req, res) => {
  try {
    const { subject, description, email } = req.body;
    if (!subject && !description) return res.status(400).json({ message: "subject or description required" });

    const result = await geminiCategorize(subject || "", description || "");

    if (email) {
      await db.collection("ai_categorizations").add({
        email: email.toLowerCase(),
        subject,
        description: (description || "").substring(0, 500),
        ...result,
        categorizedAt: new Date().toISOString()
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/ai/suggest
router.post("/suggest", async (req, res) => {
  try {
    const { category, sentiment, subject, description } = req.body;
    if (!category) return res.status(400).json({ message: "category is required" });

    const result = await geminiSuggestResponses({ category, sentiment: sentiment || "Neutral", subject: subject || "", description: description || "" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/ai/faq-search
router.post("/faq-search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ message: "query is required" });

    // Fetch all KB articles from Firestore
    const snapshot = await db.collection("kb").get();
    const articles = [];
    snapshot.forEach(doc => articles.push(doc.data()));

    const result = await geminiFaqSearch(query, articles);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/ai/history?email=...
router.get("/history", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: "email is required" });

    const snapshot = await db.collection("ai_conversations")
      .where("email", "==", email.toLowerCase())
      .get();

    const sessions = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      sessions.push({
        sessionId: doc.id,
        updatedAt: data.updatedAt,
        createdAt: data.createdAt,
        messageCount: (data.messages || []).length,
        preview: (data.messages || []).find(m => m.role === "user")?.text?.substring(0, 80) || ""
      });
    });

    // Sort by updatedAt desc
    sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/ai/history/:sessionId
router.get("/history/:sessionId", async (req, res) => {
  try {
    const doc = await db.collection("ai_conversations").doc(req.params.sessionId).get();
    if (!doc.exists) return res.status(404).json({ message: "Session not found" });
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/ai/analytics?email=...
router.get("/analytics", async (req, res) => {
  try {
    const { email } = req.query;

    // Gather sentiment data
    const sentSnap = await db.collection("ai_sentiment").get();
    const catSnap = await db.collection("ai_categorizations").get();
    const convSnap = await db.collection("ai_conversations").get();

    const sentimentCounts = { Positive: 0, Neutral: 0, Negative: 0 };
    sentSnap.forEach(doc => {
      const s = doc.data().sentiment;
      if (sentimentCounts[s] !== undefined) sentimentCounts[s]++;
    });

    const categoryCounts = {};
    catSnap.forEach(doc => {
      const c = doc.data().category;
      categoryCounts[c] = (categoryCounts[c] || 0) + 1;
    });

    let totalMessages = 0;
    convSnap.forEach(doc => {
      totalMessages += (doc.data().messages || []).length;
    });

    res.json({
      totalSessions: convSnap.docs ? convSnap.docs.length : 0,
      totalMessages,
      sentimentBreakdown: sentimentCounts,
      categoryBreakdown: categoryCounts,
      totalAnalyzed: sentSnap.docs ? sentSnap.docs.length : 0
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
