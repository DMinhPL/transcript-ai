const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const express = require("express");
const multer = require("multer");
const ffmpegPath = require("ffmpeg-static");

const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, "uploads");
const TRANSCRIPT_DIR = path.join(ROOT, "transcripts");
const WHISPER_EXE = path.join(ROOT, "bin", "whisper", "whisper-cli.exe");
const MODELS_DIR = path.join(ROOT, "models");

for (const dir of [UPLOAD_DIR, TRANSCRIPT_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function defaultModelPath() {
  if (!fs.existsSync(MODELS_DIR)) return null;
  const preferred = ["ggml-base.en.bin", "ggml-small.en.bin", "ggml-small.bin", "ggml-base.bin"];
  for (const name of preferred) {
    const p = path.join(MODELS_DIR, name);
    if (fs.existsSync(p)) return p;
  }
  const any = fs.readdirSync(MODELS_DIR).find((f) => f.endsWith(".bin"));
  return any ? path.join(MODELS_DIR, any) : null;
}

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
});

const app = express();
app.use(express.static(path.join(ROOT, "public")));

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} exited with code ${code}\n${stderr}`));
    });
  });
}

async function convertToWav(inputPath, wavPath) {
  await run(ffmpegPath, [
    "-y",
    "-i", inputPath,
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    wavPath,
  ]);
}

async function transcribe(wavPath, outBase, { language, modelPath }) {
  const args = [
    "-m", modelPath,
    "-f", wavPath,
    "-of", outBase,
    "-oj", "-osrt", "-ovtt", "-otxt",
    "-l", language || "auto",
    "-pp",
  ];
  await run(WHISPER_EXE, args);
}

app.post("/api/transcribe", upload.single("media"), async (req, res) => {
  const jobId = crypto.randomUUID();
  const uploadedPath = req.file?.path;
  const originalName = req.file?.originalname || "recording";
  const language = (req.body.language || "auto").trim();

  if (!uploadedPath) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const modelPath = defaultModelPath();
  if (!modelPath) {
    return res.status(500).json({
      error: "No Whisper model found. Run `npm run setup` first to download one.",
    });
  }
  if (!fs.existsSync(WHISPER_EXE)) {
    return res.status(500).json({
      error: "whisper-cli.exe not found. Run `npm run setup` first.",
    });
  }

  const jobDir = path.join(TRANSCRIPT_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  const wavPath = path.join(jobDir, "audio.wav");
  const outBase = path.join(jobDir, "transcript");

  try {
    await convertToWav(uploadedPath, wavPath);
    await transcribe(wavPath, outBase, { language, modelPath });

    const jsonRaw = fs.readFileSync(outBase + ".json", "utf-8");
    const parsed = JSON.parse(jsonRaw);
    const segments = (parsed.transcription || []).map((seg) => ({
      start: seg.offsets.from / 1000,
      end: seg.offsets.to / 1000,
      startLabel: seg.timestamps.from.replace(",", "."),
      endLabel: seg.timestamps.to.replace(",", "."),
      text: seg.text.trim(),
    }));

    res.json({
      jobId,
      originalName,
      language: parsed.result?.language || language,
      segments,
      fullText: segments.map((s) => s.text).join(" "),
      downloads: {
        txt: `/api/download/${jobId}/txt`,
        srt: `/api/download/${jobId}/srt`,
        vtt: `/api/download/${jobId}/vtt`,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    fs.rm(uploadedPath, { force: true }, () => {});
    fs.rm(wavPath, { force: true }, () => {});
  }
});

const EXT_MAP = { txt: "txt", srt: "srt", vtt: "vtt" };

app.get("/api/download/:jobId/:format", (req, res) => {
  const { jobId, format } = req.params;
  if (!/^[a-f0-9-]+$/i.test(jobId) || !EXT_MAP[format]) {
    return res.status(400).send("Invalid request.");
  }
  const filePath = path.join(TRANSCRIPT_DIR, jobId, `transcript.${EXT_MAP[format]}`);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found.");
  res.download(filePath, `transcript.${EXT_MAP[format]}`);
});

app.get("/api/health", (req, res) => {
  res.json({
    whisperBinary: fs.existsSync(WHISPER_EXE),
    model: defaultModelPath(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Transcript AI running at http://localhost:${PORT}`);
});
