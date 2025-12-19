const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/auth');
const authorizeRole = require('../../middleware/authorizeRole');
const fs = require('fs');
const path = require('path');

module.exports = (db) => {
    const users = db.collection('users');

    // DELETE USER BY ID
    router.delete('/:id', authenticateToken, authorizeRole("head", "sysad"), async (req, res) => {
        try {
            const id = req.params.id;
            const actor = req.user?.username || 'Unknown';

            const userToDelete = await users.findOne({ userId: id });

            if (!userToDelete) {
                return res.status(404).json({ message: 'User not found' });
            }

            const deleteResult = await users.deleteOne({ userId: id });

            if (deleteResult.deletedCount === 0) {
                return res.status(500).json({ message: 'Failed to delete user' });
            }

            await db.collection('logs').insertOne({
                timestamp: new Date(),
                actor,
                action: "DELETE_USER",
                details: `Deleted user ${userToDelete.username} (${userToDelete.role}) with ID ${userToDelete.userId}.`,
            });

            res.status(204).send();
        } catch (err) {
            console.error('Failed to delete user:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    });

    // REMOVE USER PROFILE PICTURE
    router.delete('/:id/remove-profile', authenticateToken, async (req, res) => {
        try {
            const id = req.params.id;
            const actor = req.user?.username || 'Unknown';

            if (req.user.userId !== id) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            const user = await users.findOne({ userId: id });
            if (!user) return res.status(404).json({ message: 'User not found' });

            if (user.profilePic && user.profilePic !== '/idPic.jpg') {
                const picPath = path.join(__dirname, '..', '..', 'uploads', user.profilePic);
                if (fs.existsSync(picPath)) {
                    fs.unlinkSync(picPath);
                }
            }

            await users.updateOne(
                { userId: id },
                { $set: { profilePic: '/idPic.jpg' } }
            );

            await db.collection('logs').insertOne({
                timestamp: new Date(),
                actor,
                action: "REMOVE_PROFILE_PIC",
                details: `Removed profile picture for user ${user.username} (${user.role}) with ID ${user.userId}.`,
            });

            res.json({ message: 'Profile picture removed', profilePic: '/idPic.jpg' });
        } catch (err) {
            console.error('Failed to remove profile picture:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    });

    return router;
};
