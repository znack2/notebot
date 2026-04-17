require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const simpleGit = require("simple-git");

const app = express();
app.use(express.json());
                                       
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REPO_PATH = process.env.REPO_PATH;
const BRANCH = process.env.BRANCH || "main";


const git = simpleGit(REPO_PATH);

// файл в Obsidian
const FILE_PATH = path.join(REPO_PATH, "inbox.md");

app.post("/webhook", async (req, res) => {
  const message = req.body.message?.text;
  if (!message) return res.sendStatus(200);

  try {
    // 1. summarize через OpenAI
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

    const summary = ai.data.choices[0].message.content.trim();

    // 2. записать в markdown
    const entry = `\n## ${new Date().toISOString()}\n${summary}\n`;
    fs.appendFileSync(FILE_PATH, entry);

    // 3. git commit + push
    await git.pull("origin", BRANCH);
    await git.add(FILE_PATH);
    await git.commit(`update: ${new Date().toISOString()}`);
    await git.push("origin", BRANCH);

  } catch (err) {
    console.error(err.response?.data || err.message);
  }

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("Server running on 3000");
});