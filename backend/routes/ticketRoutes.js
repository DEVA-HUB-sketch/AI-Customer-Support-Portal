// backend/routes/ticketRoutes.js
const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");
const { categorizeTicket, analyzeSentiment, getSuggestedResponses } = require("../services/aiService");

// 1. GET /api/tickets - Fetch tickets based on role and email
router.get("/", async (req, res) => {
  try {
    const { email, role } = req.query;
    const ticketsRef = db.collection("tickets");
    let snapshot;
    
    if (role === "customer" && email) {
      snapshot = await ticketsRef.where("createdBy", "==", email.toLowerCase()).get();
    } else if (role === "agent" && email) {
      // Agents see tickets assigned to them or unassigned
      snapshot = await ticketsRef.get();
    } else {
      // Admins or unfiltered calls see everything
      snapshot = await ticketsRef.get();
    }
    
    const tickets = [];
    snapshot.forEach(doc => {
      tickets.push({ id: doc.id, ...doc.data() });
    });
    
    // Sort tickets by creation date descending
    tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 2. GET /api/tickets/:id - Fetch single ticket
router.get("/:id", async (req, res) => {
  try {
    const doc = await db.collection("tickets").doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Ticket not found" });
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 3. POST /api/tickets/create - Create ticket with AI Categorization and Sentiment Analysis
router.post("/create", async (req, res) => {
  try {
    const { subject, description, priority, email } = req.body;
    if (!subject || !description || !email) {
      return res.status(400).json({ message: "Subject, description, and email are required" });
    }

    // AI Automation features (AI Categorization and Sentiment Analysis)
    const category = categorizeTicket(subject, description);
    const sentiment = analyzeSentiment(description);
    const emailLower = email.toLowerCase();

    const newTicket = {
      subject,
      description,
      priority: priority || "Low",
      category,
      sentiment,
      status: "Open",
      createdAt: new Date().toISOString(),
      createdBy: emailLower,
      assignedTo: null,
      rating: null,       // CSAT rating (Feedback System)
      feedback: null,     // Customer feedback comment (Feedback System)
      history: [{
        status: "Open",
        updatedBy: emailLower,
        timestamp: new Date().toISOString(),
        note: "Ticket created and automatically categorized by Zia AI."
      }],
      messages: [{
        sender: "customer",
        text: description,
        timestamp: new Date().toISOString(),
        senderName: emailLower
      }]
    };

    const docRef = await db.collection("tickets").add(newTicket);
    res.status(201).json({
      message: "Ticket Created Successfully",
      ticketId: docRef.id,
      ticket: { id: docRef.id, ...newTicket }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 4. PUT /api/tickets/:id/status - Update Ticket Status & Timeline Log
router.put("/:id/status", async (req, res) => {
  try {
    const { status, updatedBy, note } = req.body;
    if (!status || !updatedBy) {
      return res.status(400).json({ message: "Status and updatedBy are required" });
    }

    const ticketRef = db.collection("tickets").doc(req.params.id);
    const doc = await ticketRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const ticketData = doc.data();
    const historyEntry = {
      status,
      updatedBy,
      timestamp: new Date().toISOString(),
      note: note || `Status changed from ${ticketData.status} to ${status}.`
    };

    await ticketRef.update({
      status,
      history: [...(ticketData.history || []), historyEntry]
    });

    res.json({ message: "Ticket Status Updated Successfully", status });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 5. PUT /api/tickets/:id/assign - Assign Ticket to Agent
router.put("/:id/assign", async (req, res) => {
  try {
    const { assignedTo, updatedBy } = req.body; // email of the agent
    if (!updatedBy) {
      return res.status(400).json({ message: "updatedBy parameter is required" });
    }

    const ticketRef = db.collection("tickets").doc(req.params.id);
    const doc = await ticketRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const ticketData = doc.data();
    const historyEntry = {
      status: ticketData.status,
      updatedBy,
      timestamp: new Date().toISOString(),
      note: assignedTo 
        ? `Ticket assigned to agent: ${assignedTo}`
        : `Ticket unassigned.`
    };

    await ticketRef.update({
      assignedTo: assignedTo || null,
      history: [...(ticketData.history || []), historyEntry]
    });

    res.json({ message: "Ticket Assignment Updated Successfully", assignedTo });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 6. POST /api/tickets/:id/messages - Send message inside a ticket (Customer-Agent messaging)
router.post("/:id/messages", async (req, res) => {
  try {
    const { sender, text, senderName } = req.body;
    if (!sender || !text || !senderName) {
      return res.status(400).json({ message: "Sender, text, and senderName are required" });
    }

    const ticketRef = db.collection("tickets").doc(req.params.id);
    const doc = await ticketRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const ticketData = doc.data();
    const newMessage = {
      sender, // "customer" or "agent"
      text,
      timestamp: new Date().toISOString(),
      senderName
    };

    await ticketRef.update({
      messages: [...(ticketData.messages || []), newMessage]
    });

    res.json({ message: "Message Sent Successfully", chat: newMessage });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 7. POST /api/tickets/:id/feedback - Customer submits feedback/CSAT rating (Feedback System)
router.post("/:id/feedback", async (req, res) => {
  try {
    const { rating, feedback } = req.body;
    if (rating === undefined) {
      return res.status(400).json({ message: "Rating is required" });
    }

    const ticketRef = db.collection("tickets").doc(req.params.id);
    const doc = await ticketRef.get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const ticketData = doc.data();
    const historyEntry = {
      status: ticketData.status,
      updatedBy: ticketData.createdBy,
      timestamp: new Date().toISOString(),
      note: `Customer submitted feedback: Rating ${rating}/5.`
    };

    await ticketRef.update({
      rating: parseInt(rating),
      feedback: feedback || "",
      history: [...(ticketData.history || []), historyEntry]
    });

    res.json({ message: "Feedback Submitted Successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 8. GET /api/tickets/:id/ai-suggestions - Fetch AI response suggestions for agents
router.get("/:id/ai-suggestions", async (req, res) => {
  try {
    const doc = await db.collection("tickets").doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const data = doc.data();
    const suggestions = getSuggestedResponses(data.category, data.sentiment);
    
    // Add customer insight (Security & AI Insights)
    const insight = data.sentiment === "Negative" 
      ? "Customer is frustrated. Prioritize prompt, empathetic assistance. This ticket breaches regular response SLAs."
      : "Standard customer request. Response suggestion is context-mapped to Help Articles.";

    res.json({
      category: data.category,
      sentiment: data.sentiment,
      suggestions,
      insight
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;