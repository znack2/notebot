require("dotenv").config();

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const winston = require("winston");

// ============================================================
// --- ENV VALIDATION ---
// ============================================================

const REQUIRED_ENV_VARS = [
  "TELEGRAM_TOKEN",
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "GITHUB_OWNER",
  "GITHUB_REPO"
];

// Optional but strongly recommended - used for fatal-error notifications
const RECOMMENDED_ENV_VARS = ["TELEGRAM_OWNER_CHAT_ID", "GEMINI_API_KEY"];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter(name => !process.env[name]);

  if (missing.length > 0) {
    // Logger isn't set up yet, so use console here - this is a hard startup failure.
    console.error(
      `❌ Missing required environment variable(s): ${missing.join(", ")}`
    );
    console.error("Server will not start until these are set. Exiting.");
    process.exit(1);
  }

  const missingRecommended = RECOMMENDED_ENV_VARS.filter(
    name => !process.env[name]
  );
  if (missingRecommended.length > 0) {
    console.warn(
      `⚠️  Missing recommended environment variable(s): ${missingRecommended.join(
        ", "
      )}. Some features will be degraded.`
    );
  }
}

validateEnv();

// ENV
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.BRANCH || "main";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TELEGRAM_OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID;

// ============================================================
// --- LOGGING (Winston) ---
// ============================================================

const logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }), // ensure full stack traces are captured
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: "telegram-notes-bot" },
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" })
  ]
});

// Also log to console (human readable) unless in production-quiet mode
logger.add(
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: "HH:mm:ss" }),
      winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        const metaStr = Object.keys(meta).length
          ? ` ${JSON.stringify(meta)}`
          : "";
        return `${timestamp} [${level}] ${stack || message}${metaStr}`;
      })
    )
  })
);

// ============================================================
// --- GLOBAL ERROR HANDLERS ---
// ============================================================

async function notifyOwner(subject, err) {
  if (!TELEGRAM_OWNER_CHAT_ID || !TELEGRAM_TOKEN) {
    logger.warn("Cannot notify owner - TELEGRAM_OWNER_CHAT_ID not set", {
      subject
    });
    return;
  }

  const message =
    `🚨 *${subject}*\n\n` +
    `\`${(err && err.message) || String(err)}\`\n\n` +
    `Time: ${new Date().toISOString()}`;

  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_OWNER_CHAT_ID,
        text: message,
        parse_mode: "Markdown"
      },
      { timeout: 5000 }
    );
  } catch (notifyErr) {
    logger.error("Failed to notify owner via Telegram", {
      error: notifyErr.message,
      stack: notifyErr.stack
    });
  }
}

process.on("uncaughtException", err => {
  logger.error("uncaughtException - fatal error", {
    error: err.message,
    stack: err.stack
  });

  notifyOwner("Fatal Error (uncaughtException)", err).finally(() => {
    // An uncaught exception leaves the process in an undefined state.
    // Exit so a process manager (pm2/systemd/docker) can restart cleanly.
    process.exit(1);
  });
});

process.on("unhandledRejection", (reason, promise) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error("unhandledRejection", {
    error: err.message,
    stack: err.stack
  });

  notifyOwner("Unhandled Promise Rejection", err);
  // Not exiting here - unhandled rejections are recoverable more often than
  // uncaught exceptions, but they are still logged and reported.
});

// ============================================================
// --- APP SETUP ---
// ============================================================

const app = express();
app.use(express.json());

// --- helpers ---

// Path for the individual note file, e.g. notes/2026-07-21T14-32-00-123Z-idea.md
function getNoteFilePath(tag, date = new Date()) {
  const safeIso = date.toISOString().replace(/[:.]/g, "-");
  return `notes/${safeIso}-${tag}.md`;
}

