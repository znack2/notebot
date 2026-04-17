require("dotenv").config();

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const simpleGit = require("simple-git");

const app = express();
app.use(express.json());

// ENV
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REPO_PATH = process.env.REPO_PATH;
const BRANCH = process.env.BRANCH || "main";

const git = simpleGit(REPO_PATH);

// пути
const TEMPLATES_PATH = path.join(__dirname, "templates");

// sanity check
if (!fs.existsSync(REPO_PATH)) {
  console.error("REPO_PATH does not exist:", REPO_PATH);
  process.exit(1);
}

// --- helpers ---

function getDateFile() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(REPO_PATH, `${date}.md`);
}

function parseMode(text) {
  if (text.startsWith("/idea")) return { mode: "idea", clean: text.replace("/idea", "").trim() };
  if (text.startsWith("/meeting")) return { mode: "meeting", clean: text.replace("/meeting", "").trim() };
  return { mode: "note", clean: text };
}

// --- AI ---
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
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`
        }
      }
    );

    const content = res.data.choices[0].message.content;

    try {
      return JSON.parse(content);
    } catch {
      // fallback если не JSON
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

// --- Template ---
function renderTemplate(templateName, data) {
  const templateFile = path.join(TEMPLATES_PATH, `${templateName}.md`);

  let template;

  if (fs.existsSync(templateFile)) {
    template = fs.readFileSync(templateFile, "utf-8");
  } else {
    // fallback template
    template = `
# {{title}}

{{summary}}

{{points}}

{{raw}}

{{tags}}
{{date}}
`;
  }

  const points = (data.key_points || [])
    .map(p => `- ${p}`)
    .join("\n");

  return template
    .replace("{{title}}", data.title || "")
    .replace("{{summary}}", data.summary || "")
    .replace("{{points}}", points)
    .replace("{{raw}}", data.raw || "")
    .replace("{{tags}}", (data.tags || []).join(" "))
    .replace("{{date}}", data.date || "");
}

// --- Save ---
async function saveNote(content) {
  const file = getDateFile();

  try {
    fs.appendFileSync(file, `\n\n---\n\n${content}`);
  } catch (err) {
    console.error("File write error:", err.message);
    return;
  }

  try {
    await git.pull("origin", BRANCH);
    await git.add(".");
    await git.commit(`update ${new Date().toISOString().slice(0, 10)}`);
    await git.push("origin", BRANCH);

    console.log("Git push success");
  } catch (err) {
    console.error("Git error:", err.message);
  }
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

  const templateName = mode === "meeting" ? "meeting" : "idea";
  const md = renderTemplate(templateName, data);

  await saveNote(md);

  res.sendStatus(200);
});

// start
app.listen(3000, () => {
  console.log("Server running on 3000");
});