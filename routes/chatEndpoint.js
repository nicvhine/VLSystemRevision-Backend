const express = require("express");
const router = express.Router();

router.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message.trim() === "") {
      return res.status(400).json({ error: "Message is required" });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      console.error("OpenRouter API key not configured");
      return res.status(500).json({ error: "API key not configured" });
    }

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "meta-llama/llama-2-70b-chat",
          messages: [
            {
              role: "system",
              content: `You are a friendly and helpful payment assistant for a lending platform. 

Your role is to:
- Answer questions about loan payments, payment schedules, and payment methods
- Explain loan restructuring/reloan processes
- Provide guidance on payment deadlines and penalties
- Help borrowers understand their loan terms
- Be empathetic and supportive

When answering:
- Keep responses concise and clear (max 3-4 sentences)
- Use simple language, avoid jargon
- Be helpful and encouraging
- If asked about something outside your scope, politely redirect to contacting support`,
            },
            {
              role: "user",
              content: message,
            },
          ],
          max_tokens: 500,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("OpenRouter API error:", error);
      return res.status(response.status).json({ error: "Failed to get response from AI" });
    }

    const data = await response.json();
    const botResponse =
      data.choices?.[0]?.message?.content ||
      "I'm having trouble understanding. Could you rephrase that?";

    res.json({ reply: botResponse });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
