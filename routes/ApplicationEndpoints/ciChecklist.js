const express = require('express');
const router = express.Router();
const authenticateToken = require('../../middleware/auth');
const authorizeRole = require('../../middleware/authorizeRole');

module.exports = (db) => {
  const loanApplications = db.collection('loan_applications');
  const ciChecklistsCollection = db.collection('ci_checklists');

  // Submit CI Checklist (Loan Officer)
  router.post(
    '/:applicationId/ci-checklist',
    authenticateToken,
    authorizeRole('loan officer'),
    async (req, res) => {
      try {
        const { applicationId } = req.params;
        const { loanOfficerName, checklist, notes, proofPhotos, status } = req.body;

        // Validate input
        if (!checklist || Object.keys(checklist).length === 0) {
          return res.status(400).json({ message: 'Checklist items are required' });
        }

        if (!notes || notes.trim().length === 0) {
          return res.status(400).json({ message: 'CI notes are required' });
        }

        // Check if application exists
        const application = await loanApplications.findOne({ applicationId });
        if (!application) {
          return res.status(404).json({ message: 'Application not found' });
        }

        // Verify application is in Pending status
        if (application.status !== 'Pending') {
          return res.status(400).json({ message: 'Application must be in Pending status' });
        }

        // Create CI checklist record
        const ciChecklist = {
          applicationId,
          loanOfficerId: req.user.userId,
          loanOfficerName,
          checklist,
          notes,
          proofPhotos: proofPhotos || [],
          submittedAt: new Date(),
          reviewedAt: null,
          reviewedBy: null,
          status: 'submitted', // submitted, approved, rejected
        };

        // Save CI checklist
        const result = await ciChecklistsCollection.insertOne(ciChecklist);

        // Update application status to Cleared
        await loanApplications.updateOne(
          { applicationId },
          {
            $set: {
              status: status || 'Cleared',
              ciChecklistId: result.insertedId,
              lastUpdatedBy: req.user.userId,
              lastUpdatedAt: new Date(),
            },
          }
        );

        res.status(201).json({
          message: 'CI checklist submitted successfully',
          ciChecklistId: result.insertedId,
          applicationId,
        });
      } catch (error) {
        console.error('Error submitting CI checklist:', error);
        res.status(500).json({ message: 'Failed to submit CI checklist' });
      }
    }
  );

  // Get CI Checklist (Manager)
  router.get(
    '/:applicationId/ci-checklist',
    authenticateToken,
    authorizeRole('manager', 'head', 'loan officer'),
    async (req, res) => {
      try {
        const { applicationId } = req.params;

        const ciChecklist = await ciChecklistsCollection.findOne({ applicationId });
        if (!ciChecklist) {
          return res.status(404).json({ message: 'CI checklist not found' });
        }

        res.status(200).json(ciChecklist);
      } catch (error) {
        console.error('Error fetching CI checklist:', error);
        res.status(500).json({ message: 'Failed to fetch CI checklist' });
      }
    }
  );

  // Review CI Checklist (Manager)
  router.put(
    '/:applicationId/ci-checklist',
    authenticateToken,
    authorizeRole('manager', 'head'),
    async (req, res) => {
      try {
        const { applicationId } = req.params;
        const { status: reviewStatus, notes: reviewNotes } = req.body;

        if (!['approved', 'rejected'].includes(reviewStatus)) {
          return res.status(400).json({ message: 'Invalid review status' });
        }

        const ciChecklist = await ciChecklistsCollection.findOne({ applicationId });
        if (!ciChecklist) {
          return res.status(404).json({ message: 'CI checklist not found' });
        }

        // Update CI checklist with review
        await ciChecklistsCollection.updateOne(
          { applicationId },
          {
            $set: {
              status: reviewStatus,
              reviewedAt: new Date(),
              reviewedBy: req.user.userId,
              reviewNotes: reviewNotes || '',
            },
          }
        );

        res.status(200).json({
          message: `CI checklist ${reviewStatus} successfully`,
          applicationId,
        });
      } catch (error) {
        console.error('Error reviewing CI checklist:', error);
        res.status(500).json({ message: 'Failed to review CI checklist' });
      }
    }
  );

  return router;
};
