import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

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

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", "inline; filename=speech.mp3");
    res.send(Buffer.from(response.data));
  } catch (error) {
    const status = error.response?.status || 500;
    const details = error.response?.data
      ? Buffer.from(error.response.data).toString("utf8")
      : error.message;

    res.status(status).json({
      error: "TTS generation failed",
      details
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`TTS server running on port ${PORT}`);
});
