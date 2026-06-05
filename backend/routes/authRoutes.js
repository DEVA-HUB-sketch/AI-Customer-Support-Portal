// backend/routes/authRoutes.js
const express = require("express");
const router = express.Router();
const { db, auth, isMock } = require("../config/firebase");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "deskflow_super_secret_token_123456";

/*
========================================
SIGNUP
========================================
*/
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Please fill all fields" });
    }

    const emailLower = email.toLowerCase();
    
    // Check if user already exists in Firestore
    const userSnapshot = await db.collection("users").where("email", "==", emailLower).get();
    if (!userSnapshot.empty) {
      return res.status(400).json({ message: "User already exists" });
    }

    const finalRole = role || "customer";
    
    if (isMock) {
      // Use local MockAuth
      await auth.createUser({
        email: emailLower,
        password: password,
        displayName: name,
        role: finalRole
      });
    } else {
      // Real Firebase Auth creation
      const userRecord = await auth.createUser({
        email: emailLower,
        password: password,
        displayName: name
      });
      
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Store additional details in Firestore
      await db.collection("users").doc(userRecord.uid).set({
        uid: userRecord.uid,
        name: name,
        email: emailLower,
        role: finalRole,
        password: hashedPassword, // Storing password hash for backend login flow simplicity
        createdAt: new Date().toISOString()
      });
    }

    res.status(201).json({
      message: "Signup Successful",
      user: { name, email: emailLower, role: finalRole }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/*
========================================
LOGIN
========================================
*/
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Please enter email and password" });
    }

    const emailLower = email.toLowerCase();

    // Query User by email in Firestore
    const userSnapshot = await db.collection("users").where("email", "==", emailLower).get();
    if (userSnapshot.empty) {
      return res.status(404).json({ message: "User not found" });
    }

    let userData = null;
    userSnapshot.forEach(doc => {
      userData = doc.data();
      userData.id = doc.id;
    });

    // Validate Password
    const isPasswordValid = await bcrypt.compare(password, userData.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid Password" });
    }

    // Generate JWT Token (Security Features: JWT Authentication)
    const token = jwt.sign(
      { uid: userData.uid || userData.id, email: userData.email, role: userData.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.status(200).json({
      message: "Login Successful",
      token: token,
      role: userData.role,
      user: {
        name: userData.name,
        email: userData.email,
        role: userData.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/*
========================================
PASSWORD RESET
========================================
*/
router.post("/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) {
      return res.status(400).json({ message: "Please provide email and new password" });
    }

    const emailLower = email.toLowerCase();

    const userSnapshot = await db.collection("users").where("email", "==", emailLower).get();
    if (userSnapshot.empty) {
      return res.status(404).json({ message: "User not found" });
    }

    let userId = null;
    userSnapshot.forEach(doc => {
      userId = doc.id;
    });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.collection("users").doc(userId).update({ password: hashedPassword });

    res.json({ message: "Password Updated Successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/*
========================================
PROFILE UPDATE
========================================
*/
router.put("/update-profile", async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email || !name) {
      return res.status(400).json({ message: "Please provide email and name" });
    }

    const emailLower = email.toLowerCase();

    const userSnapshot = await db.collection("users").where("email", "==", emailLower).get();
    if (userSnapshot.empty) {
      return res.status(404).json({ message: "User not found" });
    }

    let userId = null;
    userSnapshot.forEach(doc => {
      userId = doc.id;
    });

    await db.collection("users").doc(userId).update({ name });

    res.status(200).json({
      message: "Profile Updated Successfully",
      user: { name, email: emailLower }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/*
========================================
GET ALL USERS (Admin Roster)
========================================
*/
router.get("/users", async (req, res) => {
  try {
    const userSnapshot = await db.collection("users").get();
    const users = [];
    userSnapshot.forEach(doc => {
      const data = doc.data();
      // Don't send back hashed passwords to frontend
      const { password, ...safeUser } = data;
      users.push({ id: doc.id, ...safeUser });
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/*
========================================
UPDATE USER ROLE (RBAC Auth Control)
========================================
*/
router.put("/users/role", async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email || !role) {
      return res.status(400).json({ message: "Please provide email and role" });
    }

    const userSnapshot = await db.collection("users").where("email", "==", email.toLowerCase()).get();
    if (userSnapshot.empty) {
      return res.status(404).json({ message: "User not found" });
    }

    let userId = null;
    userSnapshot.forEach(doc => {
      userId = doc.id;
    });

    await db.collection("users").doc(userId).update({ role });
    res.json({ message: `User role updated to ${role} successfully` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;