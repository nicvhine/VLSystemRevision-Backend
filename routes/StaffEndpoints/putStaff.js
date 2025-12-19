const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/auth');
const bcrypt = require('bcrypt');
const LogRepository = require('../../repositories/logRepository'); 

module.exports = (db) => {
  const users = db.collection('users');
  const logRepo = LogRepository(db);

  async function logAction(user, action, description) {
    try {
      await logRepo.insertActivityLog({
        userId: user.userId,
        name: user.name,
        role: user.role,
        action,
        description,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error("Logging failed:", err);
    }
  }
  router.put('/:id/change-password', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;  
    const { role, userId: jwtUserId } = req.user;
  
    if (jwtUserId !== id && role !== 'head') {
      return res.status(403).json({ message: 'Unauthorized: can only change your own password' });
    }
  
    if (!currentPassword) {
      return res.status(400).json({ message: 'Current password is required.' });
    }
  
    try {
      const user = await users.findOne({ userId: id });
      if (!user) return res.status(404).json({ message: 'User not found' });

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Current password is incorrect.' });
      }
  
      // Validate new password
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
      if (!newPassword || !passwordRegex.test(newPassword)) {
        return res.status(400).json({
          message:
            'Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.',
        });
      }
  
      // Update password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await users.updateOne({ userId: id }, { $set: { password: hashedPassword, isFirstLogin: false } });
  
      res.status(200).json({ message: 'Password updated successfully' });
    } catch (err) {
      console.error('Password update error:', err);
      res.status(500).json({ message: 'Server error while updating password' });
    }
  });
  
  router.put('/:userId/update-email', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const { email } = req.body;
    const { userId: jwtUserId } = req.user;

    if (jwtUserId !== userId) return res.status(403).json({ error: 'Unauthorized: can only update your own email' });

    if (!email) return res.status(400).json({ error: 'Email is required' });

    const normalizedEmail = email.trim().toLowerCase();

    try {
      const existingUser = await users.findOne({ email: normalizedEmail });
      if (existingUser && existingUser.userId !== userId) {
        return res.status(409).json({ error: 'Email already in use.' });
      }

      await users.updateOne({ userId }, { $set: { email: normalizedEmail } });

      // Log action
      await logAction(req.user, "Update Email", `${req.user.name} updated email to ${normalizedEmail}`);

      res.status(200).json({ message: 'Email updated successfully' });
    } catch (err) {
      console.error('Failed to update email:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.put('/:userId/update-phoneNumber', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const { phoneNumber } = req.body;
    const { userId: jwtUserId } = req.user;

    if (jwtUserId !== userId) return res.status(403).json({ error: 'Unauthorized: can only update your own phone number' });

    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required' });

    try {
      const existingUser = await users.findOne({ phoneNumber });
      if (existingUser && existingUser.userId !== userId) {
        return res.status(409).json({ error: 'Phone number already in use.' });
      }

      await users.updateOne({ userId }, { $set: { phoneNumber } });

      // Log action
      await logAction(req.user, "Update Phone", `${req.user.name} updated phone number`);

      res.status(200).json({ message: 'Phone number updated successfully' });
    } catch (err) {
      console.error('Failed to update phone number:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.put('/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const { name, email, phoneNumber, role, status} = req.body;
    const { role: jwtRole, userId: jwtUserId } = req.user;

    if (userId !== jwtUserId && jwtRole !== 'head' && jwtRole !== 'sysad') {
      return res.status(403).json({ message: 'Unauthorized: can only edit your own details unless head or sysad' });
    }    

    if (!name && !email && !phoneNumber && !role && !status) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }

    try {
      if (email) {
        const normalizedEmail = email.trim().toLowerCase();
        const existingEmailUser = await users.findOne({ email: normalizedEmail });
        if (existingEmailUser && existingEmailUser.userId !== userId) {
          return res.status(409).json({ message: 'Email already in use by another user.' });
        }
      }

      if (phoneNumber) {
        const existingPhoneUser = await users.findOne({ phoneNumber });
        if (existingPhoneUser && existingPhoneUser.userId !== userId) {
          return res.status(409).json({ message: 'Phone number already in use by another user.' });
        }
      }

      const updateFields = { updatedAt: new Date() };
      if (name) updateFields.name = name;
      if (email) updateFields.email = email?.trim().toLowerCase();
      if (phoneNumber) updateFields.phoneNumber = phoneNumber;
      if (role && (jwtRole === 'head' || jwtRole === 'sysad')) updateFields.role = role;
      if (status) updateFields.status = status;

      const updateResult = await users.updateOne({ userId }, { $set: updateFields });
      if (updateResult.matchedCount === 0) return res.status(404).json({ message: 'User not found' });

      const updatedUser = await users.findOne({ userId });

      // Log action
      await logAction(req.user, "Edit Staff", `${req.user.name} updated details for ${updatedUser.name} (${updatedUser.userId})`);

      res.status(200).json({ message: 'User updated successfully', user: updatedUser });
    } catch (error) {
      console.error('Failed to update user:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });

  return router;
};
