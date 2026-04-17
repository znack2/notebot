require("dotenv").config();

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const simpleGit = require("simple-git");

const app = express();
app.use(express.json());

// ENV
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REPO_PATH = process.env.REPO_PATH;
const BRANCH = process.env.BRANCH || "main";

// git init
const git = simpleGit(REPO_PATH);

// файл для записи
const FILE_PATH = path.join(REPO_PATH, "inbox.md");

// sanity check
if (!fs.existsSync(REPO_PATH)) {
  console.error("REPO_PATH does not exist:", REPO_PATH);
  process.exit(1);
}

// webhook
app.post("/webhook", async (req, res) => {
  const message = req.body.message?.text;

  if (!message) {
    return res.sendStatus(200);
  }

  console.log("Incoming message:", message);

  let summary;

  // --- OpenAI ---
  try {
    const ai = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "Summarize in 1-2 sentences" },
          { role: "user", content: message }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`
        }
      }
    );

    summary = ai.data.choices[0].message.content.trim();

  } catch (err) {
    console.error("OpenAI error:", err.response?.data || err.message);

    // fallback
    summary = `[RAW]\n${message}`;
  }

  // --- запись в файл ---
  const entry = `\n## ${new Date().toISOString()}\n${summary}\n`;

  try {
    fs.appendFileSync(FILE_PATH, entry);
    console.log("Written to file");
  } catch (err) {
    console.error("File write error:", err.message);
  }

  // --- git push ---
  try {
    await git.pull("origin", BRANCH);
    await git.add(FILE_PATH);
    await git.commit(`update: ${new Date().toISOString()}`);
    await git.push("origin", BRANCH);

    console.log("Git push success");
  } catch (err) {
    console.error("Git error:", err.message);
  }

  res.sendStatus(200);
});

// start server
app.listen(3000, () => {
  console.log("Server running on port 3000");
});