// backend/routes/chatRoutes.js
const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");
const { getChatbotReply, analyzeSentiment } = require("../services/aiService");

// POST /api/chat/bot
router.post("/bot", async (req, res) => {
  try {
    const { message, email, history } = req.body;
    
    // Get AI Chatbot Response
    const botResult = getChatbotReply(message, history);
    
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
