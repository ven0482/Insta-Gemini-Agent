import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Initialize Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// API Routes
app.post("/api/discover-trends", async (req, res) => {
  const { profiles } = req.body;
  if (!profiles || !Array.isArray(profiles)) {
    return res.status(400).json({ error: "Profiles are required" });
  }

  try {
    const { profiles, myHandle } = req.body;
    const profileList = profiles.join(", ");
    
    let prompt = `Search for viral trends and popular content styles related to these Instagram profiles: ${profileList}. 
    Analyze what's working for them right now (hooks, topics, visual styles).`;

    if (myHandle) {
      prompt += ` My own Instagram account is ${myHandle}. Tailor the results so they match my brand's voice while leveraging these viral trends.`;
    }

    prompt += ` Then, generate 3 highly viral post ideas. Each post should include a topic, a catchy caption, a descriptive image generation prompt, and a list of 10-15 trending/relevant hashtags for maximum reach.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              topic: { type: Type.STRING },
              caption: { type: Type.STRING },
              imagePrompt: { type: Type.STRING },
              strategy: { type: Type.STRING, description: "Why this will go viral" },
              hashtags: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING }
              }
            },
            required: ["topic", "caption", "imagePrompt", "strategy", "hashtags"]
          }
        }
      }
    });

    res.json(JSON.parse(response.text));
  } catch (error: any) {
    console.error("Discovery error:", error);
    if (error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED")) {
      res.status(429).json({ error: "AI Quota Exceeded. Please wait a few minutes before trying again." });
    } else {
      res.status(500).json({ error: "Agent encountered an error during synthesis. Please try again." });
    }
  }
});

// Mock Instagram Posting API
app.post("/api/instagram/post", async (req, res) => {
  const { caption, imageUrl } = req.body;
  // In a real app, this would use Instagram Graph API
  console.log("Posting to Instagram:", { caption, imageUrl });
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  res.json({ success: true, postId: "ig_" + Math.random().toString(36).substr(2, 9) });
});

// Vite Middleware for Dev
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

setupVite();
