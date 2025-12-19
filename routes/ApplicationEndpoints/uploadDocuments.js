const express = require("express");
const router = express.Router();
const { upload, processUploadedDocs } = require("../../utils/uploadConfig");
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");
const LogRepository = require("../../repositories/logRepository");

module.exports = (db) => {
  const loanApplications = db.collection("loan_applications");
  const logRepo = LogRepository(db);

  // Upload additional documents to an existing application
  router.post(
    "/:applicationId/upload-documents",
    authenticateToken,
    authorizeRole("manager", "loan officer"),
    upload.fields([{ name: "documents", maxCount: 10 }]),
    async (req, res) => {
      try {
        const { applicationId } = req.params;

        // Check if application exists
        const existingApp = await loanApplications.findOne({ applicationId });
        if (!existingApp) {
          return res.status(404).json({ error: "Loan application not found." });
        }

        // Process uploaded files
        const uploadedFiles = await processUploadedDocs(req.files);

        if (!uploadedFiles || uploadedFiles.length === 0) {
          return res.status(400).json({ error: "No files uploaded." });
        }

        // Append new documents to existing documents array
        const currentDocuments = existingApp.documents || [];
        const updatedDocuments = [...currentDocuments, ...uploadedFiles];

        // Update application with new documents
        await loanApplications.updateOne(
          { applicationId },
          { $set: { documents: updatedDocuments } }
        );

        const creatorName = req.user.name;

        // Log the action
        await logRepo.insertActivityLog({
          userId: req.user.userId,
          name: creatorName,
          role: req.user.role,
          action: "UPLOAD_DOCUMENTS",
          description: `${creatorName} uploaded ${uploadedFiles.length} document(s) to loan application ${applicationId}`,
        });

        res.status(200).json({
          message: "Documents uploaded successfully",
          uploadedCount: uploadedFiles.length,
          documents: updatedDocuments,
        });
      } catch (error) {
        console.error("Error uploading documents:", error);
        res.status(500).json({ error: "Failed to upload documents." });
      }
    }
  );

  // Delete a document from an existing application
  router.delete(
    "/:applicationId/delete-document",
    authenticateToken,
    authorizeRole("manager", "loan officer"),
    async (req, res) => {
      try {
        const { applicationId } = req.params;
        const { fileName, filePath } = req.body;

        if (!fileName || !filePath) {
          return res.status(400).json({ error: "fileName and filePath are required." });
        }

        // Check if application exists
        const existingApp = await loanApplications.findOne({ applicationId });
        if (!existingApp) {
          return res.status(404).json({ error: "Loan application not found." });
        }

        // Remove the document from the array
        const currentDocuments = existingApp.documents || [];
        const updatedDocuments = currentDocuments.filter(
          (doc) => doc.fileName !== fileName || doc.filePath !== filePath
        );

        // Update application with filtered documents
        await loanApplications.updateOne(
          { applicationId },
          { $set: { documents: updatedDocuments } }
        );

        const creatorName = req.user.name;

        // Log the action
        await logRepo.insertActivityLog({
          userId: req.user.userId,
          name: creatorName,
          role: req.user.role,
          action: "DELETE_DOCUMENT",
          description: `${creatorName} deleted document "${fileName}" from loan application ${applicationId}`,
        });

        res.status(200).json({
          message: "Document deleted successfully",
          documents: updatedDocuments,
        });
      } catch (error) {
        console.error("Error deleting document:", error);
        res.status(500).json({ error: "Failed to delete document." });
      }
    }
  );

  return router;
};
