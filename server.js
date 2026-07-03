import express from "express";
import cors from "cors";
import axios from "axios";
import crypto from "crypto";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const audioStore = new Map();

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "TTS Render Server is running"
  });
});

app.post("/tts", async (req, res) => {
  try {
    const { text, voice = "alloy" } = req.body;

    if (!text) {
      return res.status(400).json({
        error: "Text is required"
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing in Render Environment Variables"
      });
    }

    const response = await axios.post(
      "https://api.openai.com/v1/audio/speech",
      {
        model: "gpt-4o-mini-tts",
        input: text,
        voice: voice,
        response_format: "mp3"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        responseType: "arraybuffer"
      }
    );

    const id = crypto.randomUUID();
    const audioBuffer = Buffer.from(response.data);

    audioStore.set(id, {
      buffer: audioBuffer,
      createdAt: Date.now()
    });

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    res.json({
      success: true,
      audioUrl: `${baseUrl}/audio/${id}.mp3`,
      message: "Audio generated successfully. Open the audioUrl to play or download the MP3."
    });
  } catch (error) {
    const status = error.response?.status || 500;
    const details = error.response?.data
      ? Buffer.from(error.response.data).toString("utf8")
      : error.message;

    res.status(status).json({
      success: false,
      error: "TTS generation failed",
      details
    });
  }
});

app.get("/audio/:id.mp3", (req, res) => {
  const item = audioStore.get(req.params.id);

  if (!item) {
    return res.status(404).json({
      error: "Audio file not found or expired. Generate it again."
    });
  }

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", "inline; filename=speech.mp3");
  res.send(item.buffer);
});

setInterval(() => {
  const now = Date.now();
  const thirtyMinutes = 30 * 60 * 1000;

  for (const [id, item] of audioStore.entries()) {
    if (now - item.createdAt > thirtyMinutes) {
      audioStore.delete(id);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`TTS server running on port ${PORT}`);
});
