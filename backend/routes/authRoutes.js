const express = require("express");
const router = express.Router();
const User = require("../models/User");

/*
========================================
SIGNUP
========================================
*/

router.post("/signup", async (req, res) => {

  try {

    const {
      name,
      email,
      password,
      role
    } = req.body;

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists"
      });
    }

    const user = await User.create({
      name,
      email,
      password,
      role: role || "customer"
    });

    res.status(201).json({
      message: "Signup Successful",
      user
    });

  } catch (error) {

    res.status(500).json({
      message: error.message
    });

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

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    if (user.password !== password) {
      return res.status(401).json({
        message: "Invalid Password"
      });
    }

    res.status(200).json({
      message: "Login Successful",
      role: user.role,
      user
    });

  } catch (error) {

    res.status(500).json({
      message: error.message
    });

  }

});
router.post(
"/reset-password",
async(req,res)=>{

try{

const {
email,
newPassword
} = req.body;

const user =
await User.findOne({email});

if(!user){

return res.status(404).json({
message:"User not found"
});

}

user.password =
newPassword;

await user.save();

res.json({
message:
"Password Updated Successfully"
});

}catch(error){

res.status(500).json(error);

}

});
router.put("/update-profile", async (req, res) => {

    try {

        const { email, name } = req.body;

        const user = await User.findOneAndUpdate(
            { email },
            { name },
            { new: true }
        );

        if (!user) {

            return res.status(404).json({
                message: "User not found"
            });

        }

        res.status(200).json({
            message: "Profile Updated Successfully",
            user
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

module.exports = router;