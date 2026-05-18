require('dotenv').config();
const axios = require('axios');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function makeShortSummary(text) {
  if (!GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY is not set.");
    return text;
  }

  const prompt = `Make a short summary of this note:\n\n${text}`;

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

    return res.data.candidates[0].content.parts[0].text;
  } catch (err) {
    console.error("Gemini API Error:", err?.response?.data || err.message);
    return text;
  }
}

async function runTest() {
  console.log("Testing Gemini API...");
  if (!GEMINI_API_KEY) {
    console.log("❌ Please add GEMINI_API_KEY to your .env file first.");
    return;
  }
  
  const sampleNote = "A neutron star is the collapsed core of a massive supergiant star, which had a total mass of between 10 and 25 solar masses, possibly more if the star was especially metal-rich. Neutron stars are the smallest and densest currently known class of stellar objects.";
  
  console.log("\nOriginal Note:");
  console.log(sampleNote);
  
  console.log("\nGenerating summary...");
  const summary = await makeShortSummary(sampleNote);
  
  console.log("\n✅ Generated Summary:");
  console.log(summary);
}

runTest();
