const express = require("express");
const router = express.Router();
const Ticket = require("../models/Ticket");

router.post("/create", async (req, res) => {

  try {

    const ticket = await Ticket.create(req.body);

    res.status(201).json({
      message: "Ticket Created",
      ticket
    });

  } catch (error) {
    res.status(500).json(error);
  }

});

module.exports = router;