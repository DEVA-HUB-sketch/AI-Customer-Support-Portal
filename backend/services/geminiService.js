// backend/services/geminiService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

const API_KEY = process.env.GEMINI_API_KEY || "";
let genAI = null;

if (API_KEY) {
  genAI = new GoogleGenerativeAI(API_KEY);
} else {
  console.warn("[GeminiService] GEMINI_API_KEY not set — falling back to rule-based AI.");
}

const SYSTEM_PROMPT = `You are DeskFlow AI Assistant, an expert customer support AI for a SaaS platform called DeskFlow.
Your name is Zia. Be concise, professional, empathetic, and helpful.
When answering customer queries, provide actionable solutions.
If you cannot resolve an issue, suggest escalating to a human agent.
Keep responses under 150 words unless a detailed explanation is needed.`;

/**
 * Chat with Gemini — maintains conversation history context.
 * Falls back to rule-based reply if API key is missing.
 */
async function geminiChat(userMessage, history = []) {
  if (!genAI) {
    console.log("[GeminiService] No API key — using fallback for:", userMessage.substring(0, 60));
    return fallbackChat(userMessage);
  }

  try {
    // systemInstruction belongs on getGenerativeModel, NOT startChat
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: SYSTEM_PROMPT
    });

    // Build valid alternating user/model pairs for Gemini history.
    // The history[] sent from frontend already excludes the current message.
    // We only take complete pairs (user followed by model) to avoid
    // an invalid history that ends with a user turn.
    const formattedHistory = [];
    for (let i = 0; i + 1 < history.length; i += 2) {
      const u = history[i];
      const m = history[i + 1];
      if (u && m && u.role === "user" && m.role === "model") {
        formattedHistory.push(
          { role: "user",  parts: [{ text: u.text || "" }] },
          { role: "model", parts: [{ text: m.text || "" }] }
        );
      }
    }

    console.log("[GeminiService] Sending to Gemini — message:", userMessage.substring(0, 60));
    console.log("[GeminiService] History pairs:", formattedHistory.length / 2);

    const chat = model.startChat({
      history: formattedHistory,
      generationConfig: { maxOutputTokens: 300, temperature: 0.7 }
    });

    const result = await chat.sendMessage(userMessage);
    const text = result.response.text();

    if (!text || !text.trim()) {
      console.warn("[GeminiService] Empty response — using fallback.");
      return fallbackChat(userMessage);
    }

    console.log("[GeminiService] Gemini reply:", text.trim().substring(0, 80));
    return { reply: text.trim(), source: "gemini" };

  } catch (err) {
    console.error("[GeminiService] Chat error:", err.message);
    return fallbackChat(userMessage);
  }
}

/**
 * Analyze sentiment using Gemini — returns Positive / Neutral / Negative + score + explanation.
 */
async function geminiSentiment(text) {
  if (!genAI) {
    return fallbackSentiment(text);
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Analyze the sentiment of this customer support message.
Respond ONLY with valid JSON: {"sentiment":"Positive"|"Neutral"|"Negative","score":0-100,"emoji":"😊"|"😐"|"😠","explanation":"one sentence"}

Message: "${text}"`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/```json|```/g, "").trim();
    return { ...JSON.parse(raw), source: "gemini" };
  } catch (err) {
    console.error("[GeminiService] Sentiment error:", err.message);
    return fallbackSentiment(text);
  }
}

/**
 * Categorize a support ticket using Gemini.
 */
async function geminiCategorize(subject, description) {
  if (!genAI) {
    return fallbackCategorize(subject, description);
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Classify this support ticket into exactly ONE category.
Categories: "Technical Issue" | "Billing Issue" | "Account Issue" | "Feature Request" | "General Inquiry"
Respond ONLY with valid JSON: {"category":"...","confidence":0-100,"reason":"one sentence"}

Subject: "${subject}"
Description: "${description}"`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/```json|```/g, "").trim();
    return { ...JSON.parse(raw), source: "gemini" };
  } catch (err) {
    console.error("[GeminiService] Categorize error:", err.message);
    return fallbackCategorize(subject, description);
  }
}

/**
 * Generate suggested agent responses using Gemini.
 */
async function geminiSuggestResponses(ticketContext) {
  if (!genAI) {
    return fallbackSuggest(ticketContext);
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `You are a customer support expert. Generate 3 professional response suggestions for a support agent.
Respond ONLY with valid JSON: {"suggestions":["response1","response2","response3"]}

Ticket context:
Category: ${ticketContext.category}
Sentiment: ${ticketContext.sentiment}
Subject: ${ticketContext.subject}
Description: ${ticketContext.description}`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/```json|```/g, "").trim();
    return { ...JSON.parse(raw), source: "gemini" };
  } catch (err) {
    console.error("[GeminiService] Suggest error:", err.message);
    return fallbackSuggest(ticketContext);
  }
}

/**
 * Search FAQ / KB using Gemini to match the best answer.
 */
