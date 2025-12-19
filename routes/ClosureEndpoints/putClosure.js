const express = require('express');
const router = express.Router();
const ClosureService = require("../../services/closureService");
const NotificationRepository = require("../../repositories/notificationRepository");
const { sendSMS } = require("../../services/smsService");

module.exports = (db) => {
  const service = ClosureService(db);
  const notifRepo = NotificationRepository(db);

  router.put('/:endorsementId', async (req, res) => {
    const { endorsementId } = req.params;
    const { status } = req.body;

    if (!status || !["Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    try {
      const closure = await service.getClosureById(endorsementId);
      if (!closure) return res.status(404).json({ message: "Closure not found" });

      const loanId = closure.loanId?.trim();
      if (!loanId) return res.status(400).json({ message: "LoanId not found in closure" });

      console.log("Updating closure:", endorsementId, "→", status);

      // Update closure
      await db.collection("closure_endorsements").updateOne(
        { endorsementId },
        { $set: { status, updatedAt: new Date() } }
      );

      // Fetch loan and borrower
      const loan = await db.collection("loans").findOne({ loanId });
      if (!loan) return res.status(404).json({ message: "Loan not found" });

      const borrower = await db.collection("borrowers_account").findOne({ borrowersId: loan.borrowersId });
      console.log("Borrower found:", borrower?.name, borrower?.phoneNumber);

      // Notify loan officer
      const loanOfficer = await db.collection("users").findOne({ role: "loan officer" });
      if (loanOfficer) {
        await notifRepo.insertLoanOfficerNotification({
          type: `closure-${status.toLowerCase()}`,
          title: `Closure ${status}`,
          message: `Closure endorsement for loan ${loanId} by ${closure.authorizedBy} has been ${status.toLowerCase()}.`,
          referenceNumber: loanId,
          actor: closure.authorizedBy || "System",
          read: false,
          viewed: false,
          createdAt: new Date(),
        });
        console.log("Loan officer notified in app.");
      }

      // Send SMS to borrower
      if (borrower?.phoneNumber) {
        const smsMsg =
          status === "Approved"
            ? `Good day, ${borrower.name}! Your loan ${loanId} has been successfully closed. We understand the challenges you may be facing and hope for better days ahead. Thank you for your time with Vistula Lending Corporation. Should you wish to reapply in the future, we’ll be glad to assist you.`
            : `Hello, ${borrower.name}. Your closure request for loan ${loanId} was not approved. Please contact our office for details.`;

        console.log("Sending SMS to:", borrower.phoneNumber, "Message:", smsMsg);

        try {
          await sendSMS(borrower.phoneNumber, smsMsg);
          console.log("✅ SMS sent successfully.");
        } catch (smsErr) {
          console.error("❌ SMS sending failed:", smsErr.response?.data || smsErr.message);
        }
      } else {
        console.warn("⚠️ No borrower phone number found, skipping SMS.");
      }

      // Update loan and collections if approved
      if (status === "Approved") {
        await db.collection("loans").updateOne(
          { loanId },
          { $set: { status: "Closed", dateClosed: new Date() } }
        );

        await db.collection("collections").updateMany(
          { loanId },
          { $set: { status: "Closed" } }
        );

        if (loan.applicationId) {
          await db.collection("loan_applications").updateMany(
            { applicationId: loan.applicationId },
            { $set: { status: "Closed" } }
          );
        } else {
          console.warn(`⚠️ Loan ${loanId} has no applicationId, skipping loan_applications update.`);
        }
      }

      return res.status(200).json({ message: `Closure ${status.toLowerCase()} successfully` });
    } catch (err) {
      console.error("Closure update error:", err);
      return res.status(500).json({ message: "Server error" });
    }
  });

  return router;
};
