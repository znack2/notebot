require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.BRANCH || "main";

// --- helpers ---

function getDateFile() {
  const date = new Date().toISOString().slice(0, 10);
  return `${date}.md`;
}

function parseMode(text) {
  if (text.startsWith("/idea")) return { mode: "idea", clean: text.replace("/idea", "").trim() };
  if (text.startsWith("/meeting")) return { mode: "meeting", clean: text.replace("/meeting", "").trim() };
  return { mode: "note", clean: text };
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
    console.error("OpenAI error:", err.response?.data || err.message);

    return {
      title: mode,
      summary: text,
      key_points: [],
      tags: [`#${mode}`, "#raw"]
    };
  }
}

// --- GitHub API helpers ---

async function getFile(path) {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`
        },
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
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`
      }
    }
  );
}

// --- format markdown ---

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

// --- webhook ---

app.post("/webhook", async (req, res) => {
  const text = req.body.message?.text;
  if (!text) return res.sendStatus(200);

  console.log("Incoming:", text);

  const { mode, clean } = parseMode(text);

  const ai = await processText(clean, mode);

  const data = {
    title: ai.title || mode,
    summary: ai.summary,
    key_points: ai.key_points || [],
    raw: clean,
    tags: ai.tags || [`#${mode}`],
    date: new Date().toISOString()
  };

  const md = buildMarkdown(data);
  const file = getDateFile();

  try {
    await saveFile(file, md);
    console.log("Saved to GitHub:", file);
  } catch (err) {
    console.error("GitHub error:", err.response?.data || err.message);
  }

  res.sendStatus(200);
});

// start
app.listen(3000, () => {
  console.log("Server running on 3000");
});