// Short date used in the index one-liner, e.g. 21.07.26
function formatDateShort(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function extractTags(text) {
  if (!text) return [];
  const firstLine = text.split("\n")[0].trim();
  const tags = firstLine.match(/#[^\s#]+/g) || [];
  return tags;
}

function now() {
  return process.hrtime.bigint();
}

function elapsedMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

// --- OpenAI ---

async function processText(text, mode, reqId) {
  const prompt = `
Structure this ${mode} note:

${text}

Return JSON:
title, summary, key_points (list), tags (list), remind_time (string), previous_believe (string), new_point_of_view (string)
`;

  const start = now();
  logger.info("OpenAI request starting", { reqId, mode });

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

    const durationMs = elapsedMs(start);
    logger.info("OpenAI response received", {
      reqId,
      mode,
      durationMs,
      status: res.status,
      usage: res.data.usage,
      finishReason: res.data.choices?.[0]?.finish_reason
    });
    logger.debug("OpenAI raw response body", { reqId, data: res.data });

    const content = res.data.choices[0].message.content;

    try {
      return JSON.parse(content);
    } catch (parseErr) {
      logger.warn("OpenAI response was not valid JSON, falling back to raw content", {
        reqId,
        error: parseErr.message,
        content
      });
      return {
        title: mode,
        summary: content,
        key_points: [],
        tags: [`#${mode}`]
      };
    }
  } catch (err) {
    const durationMs = elapsedMs(start);
    logger.error("OpenAI request failed", {
      reqId,
      mode,
      durationMs,
      error: err.message,
      stack: err.stack,
      status: err.response?.status,
      responseData: err.response?.data
    });

    return {
      title: mode,
      summary: text,
      key_points: [],
      tags: [`#${mode}`, "#raw"]
    };
  }
}

// --- Gemini ---

async function makeShortSummary(text, reqId) {
  if (!GEMINI_API_KEY) {
    logger.warn("GEMINI_API_KEY is not set - skipping short summary", { reqId });
    return text;
  }

  const prompt = `Make a short summary of this note:\n\n${text}`;
  const start = now();
  logger.info("Gemini request starting", { reqId });

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }]
      },
      {
        headers: { "Content-Type": "application/json" }
      }
    );

    const durationMs = elapsedMs(start);
    logger.info("Gemini response received", {
      reqId,
      durationMs,
      status: res.status
    });
    logger.debug("Gemini raw response body", { reqId, data: res.data });

    return res.data.candidates[0].content.parts[0].text;
  } catch (err) {
    const durationMs = elapsedMs(start);
    logger.error("Gemini request failed", {
      reqId,
      durationMs,
      error: err.message,
      stack: err.stack,
      status: err.response?.status,
      responseData: err.response?.data
    });
    return text;
  }
}

// --- GitHub ---

async function getFile(path, reqId) {
  const start = now();
  logger.info("GitHub getFile starting", { reqId, path });

  try {
    const res = await axios.get(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
      {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
        params: { ref: BRANCH }
      }
    );

    const durationMs = elapsedMs(start);
    logger.info("GitHub getFile succeeded", {
      reqId,
      path,
      durationMs,
      status: res.status,
      sha: res.data.sha
    });
    logger.debug("GitHub getFile raw response", { reqId, path, data: res.data });

    return {
      content: Buffer.from(res.data.content, "base64").toString("utf-8"),
      sha: res.data.sha
    };
  } catch (err) {
    const durationMs = elapsedMs(start);

    if (err.response?.status === 404) {
      logger.info("GitHub getFile - file does not exist yet, will create new", {
        reqId,
        path,
        durationMs
      });
      return { content: "", sha: null };
    }

    logger.error("GitHub getFile failed", {
      reqId,
      path,
      durationMs,
      error: err.message,
      stack: err.stack,
      status: err.response?.status,
      responseData: err.response?.data
    });
    throw err;
  }
}

async function saveFile(path, content, reqId) {
  const existing = await getFile(path, reqId);
  const newContent = existing.content + content;

  const start = now();
  logger.info("GitHub saveFile (PUT) starting", {
    reqId,
    path,
    hasExistingSha: !!existing.sha
  });

  try {
    const res = await axios.put(
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

    const durationMs = elapsedMs(start);
    logger.info("GitHub saveFile succeeded", {
      reqId,
      path,
      durationMs,
      status: res.status,
      commitSha: res.data.commit?.sha
    });
    logger.debug("GitHub saveFile raw response", { reqId, path, data: res.data });

    return res.data;
  } catch (err) {
    const durationMs = elapsedMs(start);
    logger.error("GitHub saveFile failed", {
      reqId,
      path,
      durationMs,
      error: err.message,
      stack: err.stack,
      status: err.response?.status,
      responseData: err.response?.data
    });
    throw err;
  }
}

// --- markdown ---

// Content for the standalone note file: just the raw note text, no labels.
function buildNoteContent(rawText) {
  return `${rawText}\n\n***\n`;
}

// Content appended to index.md: a single line "DD.MM.YY: summary", no labels.
function buildIndexEntry(dateShort, summary) {
  const oneLine = (summary || "").replace(/\s+/g, " ").trim();
  return `${dateShort}: ${oneLine}\n\n***\n`;
}

// --- Telegram helpers ---

async function sendMessage(chatId, text, extra = {}, reqId = "n/a") {
  const start = now();
  logger.info("Telegram sendMessage starting", { reqId, chatId });

  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text,
        ...extra
      }
    );

    const durationMs = elapsedMs(start);
    logger.info("Telegram sendMessage succeeded", {
      reqId,
      chatId,
      durationMs,
      status: res.status
    });

    return res.data;
  } catch (err) {
    const durationMs = elapsedMs(start);
    logger.error("Telegram sendMessage failed", {
      reqId,
      chatId,
      durationMs,
      error: err.message,
      stack: err.stack,
      status: err.response?.status,
      responseData: err.response?.data
    });
    // Swallow - failing to notify the user shouldn't crash the webhook handler.
  }
}