async function geminiFaqSearch(query, articles = []) {
  if (!genAI || articles.length === 0) {
    return { answer: null, source: "none" };
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const articleText = articles.map((a, i) => `[${i}] Q: ${a.question}\nA: ${a.answer}`).join("\n\n");
    const prompt = `Given these FAQ articles:\n${articleText}\n\nAnswer this customer question concisely (under 80 words): "${query}"\nIf no article matches, reply with "I don't have specific information on that. Please contact support."`;

    const result = await model.generateContent(prompt);
    return { answer: result.response.text(), source: "gemini" };
  } catch (err) {
    console.error("[GeminiService] FAQ error:", err.message);
    return { answer: null, source: "error" };
  }
}

// ─── Fallback rule-based implementations ────────────────────────────────────

function fallbackChat(message) {
  const clean = message.toLowerCase();
  // Use word-boundary regex — "hi" inside "while/this/which" must NOT match
  if (/\bhello\b|\bhi\b|\bhey\b/.test(clean)) {
    return { reply: "Hello! I'm Zia, DeskFlow AI Assistant. How can I help you today?", source: "fallback" };
  }
  if (/\bpassword\b|\blogin\b|\bsign.?in\b|\baccount\b|\bauthentication\b/.test(clean)) {
    return { reply: "For login issues, try resetting your password: click 'Forgot Password' on the sign-in page and follow the email instructions. If your account is locked, please open a support ticket and an agent will unlock it within 1 hour.", source: "fallback" };
  }
  if (/\brefund\b|\bbilling\b|\bpayment\b|\binvoice\b|\bcharge\b|\bsubscription\b/.test(clean)) {
    return { reply: "We offer a 14-day money-back guarantee. Please submit a billing ticket on your dashboard and our team will process your request within 2 business days.", source: "fallback" };
  }
  if (/\bbug\b|\berror\b|\bcrash\b|\bbroken\b|\bnot working\b|\bissue\b|\bproblem\b/.test(clean)) {
    return { reply: "I'm sorry to hear you're experiencing a technical issue. Could you share the error message or describe what happens? I'll do my best to help, or escalate to our engineering team.", source: "fallback" };
  }
  return { reply: "Thank you for reaching out! Could you describe the issue in a bit more detail so I can assist you better? For urgent concerns, open a support ticket from your dashboard and a human agent will respond within 2 hours.", source: "fallback" };
}

function fallbackSentiment(text) {
  const clean = (text || "").toLowerCase();
  const neg = ["urgent","broken","fail","error","crash","refund","worst","angry","frustrated","bug","terrible","hate","cannot","useless","disappointed"];
  const pos = ["thanks","thank you","great","awesome","perfect","good","happy","love","excellent","solved","helpful","appreciate"];
  let score = 0;
  neg.forEach(kw => { if (clean.includes(kw)) score -= 1; });
  pos.forEach(kw => { if (clean.includes(kw)) score += 1; });
  if (score < 0) return { sentiment: "Negative", score: 20, emoji: "😠", explanation: "Message contains negative indicators.", source: "fallback" };
  if (score > 0) return { sentiment: "Positive", score: 85, emoji: "😊", explanation: "Message contains positive indicators.", source: "fallback" };
  return { sentiment: "Neutral", score: 50, emoji: "😐", explanation: "No strong sentiment detected.", source: "fallback" };
}

function fallbackCategorize(subject = "", description = "") {
  const text = `${subject} ${description}`.toLowerCase();
  if (["invoice","billing","payment","charge","refund","subscription"].some(k => text.includes(k)))
    return { category: "Billing Issue", confidence: 80, reason: "Billing keywords detected.", source: "fallback" };
  if (["login","password","reset","locked","access","account"].some(k => text.includes(k)))
    return { category: "Account Issue", confidence: 80, reason: "Account keywords detected.", source: "fallback" };
  if (["api","bug","error","crash","slow","broken","server"].some(k => text.includes(k)))
    return { category: "Technical Issue", confidence: 80, reason: "Technical keywords detected.", source: "fallback" };
  if (["feature","request","suggest","improve","add"].some(k => text.includes(k)))
    return { category: "Feature Request", confidence: 70, reason: "Feature request keywords detected.", source: "fallback" };
  return { category: "General Inquiry", confidence: 60, reason: "No specific category detected.", source: "fallback" };
}

function fallbackSuggest({ category, sentiment }) {
  const suggestions = [];
  if (sentiment === "Negative") suggestions.push("I sincerely apologize for the inconvenience. Let me look into this immediately.");
  if (category === "Billing Issue") {
    suggestions.push("I've reviewed your billing details and will process the correction right away. Could you confirm the invoice number?");
    suggestions.push("Our billing team will contact you within 1 business day to resolve this matter.");
  } else if (category === "Account Issue") {
    suggestions.push("I've sent a password reset link to your registered email. Please check your inbox and spam folder.");
    suggestions.push("Your account has been unlocked. Please try logging in again and let us know if you face further issues.");
  } else if (category === "Technical Issue") {
    suggestions.push("Could you share your browser version and any error messages you're seeing? This will help us diagnose the issue faster.");
    suggestions.push("Our engineering team has been notified and is actively investigating. We'll update you within 2 hours.");
  } else {
    suggestions.push("Thank you for contacting DeskFlow support. I'm looking into your request and will respond shortly.");
    suggestions.push("Could you provide more details so I can assign this to the right department?");
  }
  return { suggestions, source: "fallback" };
}

module.exports = {
  geminiChat,
  geminiSentiment,
  geminiCategorize,
  geminiSuggestResponses,
  geminiFaqSearch
};
