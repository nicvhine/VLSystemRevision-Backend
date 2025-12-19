// routes/payments.ts
import express from "express";
import axios from "axios";
import crypto from "crypto";

const router = express.Router();

// Util: build a good descriptor + metadata
function buildPaymentMeta({ loanId, installmentId, borrowerId }: {loanId:string; installmentId:string; borrowerId:string}) {
  return {
    loan_id: loanId,
    installment_id: installmentId,
    borrower_id: borrowerId
  };
}

// POST /api/payments/checkout
router.post("/checkout", async (req, res) => {
  const { amountCentavos, currency, loanId, installmentId, borrowerId, email, name } = req.body;

  // Defensive checks
  if (!amountCentavos || !loanId || !installmentId || !borrowerId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Idempotency to avoid duplicate sessions if the client retries
    const idempotencyKey = crypto.randomUUID();

    const resp = await axios.post(
      "https://api.paymongo.com/v1/checkout_sessions",
      {
        data: {
          attributes: {
            cancel_url: "https://app.vlsystem.com/payments/cancel",
            success_url: "https://app.vlsystem.com/payments/success",
            description: `Loan ${loanId} • Installment ${installmentId}`,
            line_items: [
              {
                currency: currency || "PHP",
                amount: amountCentavos, // PayMongo expects amount in centavos
                name: `Installment #${installmentId}`,
                quantity: 1
              }
            ],
            payment_method_types: ["card", "gcash", "maya", "billease", "grab_pay", "bpi", "ubp"],
            customer: email ? { email, name } : undefined,
            metadata: buildPaymentMeta({ loanId, installmentId, borrowerId })
          }
        }
      },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(process.env.PM_SECRET_KEY + ":").toString("base64")}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
      }
    );

    const checkoutUrl = resp.data?.data?.attributes?.checkout_url;
    const sessionId = resp.data?.data?.id;

    return res.json({ checkoutUrl, sessionId });
  } catch (err: any) {
    console.error("PayMongo checkout error", err?.response?.data || err?.message);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

export default router;