// ============================================================
// --- REQUEST ID MIDDLEWARE ---
// ============================================================

app.use((req, res, next) => {
  req.reqId = crypto.randomUUID();
  req.startTime = now();
  next();
});

// --- webhook ---

app.post("/webhook", async (req, res) => {
  const { reqId } = req;
  const body = req.body;

  logger.info("Incoming Telegram update", { reqId, update: body });

  // --- BUTTON CLICK ---
  if (body.callback_query) {
    const query = body.callback_query;
    const tag = query.data;
    const chatId = query.message.chat.id;

    const text = query.message.reply_to_message?.text || "empty";

    logger.info("Processing callback_query", { reqId, tag, chatId });

    try {
      const stepStart = now();

      const ai = await processText(text, tag, reqId);
      const noteDate = new Date();

      const noteFile = getNoteFilePath(tag, noteDate);
      const noteContent = buildNoteContent(text);

      const indexEntry = buildIndexEntry(formatDateShort(noteDate), ai.summary);

      await saveFile(noteFile, noteContent, reqId);
      await saveFile("index.md", indexEntry, reqId);

      logger.info("Note saved successfully", {
        reqId,
        noteFile,
        indexFile: "index.md",
        totalDurationMs: elapsedMs(stepStart)
      });

      await sendMessage(chatId, `✅ Saved: ${noteFile}`, {}, reqId);
    } catch (err) {
      logger.error("Error handling callback_query", {
        reqId,
        error: err.message,
        stack: err.stack,
        status: err.response?.status,
        responseData: err.response?.data
      });

      const userMessage = err.response?.status
        ? `❌ Error saving note (upstream API returned ${err.response.status}). Reference ID: ${reqId}`
        : `❌ Error saving note: ${err.message}. Reference ID: ${reqId}`;

      await sendMessage(chatId, userMessage, {}, reqId);
    }

    const totalMs = elapsedMs(req.startTime);
    logger.info("Webhook request completed (callback_query)", {
      reqId,
      totalDurationMs: totalMs
    });

    return res.sendStatus(200);
  }

  // --- TEXT MESSAGE ---
  const text = body.message?.text;
  if (!text) {
    logger.info("Webhook received update with no text - ignoring", { reqId });
    return res.sendStatus(200);
  }

  const chatId = body.message.chat.id;

  if (text === "/template") {
    const templateText = `Remind time: \nTags: \nPrevious believe: \nNew point of view: \n\n<Your note here>`;
    await sendMessage(chatId, templateText, {}, reqId);

    logger.info("Webhook request completed (/template)", {
      reqId,
      totalDurationMs: elapsedMs(req.startTime)
    });
    return res.sendStatus(200);
  }

  // отправляем кнопки
  await sendMessage(
    chatId,
    "Choose category:",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Initial thoughts", callback_data: "initial_thoughts" }],
          [{ text: "Just idea", callback_data: "just_idea" }],
          [{ text: "Second reflection", callback_data: "second_reflection" }],
          [{ text: "From lesson", callback_data: "from_lesson" }],
          [{ text: "Another person wisdom", callback_data: "another_person_wisdom" }]
        ]
      },
      reply_to_message_id: body.message.message_id
    },
    reqId
  );

  logger.info("Webhook request completed (category prompt)", {
    reqId,
    totalDurationMs: elapsedMs(req.startTime)
  });

  res.sendStatus(200);
});

// --- Express-level error handler (catches sync errors thrown in route handlers) ---
app.use((err, req, res, next) => {
  const reqId = req.reqId || "unknown";
  logger.error("Unhandled Express error", {
    reqId,
    error: err.message,
    stack: err.stack
  });

  notifyOwner("Express route error", err);

  if (!res.headersSent) {
    res.status(500).json({ error: "Internal Server Error", reqId });
  }
});

// --- start ---

app.listen(3000, () => {
  logger.info("Server running on 3000");
});

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});