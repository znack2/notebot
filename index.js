require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ENV
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.BRANCH || "main";

// --- helpers ---

function getDateFile() {
  return new Date().toISOString().slice(0, 10) + ".md";
}

// --- OpenAI ---

async function processText(text, mode) {
  const prompt = `
Structure this ${mode} note:

${text}

Return JSON:
title, summary, key_points (list), tags (list)
`;

  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }]
      },
      {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }
      }
    );

    const content = res.data.choices[0].message.content;

    try {
      return JSON.parse(content);
    } catch {
      return {
        title: mode,
        summary: content,
        key_points: [],
        tags: [`#${mode}`]
      };
    }

  } catch (err) {
    return {
      title: mode,
      summary: text,
      key_points: [],
      tags: [`#${mode}`, "#raw"]
    };
  }
}

// --- GitHub ---

async function getFile(path) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
      {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
        params: { ref: BRANCH }
      }
    );

    return {
      content: Buffer.from(res.data.content, "base64").toString("utf-8"),
      sha: res.data.sha
    };

  } catch (err) {
    if (err.response?.status === 404) {
      return { content: "", sha: null };
    }
    throw err;
  }
}

async function saveFile(path, content) {
  const existing = await getFile(path);

  const newContent = existing.content + content;

  await axios.put(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
    {
      message: `update ${new Date().toISOString()}`,
      content: Buffer.from(newContent).toString("base64"),
      sha: existing.sha || undefined,
      branch: BRANCH
    },
    {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` }
    }
  );
}

// --- markdown ---

function buildMarkdown(data) {
  const points = (data.key_points || [])
    .map(p => `- ${p}`)
    .join("\n");

  return `

---

# ${data.title}

## Summary
${data.summary}

## Points
${points}

## Raw
${data.raw}

${(data.tags || []).join(" ")}

${data.date}
`;
}

// --- Telegram helpers ---

async function sendMessage(chatId, text, extra = {}) {
  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      chat_id: chatId,
      text,
      ...extra
    }
  );
}

// --- webhook ---

app.post("/webhook", async (req, res) => {
  const body = req.body;

  // --- BUTTON CLICK ---
  if (body.callback_query) {
    const query = body.callback_query;
    const tag = query.data;
    const chatId = query.message.chat.id;

    const text =
      query.message.reply_to_message?.text || "empty";

    try {
      const ai = await processText(text, tag);

      const data = {
        title: ai.title || tag,
        summary: ai.summary,
        key_points: ai.key_points || [],
        raw: text,
        tags: ai.tags || [`#${tag}`],
        date: new Date().toISOString()
      };

      const md = buildMarkdown(data);
      const file = getDateFile();

      await saveFile(file, md);

      await sendMessage(chatId, `✅ Saved: ${data.title}`);

    } catch (err) {
      await sendMessage(chatId, "❌ Error saving");
    }

    return res.sendStatus(200);
  }

  // --- TEXT MESSAGE ---
  const text = body.message?.text;
  if (!text) return res.sendStatus(200);

  const chatId = body.message.chat.id;

  // отправляем кнопки
  await sendMessage(chatId, "Choose category:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Idea", callback_data: "idea" }],
        [{ text: "Meeting", callback_data: "meeting" }],
        [{ text: "Note", callback_data: "note" }]
      ]
    },
    reply_to_message_id: body.message.message_id
  });

  res.sendStatus(200);
});

// --- start ---

app.listen(3000, () => {
  console.log("Server running on 3000");
});