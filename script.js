// ── API KEY: load from localStorage on startup ──
let GEMINI_KEY = localStorage.getItem("gemini_key") || "";
if (GEMINI_KEY) {
  document.getElementById("api-key-input").value = GEMINI_KEY;
  document.getElementById("key-status").style.display = "block";
}

document.getElementById("save-key-btn").addEventListener("click", () => {
  const val = document.getElementById("api-key-input").value.trim();
  if (!val) {
    alert("Please paste your API key first!");
    return;
  }
  GEMINI_KEY = val;
  localStorage.setItem("gemini_key", val); // FIX: persist key
  document.getElementById("key-status").style.display = "block";
});

// ── Conversation history for multi-turn chat ──
// Each entry: { role: 'user'|'model', parts: [{text}] }
const conversationHistory = [];

function fillTopic(topic) {
  document.getElementById("user-input").value = topic;
  document.getElementById("user-input").focus();
}

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const ageSelect = document.getElementById("age-select");

function addMessage(role, htmlContent) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const avatar = role === "user" ? "🙋" : "🤖";
  div.innerHTML = `
        <div class="avatar">${avatar}</div>
        <div class="bubble">${htmlContent}</div>
      `;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTyping() {
  const div = document.createElement("div");
  div.className = "msg bot";
  div.id = "typing-indicator";
  div.innerHTML = `
        <div class="avatar">🤖</div>
        <div class="typing"><span></span><span></span><span></span></div>
      `;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

// FIX: escHtml must run FIRST on raw text, before any HTML injection
function escHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// FIX: formatting pipeline — escape raw text first, then apply markup
function formatResponse(rawText) {
  // Step 1 — split out code blocks before escaping (preserve them separately)
  const codeBlocks = [];
  let html = rawText.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(code.trim());
    return `%%CODEBLOCK_${idx}%%`; // placeholder
  });

  // Step 2 — split out analogy blocks before escaping
  const analogyBlocks = [];
  html = html.replace(
    /🎯\s*Analogy:([\s\S]*?)(?=\n\n|\n[🔹📌💡🎯🧩📖🖼️]|$)/g,
    (_, content) => {
      const idx = analogyBlocks.length;
      analogyBlocks.push(content.trim());
      return `%%ANALOGY_${idx}%%`; // placeholder
    },
  );

  // Step 3 — escape the remaining plain text
  html = escHtml(html);

  // Step 4 — apply markdown-like inline formatting (on escaped text)
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\n/g, "<br>");

  // Step 5 — restore code blocks as diagram boxes
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_, i) => {
    return `<div class="diagram-box">${escHtml(codeBlocks[i])}</div>`;
  });

  // Step 6 — restore analogy blocks
  html = html.replace(/%%ANALOGY_(\d+)%%/g, (_, i) => {
    // Apply inline formatting inside analogy too
    let inner = escHtml(analogyBlocks[i])
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>");
    return `<div class="analogy-box">🎯 <strong>Analogy:</strong> ${inner}</div>`;
  });

  return html;
}

function buildSystemPrompt(topic, level) {
  const levelMap = {
    10: "a 10-year-old child with no technical knowledge",
    15: "a curious 15-year-old teenager",
    college: "a college CS student preparing for exams",
    viva: "a college student preparing for a viva/oral exam who needs crisp definitions + examples",
  };
  const audience = levelMap[level] || levelMap["college"];

  return `You name is Simpli AI — an expert teacher who explains complex Computer Science and technical topics in the simplest way possible.

Explain the topic: "${topic}"

Target audience: ${audience}

Your response MUST follow this exact structure:

🧩 **What is ${topic}?**
(1-2 sentence simple definition)

🎯 Analogy:
(A real-world analogy that a kid/student would instantly understand. Make it vivid and relatable to their real life.)

📖 **How it works (if necessary else skip) — Step by Step:**
(3-5 simple numbered steps, no jargon)

🖼️ **Simple ASCII Diagram:**
(Draw a clear ASCII art diagram inside a code block using \`\`\`)

💡 **Quick Example:**
(A tiny, concrete code snippet OR real-life example)

🔹 **Remember for Viva:**
(3 bullet points — key facts to say in an exam)

Keep the tone friendly, energetic, and encouraging. Avoid heavy jargon. 
Use emojis to make it fun.`;
}

async function sendMessage() {
  const topic = inputEl.value.trim();
  if (!topic) return;
  if (!GEMINI_KEY) {
    alert("⚠️ Please paste and save your Gemini API key first!");
    return;
  }

  const level = ageSelect.value;

  // Show user message in UI
  addMessage(
    "user",
    `🔍 <strong>${escHtml(topic)}</strong> <span style="color:#888;font-size:0.8rem">[Level: ${level}]</span>`,
  );
  inputEl.value = "";
  sendBtn.disabled = true;
  showTyping();

  // FIX: Build the user turn text and push to history
  const userText = buildSystemPrompt(topic, level);
  conversationHistory.push({ role: "user", parts: [{ text: userText }] });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: conversationHistory, // FIX: send full history
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
          },
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      const errMsg =
        data?.error?.message || "API Error. Check your key or quota.";
      removeTyping();
      addMessage("bot", `❌ <strong>Error:</strong> ${escHtml(errMsg)}`);
      // Remove the failed user turn from history so it doesn't corrupt future calls
      conversationHistory.pop();
      return;
    }

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

    // FIX: push model reply into history for multi-turn context
    conversationHistory.push({ role: "model", parts: [{ text: rawText }] });

    removeTyping();
    addMessage("bot", formatResponse(rawText));
  } catch (err) {
    removeTyping();
    addMessage(
      "bot",
      `❌ <strong>Network Error:</strong> ${escHtml(err.message)}`,
    );
    conversationHistory.pop(); // clean up failed turn
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !sendBtn.disabled) sendMessage();
});
