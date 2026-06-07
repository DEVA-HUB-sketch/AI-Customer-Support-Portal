// backend/routes/chatRoutes.js
const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");
const { getChatbotReply, analyzeSentiment } = require("../services/aiService");
const { log, ACTIONS } = require("../services/activityLogger");

// POST /api/chat/bot
router.post("/bot", async (req, res) => {
  try {
    const { message, email, history } = req.body;
    
    // Get AI Chatbot Response
    const botResult = getChatbotReply(message, history);

    // Search KB first — return KB answer if matched and not escalating
    const kbSnap = await db.collection("kb").get();
    const kbArticles = [];
    kbSnap.forEach(doc => kbArticles.push(doc.data()));
    const clean = message.toLowerCase();
    const kbMatch = kbArticles.find(a => {
      const q = a.question.toLowerCase();
      return (
        clean.includes(q.substring(0, 20)) ||
        q.split(" ").some(w => w.length > 4 && clean.includes(w))
      );
    });
    if (kbMatch && !botResult.escalate) {
      log({ userId: email || "anonymous", email: email || "", role: "customer",
            action: ACTIONS.KB_SEARCHED,
            details: { query: (message || "").substring(0, 100), matched: kbMatch.question },
            ip: req.clientIp });
      return res.json({ reply: kbMatch.answer, source: "kb", escalate: false });
    }

    let ticketId = null;
    
    // If bot decides to escalate, auto-create a support ticket
    if (botResult.escalate && email) {
      const sentiment = analyzeSentiment(message);
      const priority = sentiment === "Negative" ? "High" : "Medium";
      
      const newTicket = {
        subject: `Auto Escalation: ${message.substring(0, 40)}${message.length > 40 ? "..." : ""}`,
        description: `Customer requested agent support. Context message: "${message}"`,
        category: botResult.category || "General Inquiry",
        priority: priority,
        status: "Open",
        sentiment: sentiment,
        createdAt: new Date().toISOString(),
        createdBy: email.toLowerCase(),
        assignedTo: null,
        history: [{
          status: "Open",
          updatedBy: "Zia AI Chatbot",
          timestamp: new Date().toISOString(),
          note: "Ticket created automatically via live chatbot escalation."
        }],
        messages: [{
          sender: "customer",
          text: message,
          timestamp: new Date().toISOString()
        }, {
          sender: "agent",
          text: botResult.reply,
          timestamp: new Date().toISOString(),
          isBot: true
        }]
      };
      
      const docRef = await db.collection("tickets").add(newTicket);
      ticketId = docRef.id;
      
      botResult.reply += ` A support ticket has been logged under ID: #${ticketId.substring(0, 6).toUpperCase()}.`;
    }
    
    log({ userId: email || "anonymous", email: email || "", role: "customer",
          action: ACTIONS.AI_CHAT_USED,
          details: { message: (message || "").substring(0, 120), escalated: botResult.escalate, ticketId },
          ip: req.clientIp });

    res.json({
      reply: botResult.reply,
      escalate: botResult.escalate,
      category: botResult.category,
      ticketId: ticketId
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
