import express from "express";
import cors from "cors";
import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const audioStore = new Map();
const videoStore = new Map();

const BASE_URL = "https://tts-render-server.onrender.com";

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "TTS Render Server is running"
  });
});

async function generateAudioBuffer(text, voice = "alloy") {
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

  return Buffer.from(response.data);
}

app.post("/tts", async (req, res) => {
  try {
    const { text, voice = "alloy" } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: "Text is required"
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "OPENAI_API_KEY is missing in Render Environment Variables"
      });
    }

    const audioBuffer = await generateAudioBuffer(text, voice);
    const id = crypto.randomUUID();

    audioStore.set(id, {
      buffer: audioBuffer,
      createdAt: Date.now()
    });

    res.json({
      success: true,
      audioUrl: `${BASE_URL}/audio/${id}.mp3`,
      message: "Audio generated successfully."
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

app.post("/make-video", async (req, res) => {
  try {
    const { text, voice = "alloy", imageUrl } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: "Text is required"
      });
    }

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        error: "imageUrl is required"
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "OPENAI_API_KEY is missing in Render Environment Variables"
      });
    }

    const id = crypto.randomUUID();

    const tmpDir = os.tmpdir();
    const imagePath = path.join(tmpDir, `${id}.jpg`);
    const audioPath = path.join(tmpDir, `${id}.mp3`);
    const videoPath = path.join(tmpDir, `${id}.mp4`);

    const imageResponse = await axios.get(imageUrl, {
  responseType: "arraybuffer",
  maxRedirects: 5,
  headers: {
    "User-Agent": "tts-render-server/1.0",
    "Accept": "image/*,*/*;q=0.8"
  }
});

    fs.writeFileSync(imagePath, Buffer.from(imageResponse.data));

    const audioBuffer = await generateAudioBuffer(text, voice);
    fs.writeFileSync(audioPath, audioBuffer);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(imagePath)
        .inputOptions(["-loop 1"])
        .input(audioPath)
        .outputOptions([
          "-c:v libx264",
          "-tune stillimage",
          "-c:a aac",
          "-b:a 192k",
          "-pix_fmt yuv420p",
          "-shortest",
          "-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
        ])
        .save(videoPath)
        .on("end", resolve)
        .on("error", reject);
    });

    const videoBuffer = fs.readFileSync(videoPath);

    videoStore.set(id, {
      buffer: videoBuffer,
      createdAt: Date.now()
    });

    try {
      fs.unlinkSync(imagePath);
      fs.unlinkSync(audioPath);
      fs.unlinkSync(videoPath);
    } catch {}

    res.json({
      success: true,
      videoUrl: `${BASE_URL}/video/${id}.mp4`,
      message: "Video generated successfully with image and background voice-over."
    });
  } catch (error) {
    const status = error.response?.status || 500;
    const details = error.response?.data
      ? Buffer.from(error.response.data).toString("utf8")
      : error.message;

    res.status(status).json({
      success: false,
      error: "Video generation failed",
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

app.get("/video/:id.mp4", (req, res) => {
  const item = videoStore.get(req.params.id);

  if (!item) {
    return res.status(404).json({
      error: "Video file not found or expired. Generate it again."
    });
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", "inline; filename=voiceover-video.mp4");
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

  for (const [id, item] of videoStore.entries()) {
    if (now - item.createdAt > thirtyMinutes) {
      videoStore.delete(id);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`TTS server running on port ${PORT}`);
});
