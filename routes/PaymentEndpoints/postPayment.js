const express = require("express");
const paymentService = require("../../services/paymentService");
const authenticateToken = require("../../middleware/auth");
const authorizeRole = require("../../middleware/authorizeRole");
const { addBorrowerPaymentNotification } = require("../../services/borrowerNotif");

module.exports = (db) => {
  const router = express.Router();

  // Cash payment
  router.post(
    "/:referenceNumber/cash",
    authenticateToken,
    authorizeRole("collector"),
    async (req, res) => {
      try {
        const { name } = req.user; 
        const { referenceNumber } = req.params;
  
        // Fetch the collection
        const collection = await db.collection("collections").findOne({ referenceNumber });
        if (!collection) return res.status(404).json({ error: "Collection not found" });
        if (collection.collector !== name) {
          return res.status(403).json({ error: "You can only process payments for your assigned collections." });
        }
  
        // The service will detect loan type internally
        const result = await paymentService.handleCashPayment({ referenceNumber, ...req.body }, db);
  
        // Notify borrower and collector
        if (result?.borrowersId && result?.amount) {
          await addBorrowerPaymentNotification(db, result.borrowersId, referenceNumber, result.amount, "Cash");
          
          const notificationRepository = require("../../repositories/notificationRepository");
          const notifRepo = notificationRepository(db);
          
          // Notify collector about payment received
          const borrower = await db.collection("borrowers_account").findOne(
            { borrowersId: result.borrowersId },
            { projection: { assignedCollectorId: 1, name: 1 } }
          );
          
          if (borrower?.assignedCollectorId) {
            const assignedCollectorId = borrower.assignedCollectorId; 

            const { decrypt } = require("../../utils/crypt");
            const borrowerName = borrower.name ? decrypt(borrower.name) : "Unknown";
            
            await notifRepo.insertCollectorNotification({
              type: "cash-payment-received",
              title: "Payment Collected",
              message: `Cash payment of ₱${result.amount.toLocaleString()} has been received from ${borrowerName} for collection reference ${referenceNumber}. Payment successfully posted to account.`,
              referenceNumber,
              borrowersId: result.borrowersId,
              collectorId: assignedCollectorId,
              amount: result.amount,
              actor: borrowerName,
              read: false,
              viewed: false,
              createdAt: new Date(),
            });
          }
        }
  
        res.json(result);
      } catch (err) {
        console.error("Cash payment error:", err);
        res.status(500).json({ error: err.message });
      }
    }
  );
  
  
 // PayMongo GCash: create intent (borrower only)
  router.post(
    "/paymongo/gcash",
    authenticateToken,
    authorizeRole("borrower"),
    async (req, res) => {
      try {
        const { borrowersId } = req.user; 
        const result = await paymentService.createPaymongoGcash({ ...req.body, borrowersId }, db);
        res.json(result);
      } catch (err) {
        console.error("PayMongo error:", err.response?.data || err.message);
        res.status(500).json({ error: "PayMongo payment failed" });
      }
    }
  );

  router.post(
    "/:referenceNumber/paymongo/success",
    authenticateToken,
    authorizeRole("borrower"),
    async (req, res) => {
      try {
        const { borrowersId } = req.user;
        const referenceNumber = req.params.referenceNumber;
  
        const collection = await db.collection("collections").findOne({ referenceNumber });
        if (!collection) return res.status(404).json({ error: "Collection not found" });
        if (collection.borrowersId !== borrowersId) return res.status(403).json({ error: "You can only confirm payments for your own loans." });
  
        // Handle PayMongo payment
        const result = await paymentService.handlePaymongoSuccess(referenceNumber, db);
  
        // Notify borrower
        if (result?.borrowersId && result?.amount) {
          await addBorrowerPaymentNotification(db, result.borrowersId, referenceNumber, result.amount, "PayMongo");
  
          // Notify collector
          const notificationRepository = require("../../repositories/notificationRepository");
          const notifRepo = notificationRepository(db);
  
          const borrower = await db.collection("borrowers_account").findOne(
            { borrowersId: result.borrowersId },
            { projection: { assignedCollectorId: 1, name: 1 } }
          );
  
          if (borrower?.assignedCollectorId) {
            const assignedCollectorId = borrower.assignedCollectorId; 

            const { decrypt } = require("../../utils/crypt");
            const borrowerName = borrower.name ? decrypt(borrower.name) : "Unknown";
  
            // await notifRepo.insertCollectorNotification({
            //   type: "paymongo-payment-received",
            //   title: "Payment Collected",
            //   message: `PayMongo payment of ₱${result.amount.toLocaleString()} has been received from ${borrowerName} for collection reference ${referenceNumber}. Payment successfully posted to account.`,
            //   referenceNumber,
            //   borrowersId: result.borrowersId,
            //   collectorId: assignedCollectorId,
            //   amount: result.amount,
            //   actor: borrowerName,
            //   read: false,
            //   viewed: false,
            //   createdAt: new Date(),
            // });
          }
        }
  
        res.json({ success: true, ...result });
      } catch (err) {
        console.error("PayMongo success error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );
  

  return router;
};
