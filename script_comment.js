// ════════════════════════════════════════════════
// 1. API KEY SETUP
// ════════════════════════════════════════════════

// Try to load a previously saved key from browser storage
// so user doesn't have to paste it again on refresh
let GEMINI_KEY = localStorage.getItem("gemini_key") || "";

// If a saved key exists → pre-fill the input and show "✅ Key saved!"
if (GEMINI_KEY) {
  document.getElementById("api-key-input").value = GEMINI_KEY;
  document.getElementById("key-status").style.display = "block";
}

// When user clicks "Save Key" button
document.getElementById("save-key-btn").addEventListener("click", () => {
  const val = document.getElementById("api-key-input").value.trim(); // remove accidental spaces

  if (!val) {
    alert("Please paste your API key first!"); // don't save empty key
    return;
  }

  GEMINI_KEY = val; // store in memory for current session
  localStorage.setItem("gemini_key", val); // persist in browser for next visit
  document.getElementById("key-status").style.display = "block"; // show ✅
});

// ════════════════════════════════════════════════
// 2. CONVERSATION HISTORY (Multi-turn memory)
// ════════════════════════════════════════════════

// Gemini API needs ALL past messages to understand context
// Format: [{ role: 'user'|'model', parts: [{ text: '...' }] }]
const conversationHistory = [];

// ════════════════════════════════════════════════
// 3. CHIP CLICK HELPER
// ════════════════════════════════════════════════

// Called by onclick="fillTopic(...)" on each chip in HTML
// Just fills the text input and focuses it so user can hit Enter
function fillTopic(topic) {
  document.getElementById("user-input").value = topic;
  document.getElementById("user-input").focus();
}

// ════════════════════════════════════════════════
// 4. DOM ELEMENT REFERENCES
// ════════════════════════════════════════════════

// Grab elements once and reuse — faster than calling getElementById repeatedly
const messagesEl = document.getElementById("messages"); // chat message container
const inputEl = document.getElementById("user-input"); // text input box
const sendBtn = document.getElementById("send-btn"); // ➤ send button
const ageSelect = document.getElementById("age-select"); // level dropdown

// ════════════════════════════════════════════════
// 5. ADD A CHAT BUBBLE
// ════════════════════════════════════════════════

// Creates a new message div and appends it to the chat
// role = "user" → right side 🙋 | role = "bot" → left side 🤖
function addMessage(role, htmlContent) {
  const div = document.createElement("div");
  div.className = `msg ${role}`; // CSS targets .msg.user and .msg.bot

  const avatar = role === "user" ? "🙋" : "🤖";
  div.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="bubble">${htmlContent}</div>
  `;

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight; // auto-scroll to latest message
}

// ════════════════════════════════════════════════
// 6. TYPING INDICATOR (... animation)
// ════════════════════════════════════════════════

// Shows animated dots while waiting for Gemini response
function showTyping() {
  const div = document.createElement("div");
  div.className = "msg bot";
  div.id = "typing-indicator"; // ID used to find and remove it later
  div.innerHTML = `
    <div class="avatar">🤖</div>
    <div class="typing"><span></span><span></span><span></span></div>
  `;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Removes the typing indicator once real response arrives
function removeTyping() {
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

// ════════════════════════════════════════════════
// 7. SECURITY — ESCAPE HTML (XSS Prevention)
// ════════════════════════════════════════════════

// Converts dangerous characters into safe HTML entities
// e.g. <script> becomes &lt;script&gt; — renders as text, not code
// ALWAYS call this on raw user/AI text before injecting into innerHTML
function escHtml(str) {
  return str
    .replace(/&/g, "&amp;") // & → &amp;  (must be first!)
    .replace(/</g, "&lt;") // < → &lt;
    .replace(/>/g, "&gt;") // > → &gt;
    .replace(/"/g, "&quot;"); // " → &quot;
}

// ════════════════════════════════════════════════
// 8. FORMAT AI RESPONSE (Markdown → HTML)
// ════════════════════════════════════════════════

// Gemini returns plain text with markdown-like formatting
// This function converts it to styled HTML safely
function formatResponse(rawText) {
  // STEP 1 — Extract code blocks (```) BEFORE escaping
  // so the code inside isn't accidentally escaped
  const codeBlocks = [];
  let html = rawText.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(code.trim()); // save raw code
    return `%%CODEBLOCK_${idx}%%`; // replace with a safe placeholder
  });

  // STEP 2 — Extract analogy blocks before escaping
  const analogyBlocks = [];
  html = html.replace(
    /🎯\s*Analogy:([\s\S]*?)(?=\n\n|\n[🔹📌💡🎯🧩📖🖼️]|$)/g,
    (_, content) => {
      const idx = analogyBlocks.length;
      analogyBlocks.push(content.trim());
      return `%%ANALOGY_${idx}%%`; // placeholder
    },
  );

  // STEP 3 — Escape all remaining plain text (now safe to do)
  html = escHtml(html);

  // STEP 4 — Apply markdown-like formatting on escaped text
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"); // **bold**
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>"); // *italic*
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>"); // `inline code`
  html = html.replace(/\n/g, "<br>"); // newlines → line breaks

  // STEP 5 — Restore code blocks inside styled diagram boxes
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_, i) => {
    return `<div class="diagram-box">${escHtml(codeBlocks[i])}</div>`;
  });

  // STEP 6 — Restore analogy blocks with special styling
  html = html.replace(/%%ANALOGY_(\d+)%%/g, (_, i) => {
    let inner = escHtml(analogyBlocks[i])
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>");
    return `<div class="analogy-box">🎯 <strong>Analogy:</strong> ${inner}</div>`;
  });

  return html; // final safe HTML string ready to inject
}

