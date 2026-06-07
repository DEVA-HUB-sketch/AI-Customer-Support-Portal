// backend/routes/ticketRoutes.js
const express = require("express");
const router  = express.Router();
const { db }  = require("../config/firebase");
const { categorizeTicket, analyzeSentiment, getSuggestedResponses } = require("../services/aiService");
const { log, ACTIONS } = require("../services/activityLogger");
const {
  sendTicketCreated,
  sendTicketAssigned,
  sendTicketResolved
} = require("../services/emailService");

// 1. GET /api/tickets
router.get("/", async (req, res) => {
  try {
    const { email, role } = req.query;
    const ticketsRef = db.collection("tickets");
    let snapshot;

    if (role === "customer" && email) {
      snapshot = await ticketsRef.where("createdBy", "==", email.toLowerCase()).get();
    } else {
      snapshot = await ticketsRef.get();
    }

    const tickets = [];
    snapshot.forEach(doc => tickets.push({ id: doc.id, ...doc.data() }));
    tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 2. GET /api/tickets/:id
router.get("/:id", async (req, res) => {
  try {
    const doc = await db.collection("tickets").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: "Ticket not found" });
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 3. POST /api/tickets/create
router.post("/create", async (req, res) => {
  try {
    const { subject, description, priority, email, category: frontendCategory } = req.body;
    if (!subject || !description || !email) {
      return res.status(400).json({ message: "Subject, description, and email are required" });
    }

    const category  = categorizeTicket(subject, description);
    const sentiment = analyzeSentiment(description);
    const emailLower = email.toLowerCase();

    const newTicket = {
      subject, description,
      priority:   priority || "Low",
      category,
      sentiment,
      status:     "Open",
      createdAt:  new Date().toISOString(),
      updatedAt:  new Date().toISOString(),
      createdBy:  emailLower,
      assignedTo: null,
      rating:     null,
      feedback:   null,
      history: [{
        status:    "Open",
        updatedBy: emailLower,
        timestamp: new Date().toISOString(),
        note:      "Ticket created and automatically categorized by Zia AI."
      }],
      messages: [{
        sender:    "customer",
        text:      description,
        timestamp: new Date().toISOString(),
        senderName: emailLower
      }]
    };

    const docRef = await db.collection("tickets").add(newTicket);

    // Fire-and-forget email + activity log
    sendTicketCreated({
      ticketId:      docRef.id,
      customerEmail: emailLower,
      subject,
      category,
      priority:      newTicket.priority,
      status:        "Open"
    }).catch(() => {});

    log({ userId: emailLower, email: emailLower, role: "customer",
          action: ACTIONS.TICKET_CREATED,
          details: { ticketId: docRef.id, subject, category, priority: newTicket.priority },
          ip: req.clientIp });

    res.status(201).json({
      message:  "Ticket Created Successfully",
      ticketId: docRef.id,
      ticket:   { id: docRef.id, ...newTicket }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 4. PUT /api/tickets/:id/status
router.put("/:id/status", async (req, res) => {
  try {
    const { status, updatedBy, note } = req.body;
    if (!status || !updatedBy) {
      return res.status(400).json({ message: "Status and updatedBy are required" });
    }

    const ticketRef = db.collection("tickets").doc(req.params.id);
    const doc = await ticketRef.get();
    if (!doc.exists) return res.status(404).json({ message: "Ticket not found" });

    const ticketData = doc.data();
    const historyEntry = {
      status, updatedBy,
      timestamp: new Date().toISOString(),
      note: note || `Status changed from ${ticketData.status} to ${status}.`
    };

    await ticketRef.update({
      status, updatedAt: new Date().toISOString(),
      history: [...(ticketData.history || []), historyEntry]
    });

    // Determine action type and send resolution email if resolved
    let action = ACTIONS.TICKET_UPDATED;
    if (status === "Resolved") {
      action = ACTIONS.TICKET_RESOLVED;
      if (ticketData.createdBy) {
        sendTicketResolved({
          ticketId:      req.params.id,
          customerEmail: ticketData.createdBy,
          agentName:     updatedBy,
          subject:       ticketData.subject
        }).catch(() => {});
      }
    } else if (status === "Closed") {
      action = ACTIONS.TICKET_CLOSED;
    }

    log({ userId: updatedBy, email: updatedBy, role: "agent",
          action,
          details: { ticketId: req.params.id, oldStatus: ticketData.status, newStatus: status },
          ip: req.clientIp });

    res.json({ message: "Ticket Status Updated Successfully", status });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 5. PUT /api/tickets/:id/assign
router.put("/:id/assign", async (req, res) => {
  try {
    const { assignedTo, updatedBy } = req.body;
    if (!updatedBy) return res.status(400).json({ message: "updatedBy parameter is required" });

    const ticketRef = db.collection("tickets").doc(req.params.id);
    const doc = await ticketRef.get();
    if (!doc.exists) return res.status(404).json({ message: "Ticket not found" });

    const ticketData = doc.data();
    const historyEntry = {
      status:    ticketData.status,
      updatedBy,
      timestamp: new Date().toISOString(),
      note:      assignedTo ? `Ticket assigned to agent: ${assignedTo}` : "Ticket unassigned."
    };

    await ticketRef.update({
      assignedTo: assignedTo || null,
      updatedAt:  new Date().toISOString(),
      history:    [...(ticketData.history || []), historyEntry]
    });

    // Send assignment email to agent
    if (assignedTo) {
      sendTicketAssigned({
        ticketId:      req.params.id,
        agentEmail:    assignedTo,
        customerEmail: ticketData.createdBy,
        customerName:  ticketData.createdBy,
        subject:       ticketData.subject,
        category:      ticketData.category,
        priority:      ticketData.priority
      }).catch(() => {});
    }

    log({ userId: updatedBy, email: updatedBy, role: "agent",
          action: ACTIONS.TICKET_ASSIGNED,
          details: { ticketId: req.params.id, assignedTo: assignedTo || null },
          ip: req.clientIp });

    res.json({ message: "Ticket Assignment Updated Successfully", assignedTo });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 6. POST /api/tickets/:id/messages
router.post("/:id/messages", async (req, res) => {
  try {
    const { sender, text, senderName } = req.body;
    if (!sender || !text || !senderName) {
      return res.status(400).json({ message: "Sender, text, and senderName are required" });
    }

    const ticketRef = db.collection("tickets").doc(req.params.id);
    const doc = await ticketRef.get();
    if (!doc.exists) return res.status(404).json({ message: "Ticket not found" });

    const ticketData = doc.data();
    const newMessage = { sender, text, timestamp: new Date().toISOString(), senderName };

    await ticketRef.update({
      messages:  [...(ticketData.messages || []), newMessage],
      updatedAt: new Date().toISOString()
    });

    log({ userId: senderName, email: senderName, role: sender === "agent" ? "agent" : "customer",
          action: ACTIONS.TICKET_MESSAGE,
          details: { ticketId: req.params.id, sender },
          ip: req.clientIp });

    res.json({ message: "Message Sent Successfully", chat: newMessage });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 7. POST /api/tickets/:id/feedback
router.post("/:id/feedback", async (req, res) => {
  try {
    const { rating, feedback } = req.body;
    if (rating === undefined) return res.status(400).json({ message: "Rating is required" });

    const ticketRef = db.collection("tickets").doc(req.params.id);
    const doc = await ticketRef.get();
    if (!doc.exists) return res.status(404).json({ message: "Ticket not found" });

    const ticketData = doc.data();
    const historyEntry = {
      status:    ticketData.status,
      updatedBy: ticketData.createdBy,
      timestamp: new Date().toISOString(),
      note:      `Customer submitted feedback: Rating ${rating}/5.`
    };

    await ticketRef.update({
      rating:    parseInt(rating),
      feedback:  feedback || "",
      updatedAt: new Date().toISOString(),
      history:   [...(ticketData.history || []), historyEntry]
    });

    log({ userId: ticketData.createdBy, email: ticketData.createdBy, role: "customer",
          action: ACTIONS.TICKET_FEEDBACK,
          details: { ticketId: req.params.id, rating: parseInt(rating) },
          ip: req.clientIp });

    res.json({ message: "Feedback Submitted Successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 8. GET /api/tickets/:id/ai-suggestions
router.get("/:id/ai-suggestions", async (req, res) => {
  try {
    const doc = await db.collection("tickets").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: "Ticket not found" });

    const data = doc.data();
    const suggestions = getSuggestedResponses(data.category, data.sentiment);
    const insight = data.sentiment === "Negative"
      ? "Customer is frustrated. Prioritize prompt, empathetic assistance. This ticket breaches regular response SLAs."
      : "Standard customer request. Response suggestion is context-mapped to Help Articles.";

    res.json({ category: data.category, sentiment: data.sentiment, suggestions, insight });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 9. DELETE /api/tickets/:id
router.delete("/:id", async (req, res) => {
  try {
    const { deletedBy } = req.query;
    const ticketRef = db.collection("tickets").doc(req.params.id);
    const doc = await ticketRef.get();
    if (!doc.exists) return res.status(404).json({ message: "Ticket not found" });

    const ticketData = doc.data();
    await ticketRef.delete();

    log({ userId: deletedBy || "admin", email: deletedBy || "admin", role: "admin",
          action: ACTIONS.TICKET_DELETED,
          details: { ticketId: req.params.id, subject: ticketData.subject },
          ip: req.clientIp });

    res.json({ message: "Ticket Deleted Successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
