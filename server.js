const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const express = require("express");
const multer = require("multer");
const ffmpegPath = require("ffmpeg-static");
const sherpa_onnx = require("sherpa-onnx-node");

const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, "uploads");
const TRANSCRIPT_DIR = path.join(ROOT, "transcripts");
const WHISPER_EXE = path.join(ROOT, "bin", "whisper", "whisper-cli.exe");
const MODELS_DIR = path.join(ROOT, "models");
const DIARIZATION_DIR = path.join(MODELS_DIR, "diarization");
const SEGMENTATION_MODEL_PATH = path.join(DIARIZATION_DIR, "sherpa-onnx-pyannote-segmentation-3-0", "model.onnx");
const EMBEDDING_MODEL_PATH = path.join(DIARIZATION_DIR, "3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx");

for (const dir of [UPLOAD_DIR, TRANSCRIPT_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// ".en" models (base.en, small.en, ...) are English-only — they cannot
// transcribe or auto-detect any other language, so they must never be
// selected unless the request is explicitly for English.
function pickModelPath(language) {
  if (!fs.existsSync(MODELS_DIR)) return null;
  const available = fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith(".bin"));
  if (!available.length) return null;

  const isEnglishOnly = (name) => name.includes(".en.bin");
  const preferredEnglish = ["ggml-base.en.bin", "ggml-small.en.bin", "ggml-medium.en.bin", "ggml-tiny.en.bin"];
  const preferredMultilingual = ["ggml-small.bin", "ggml-medium.bin", "ggml-base.bin", "ggml-large-v3.bin", "ggml-tiny.bin"];

  const findFirst = (names) => names.find((n) => available.includes(n));

  if (language === "en") {
    const match = findFirst(preferredEnglish) || findFirst(preferredMultilingual);
    if (match) return path.join(MODELS_DIR, match);
  } else {
    const match = findFirst(preferredMultilingual);
    if (match) return path.join(MODELS_DIR, match);
    // No multilingual model installed — fall back to whatever exists so the
    // request doesn't hard-fail, even though English-only models will
    // mistranscribe non-English audio.
  }

  const anyMultilingual = available.find((f) => !isEnglishOnly(f));
  if (anyMultilingual) return path.join(MODELS_DIR, anyMultilingual);
  return path.join(MODELS_DIR, available[0]);
}

function diarizationAvailable() {
  return fs.existsSync(SEGMENTATION_MODEL_PATH) && fs.existsSync(EMBEDDING_MODEL_PATH);
}

let diarizer = null;
function getDiarizer() {
  if (!diarizer) {
    diarizer = new sherpa_onnx.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: SEGMENTATION_MODEL_PATH } },
      embedding: { model: EMBEDDING_MODEL_PATH },
      clustering: { numClusters: -1, threshold: 0.5 },
      minDurationOn: 0.2,
      minDurationOff: 0.5,
    });
  }
  return diarizer;
}

// Returns [{start, end, speaker}] in seconds, speaker is a 0-based integer id.
function diarizeAudio(wavPath, numSpeakers) {
  const sd = getDiarizer();
  sd.setConfig({ clustering: { numClusters: numSpeakers > 0 ? numSpeakers : -1, threshold: 0.5 } });
  const wave = sherpa_onnx.readWave(wavPath);
  return sd.process(wave.samples);
}

// Assigns each whisper segment the speaker with the largest time overlap.
function assignSpeakers(segments, diarizationSegments) {
  if (!diarizationSegments?.length) return segments;
  return segments.map((seg) => {
    let bestSpeaker = null;
    let bestOverlap = 0;
    for (const d of diarizationSegments) {
      const overlap = Math.min(seg.end, d.end) - Math.max(seg.start, d.start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = d.speaker;
      }
    }
    return bestSpeaker === null ? seg : { ...seg, speaker: bestSpeaker + 1 };
  });
}

function speakerLabel(seg) {
  return seg.speaker ? `[Speaker ${seg.speaker}] ` : "";
}

function toSrtTimestamp(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = ms % 1000;
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(msRem, 3)}`;
}

function buildTxt(segments) {
  return segments.map((seg) => `${speakerLabel(seg)}${seg.text}`).join("\n");
}

function buildSrt(segments) {
  return segments
    .map(
      (seg, i) =>
        `${i + 1}\n${toSrtTimestamp(seg.start)} --> ${toSrtTimestamp(seg.end)}\n${speakerLabel(seg)}${seg.text}\n`
    )
    .join("\n");
}

function buildVtt(segments) {
  const body = segments
    .map(
      (seg, i) =>
        `${i + 1}\n${toSrtTimestamp(seg.start).replace(",", ".")} --> ${toSrtTimestamp(seg.end).replace(",", ".")}\n${speakerLabel(seg)}${seg.text}\n`
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
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
  const diarize = req.body.diarize === "true" || req.body.diarize === "1";
  const numSpeakers = parseInt(req.body.numSpeakers, 10) || 0;

  if (!uploadedPath) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const modelPath = pickModelPath(language);
  if (!modelPath) {
    return res.status(500).json({
      error: "No Whisper model found. Run `npm run setup` first to download one.",
    });
  }
  if (language !== "en" && modelPath.includes(".en.bin")) {
    console.warn(
      `Warning: no multilingual model installed — falling back to an English-only model for language "${language}". ` +
        `Run \`WHISPER_MODEL=small npm run setup\` to install one.`
    );
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

  if (diarize && !diarizationAvailable()) {
    return res.status(500).json({
      error: "Speaker diarization models not found. Run `npm run setup` first to download them.",
    });
  }

  try {
    await convertToWav(uploadedPath, wavPath);
    await transcribe(wavPath, outBase, { language, modelPath });

    const jsonRaw = fs.readFileSync(outBase + ".json", "utf-8");
    const parsed = JSON.parse(jsonRaw);
    let segments = (parsed.transcription || []).map((seg) => ({
      start: seg.offsets.from / 1000,
      end: seg.offsets.to / 1000,
      startLabel: seg.timestamps.from.replace(",", "."),
      endLabel: seg.timestamps.to.replace(",", "."),
      text: seg.text.trim(),
    }));

    if (diarize) {
      const diarizationSegments = diarizeAudio(wavPath, numSpeakers);
      segments = assignSpeakers(segments, diarizationSegments);
    }

    fs.writeFileSync(outBase + ".txt", buildTxt(segments));
    fs.writeFileSync(outBase + ".srt", buildSrt(segments));
    fs.writeFileSync(outBase + ".vtt", buildVtt(segments));

    res.json({
      jobId,
      originalName,
      language: parsed.result?.language || language,
      diarized: diarize,
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
  const modelsDirExists = fs.existsSync(MODELS_DIR);
  res.json({
    whisperBinary: fs.existsSync(WHISPER_EXE),
    models: modelsDirExists ? fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith(".bin")) : [],
    diarizationAvailable: diarizationAvailable(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Transcript AI running at http://localhost:${PORT}`);
});
