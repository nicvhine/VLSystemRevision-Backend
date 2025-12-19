// routes/paymongo-webhook.ts
import express from "express";
import crypto from "crypto";
import axios from "axios";
const { BACKEND_URL } = require('../config');

const router = express.Router();

// Raw body parser is important to compute signature
router.use(express.raw({ type: "*/*" }));

function verifySignature(rawBody: Buffer, header: string | undefined, secret: string) {
  if (!header) return false;
  // header format: "t=TIMESTAMP,te=SIGNATURE" in test mode; "t=...,li=..." in live
  const parts = Object.fromEntries(header.split(",").map(kv => kv.split("=").map(s => s.trim())));
  const timestamp = parts["t"];
  const signature = parts["te"] || parts["li"]; // te=test, li=live
  if (!timestamp || !signature) return false;

  const payload = `${timestamp}.${rawBody.toString("utf8")}`;
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hmac));
}

router.post("/webhooks/paymongo", async (req, res) => {
  const signatureHeader = req.header("Paymongo-Signature");
  const secret = process.env.PM_WEBHOOK_SECRET || "";

  if (!verifySignature(req.body as Buffer, signatureHeader, secret)) {
    return res.status(400).send("Invalid signature");
  }

  // Parse after verification
  const event = JSON.parse((req.body as Buffer).toString("utf8"));
  const type = event?.data?.attributes?.type;

  try {
    if (type === "checkout_session.payment.paid" || type === "payment.paid") {
      const attrs = event.data.attributes;
      const meta = attrs?.data?.attributes?.metadata || attrs?.metadata || {};
      const amount = attrs?.data?.attributes?.amount || attrs?.amount;
      const currency = attrs?.data?.attributes?.currency || attrs?.currency;
      const paymentId = attrs?.data?.id || attrs?.id;

      // Update your Loans/CRM service
      await axios.post(`${BACKEND_URL}/internal/payments/mark-paid`, {
        loanId: meta.loan_id,
        installmentId: meta.installment_id,
        borrowerId: meta.borrower_id,
        gateway: "paymongo",
        gatewayPaymentId: paymentId,
        amountCentavos: amount,
        currency,
        paidAt: new Date().toISOString()
      }, { headers: { "X-Internal-Token": process.env.INTERNAL_TOKEN! } });
    }

    // idempotent OK
    res.status(200).json({ received: true });
  } catch (e) {
    console.error("Webhook processing error", e);
    // Return 500 to trigger PayMongo retry
    res.status(500).send("Webhook error");
  }
});

export default router;