// ════════════════════════════════════════════════
// 9. SYSTEM PROMPT BUILDER
// ════════════════════════════════════════════════

// Builds the instruction message sent to Gemini
// Tells it WHO to explain to and in WHAT format to respond
function buildSystemPrompt(topic, level) {
  const levelMap = {
    10: "a 10-year-old child with no technical knowledge",
    15: "a curious 15-year-old teenager",
    college: "a college CS student preparing for exams",
    viva: "a college student preparing for a viva/oral exam who needs crisp definitions + examples",
  };

  // Pick the right audience description based on dropdown value
  const audience = levelMap[level] || levelMap["college"];

  // The full instruction prompt — Gemini will follow this structure exactly
  return `You are ELI10 — an expert teacher who explains complex Computer Science and technical topics in the simplest way possible.

Explain the topic: "${topic}"

Target audience: ${audience}

Your response MUST follow this exact structure:

🧩 **What is ${topic}?**
(1-2 sentence simple definition)

🎯 Analogy:
(A real-world analogy that a kid/student would instantly understand. Make it vivid and relatable.)

📖 **How it works — Step by Step:**
(3-5 simple numbered steps, no jargon)

🖼️ **Simple ASCII Diagram:**
(Draw a clear ASCII art diagram inside a code block using \`\`\`)

💡 **Quick Example:**
(A tiny, concrete code snippet OR real-life example)

🔹 **Remember for Viva:**
(3 bullet points — key facts to say in an exam)

Keep the tone friendly, energetic, and encouraging. Avoid heavy jargon. Use emojis to make it fun.`;
}

// ════════════════════════════════════════════════
// 10. MAIN SEND FUNCTION
// ════════════════════════════════════════════════

async function sendMessage() {
  const topic = inputEl.value.trim();
  if (!topic) return; // don't send empty messages

  // Block sending if no API key is saved
  if (!GEMINI_KEY) {
    alert("⚠️ Please paste and save your Gemini API key first!");
    return;
  }

  const level = ageSelect.value; // get selected level (10, 15, college, viva)

  // Show user's message in the chat UI
  addMessage(
    "user",
    `🔍 <strong>${escHtml(topic)}</strong> <span style="color:#888;font-size:0.8rem">[Level: ${level}]</span>`,
  );

  inputEl.value = ""; // clear input box
  sendBtn.disabled = true; // prevent double-sending while waiting
  showTyping(); // show ... animation

  // Build full prompt and push to history
  // Gemini sees ALL previous turns → gives contextual answers
  const userText = buildSystemPrompt(topic, level);
  conversationHistory.push({ role: "user", parts: [{ text: userText }] });

  try {
    // ── GEMINI API CALL ──
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: conversationHistory, // send FULL history for multi-turn context
          generationConfig: {
            temperature: 0.7, // 0 = robotic, 1 = creative — 0.7 is balanced
            maxOutputTokens: 8192, // max length of AI response
          },
        }),
      },
    );

    const data = await response.json(); // parse the JSON response

    // Handle API-level errors (wrong key, quota exceeded, etc.)
    if (!response.ok) {
      const errMsg =
        data?.error?.message || "API Error. Check your key or quota.";
      removeTyping();
      addMessage("bot", `❌ <strong>Error:</strong> ${escHtml(errMsg)}`);
      conversationHistory.pop(); // remove failed turn so history stays clean
      return;
    }

    // Extract the actual text from deeply nested response object
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      removeTyping();
      addMessage(
        "bot",
        "⚠️ No response received from Gemini. Please try again.",
      );
      conversationHistory.pop();
      return;
    }

    // Save AI reply to history so next question has full context
    conversationHistory.push({ role: "model", parts: [{ text: rawText }] });

    removeTyping();
    addMessage("bot", formatResponse(rawText)); // format and display response
  } catch (err) {
    // Handle network errors (no internet, CORS, etc.)
    removeTyping();
    addMessage(
      "bot",
      `❌ <strong>Network Error:</strong> ${escHtml(err.message)}`,
    );
    conversationHistory.pop(); // clean up failed turn from history
  } finally {
    // Always runs — re-enable send button and refocus input
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// ════════════════════════════════════════════════
// 11. EVENT LISTENERS
// ════════════════════════════════════════════════

// Click ➤ button → send message
sendBtn.addEventListener("click", sendMessage);

// Press Enter key → send message (only if button isn't already loading)
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !sendBtn.disabled) sendMessage();
});
