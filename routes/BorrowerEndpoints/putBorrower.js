const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
require('dotenv').config();
const authenticateToken = require('../../middleware/auth');

module.exports = (db) => {
  const borrowers = db.collection("borrowers_account");

  // Reset password by id (forgot password flow)
  router.put("/reset-password/:id", async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!newPassword || !passwordRegex.test(newPassword)) {
      return res.status(400).json({ 
        message: 'Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.' 
      });
    }

    try {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await borrowers.updateOne(
        { borrowersId: id },
        { $set: { password: hashedPassword, isFirstLogin: false } }
      );
      res.status(200).json({ message: 'Password reset successfully' });
    } catch (err) {
      console.error("Password reset error:", err);
      res.status(500).json({ message: 'Server error while resetting password' });
    }
  });

  // Change password (only by logged-in borrower)
  router.put('/:id/change-password', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { newPassword, currentPassword } = req.body;

    if (req.user.borrowersId !== id) {
      return res.status(403).json({ message: 'Unauthorized: You can only change your own password.' });
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!newPassword || !passwordRegex.test(newPassword)) {
      return res.status(400).json({ 
        message: 'Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.' 
      });
    }

    try {
      const user = await borrowers.findOne({ borrowersId: id });
      if (!user) return res.status(404).json({ message: 'Borrower not found' });

      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) return res.status(400).json({ message: 'Incorrect current password' });

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await borrowers.updateOne(
        { borrowersId: id },
        { $set: { password: hashedPassword, isFirstLogin: false} }
      );

      res.status(200).json({ message: 'Password updated successfully' });
    } catch (err) {
      console.error('Password update error:', err);
      res.status(500).json({ message: 'Server error while updating password' });
    }
  });

  router.put('/:id/assign-collector', async (req, res) => {
    const { id } = req.params;
    const { assignedCollector, assignedCollectorName } = req.body;
  
    if (!assignedCollector) {
      return res.status(400).json({ message: "assignedCollector is required." });
    }
  
    try {
      const borrower = await borrowers.findOne({ borrowersId: id });
      if (!borrower) {
        return res.status(404).json({ message: "Borrower not found." });
      }

      const previousCollector = borrower.assignedCollector || "None";
  
      await borrowers.updateOne(
        { borrowersId: id },
        {
          $set: {
            assignedCollector: assignedCollectorName,
            assignedCollectorId: assignedCollector,
          },
        }
      );
  
      const collections = db.collection("collections");
      const collectionsUpdated = await collections.updateMany(
        { borrowersId: id },
        {
          $set: {
            collector: assignedCollectorName,
            collectorId: assignedCollector,
          },
        }
      );

      // Notify the new collector
      try {
        const notificationRepository = require("../../repositories/notificationRepository");
        const notifRepo = notificationRepository(db);
        const { decrypt } = require("../../utils/crypt");
        const borrowerName = borrower.name ? decrypt(borrower.name) : "Unknown";

        await notifRepo.insertCollectorNotification({
          type: "collector-assigned",
          title: "New Account Assignment",
          message: `You have been assigned as the collection officer for borrower ${borrowerName} (Account ID: ${id}). Total of ${collectionsUpdated.modifiedCount} collection record(s) have been transferred to your portfolio.`,
          borrowersId: id,
          actor: "Manager",
          read: false,
          viewed: false,
          createdAt: new Date(),
        });

        // Notify loan officer if collector changed
        if (previousCollector !== "None" && previousCollector !== assignedCollectorName) {
          await notifRepo.insertLoanOfficerNotification({
            type: "collector-changed",
            title: "Collection Officer Reassignment",
            message: `The collection officer for borrower ${borrowerName} (Account ID: ${id}) has been reassigned from ${previousCollector} to ${assignedCollectorName}.`,
            borrowersId: id,
            actor: "Manager",
            read: false,
            viewed: false,
            createdAt: new Date(),
          });
        }
      } catch (notifErr) {
        console.error("Failed to send collector assignment notification:", notifErr);
      }
  
      res.status(200).json({
        message: "Collector updated successfully",
        assignedCollector: assignedCollectorName,
        assignedCollectorId: assignedCollector,
      });
    } catch (err) {
      console.error("Error updating assigned collector:", err);
      res.status(500).json({ message: "Server error while updating collector." });
    }
  });  

  router.put('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, email, phoneNumber, profilePic } = req.body;

    if (!name && !email && !phoneNumber && !profilePic) {
      return res.status(400).json({ message: "At least one field must be provided to update." });
    }

    try {
      const borrower = await borrowers.findOne({ borrowersId: id });
      if (!borrower) return res.status(404).json({ message: "Borrower not found." });

      const updateData = {};
      if (name) updateData.name = name;
      if (email) updateData.email = email;
      if (phoneNumber) updateData.phoneNumber = phoneNumber;
      if (profilePic) updateData.profilePic = profilePic;

      await borrowers.updateOne(
        { borrowersId: id },
        { $set: updateData }
      );

      res.status(200).json({ message: "Borrower details updated successfully.", updatedFields: updateData });
    } catch (err) {
      console.error("Error updating borrower details:", err);
      res.status(500).json({ message: "Server error while updating borrower details." });
    }
  });

  router.put('/:borrowersId/update-email', authenticateToken, async (req, res) => {
    const { borrowersId } = req.params;
    const { email } = req.body;
    const { borrowersId: jwtBorrowersId } = req.user;

    if (jwtBorrowersId !== borrowersId) return res.status(403).json({ error: 'Unauthorized: can only update your own email' });

    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = email.trim().toLowerCase();

    try {
      const existingUser = await borrowers.findOne({ email: normalizedEmail });
      if (existingUser && existingUser.borrowersId !== borrowersId) {
        return res.status(409).json({ error: 'Email already in use.' });
      }

      await borrowers.updateOne({ borrowersId }, { $set: { email: normalizedEmail } });

    
      res.status(200).json({ message: 'Email updated successfully' });
    } catch (err) {
      console.error('Failed to update email:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.put('/:borrowersId/update-phoneNumber', authenticateToken, async (req, res) => {
    const { borrowersId } = req.params;
    const { phoneNumber } = req.body;
    const { borrowersId: jwtBorrowersId } = req.user;

    if (jwtBorrowersId!== borrowersId) return res.status(403).json({ error: 'Unauthorized: can only update your own phone number' });

    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required' });

    try {
      const existingUser = await borrowers.findOne({ phoneNumber });
      if (existingUser && existingUser.borrowersId !== borrowersId) {
        return res.status(409).json({ error: 'Phone number already in use.' });
      }

      await borrowers.updateOne({ borrowersId }, { $set: { phoneNumber } });

      res.status(200).json({ message: 'Phone number updated successfully' });
    } catch (err) {
      console.error('Failed to update phone number:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });
  
  return router;
};
