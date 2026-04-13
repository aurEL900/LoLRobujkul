import { GoogleGenAI } from "@google/genai";
import fs from "fs";

const creds = JSON.parse(fs.readFileSync('bot_credentials.json', 'utf-8'));
const ai = new GoogleGenAI({ apiKey: creds.GEMINI_API_KEY });

async function test() {
  try {
    const matchStats = "Recent games: Nilah (Win, 5/9/10) | Renata (Win, 6/5/30) | Karma (Loss, 0/8/9)";
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: `Analyze this League of Legends player's last 3 matches: "${matchStats}". Write a short, funny, and slightly sassy 2-sentence reaction to their performance (e.g. roasting them for feeding or hyping them up for carrying). Keep it under 400 characters. Twitch TOS safe. No markdown.`,
    });
    console.log("SUCCESS:", response.text);
  } catch (e: any) {
    console.error("ERROR:", e.message);
  }
}

test();
