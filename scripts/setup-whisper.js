// Downloads a prebuilt whisper.cpp (Windows x64, CPU) binary and a ggml model
// so the app can transcribe locally without compiling anything.
const fs = require("fs");
const path = require("path");
const os = require("os");
const extractZip = require("extract-zip");
const tar = require("tar");
const bz2 = require("unbzip2-stream");

const ROOT = path.join(__dirname, "..");
const BIN_DIR = path.join(ROOT, "bin", "whisper");
const MODELS_DIR = path.join(ROOT, "models");
const DIARIZATION_DIR = path.join(MODELS_DIR, "diarization");
const SEGMENTATION_MODEL_DIR = path.join(DIARIZATION_DIR, "sherpa-onnx-pyannote-segmentation-3-0");
const EMBEDDING_MODEL_PATH = path.join(DIARIZATION_DIR, "3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx");

const SEGMENTATION_MODEL_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2";
const EMBEDDING_MODEL_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx";

const WHISPER_VERSION = "v1.9.1";
const WHISPER_ZIP_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`;
const NEEDED_FILES = [
  "whisper-cli.exe",
  "whisper.dll",
  "ggml.dll",
  "ggml-base.dll",
  "ggml-cpu-x64.dll",
  "ggml-cpu-sse42.dll",
  "ggml-cpu-sandybridge.dll",
  "ggml-cpu-haswell.dll",
  "ggml-cpu-alderlake.dll",
  "ggml-cpu-cannonlake.dll",
  "ggml-cpu-cascadelake.dll",
  "ggml-cpu-icelake.dll",
  "ggml-cpu-skylakex.dll",
];

// Default model: base.en (English-only, ~140MB, fast on CPU, good accuracy).
// Set WHISPER_MODEL env var to e.g. "small" or "small.en" for multilingual/better quality.
const MODEL = process.env.WHISPER_MODEL || "base.en";
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin`;
const MODEL_PATH = path.join(MODELS_DIR, `ggml-${MODEL}.bin`);

async function download(url, destPath) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get("content-length") || 0);
  let received = 0;
  let lastPct = -1;
  const fileStream = fs.createWriteStream(destPath);
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    fileStream.write(Buffer.from(value));
    if (total) {
      const pct = Math.floor((received / total) * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        process.stdout.write(`\r  ${path.basename(destPath)}: ${pct}%   `);
      }
    }
  }
  fileStream.end();
  await new Promise((resolve) => fileStream.on("close", resolve));
  process.stdout.write("\n");
}

async function setupWhisperBinary() {
  const exePath = path.join(BIN_DIR, "whisper-cli.exe");
  if (fs.existsSync(exePath)) {
    console.log("whisper-cli.exe already present, skipping binary download.");
    return;
  }
  if (os.platform() !== "win32") {
    throw new Error(
      "This setup script only auto-downloads the Windows x64 whisper.cpp binary. " +
        "On other platforms, build whisper.cpp yourself and place the binary in bin/whisper/."
    );
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });
  const tmpZip = path.join(os.tmpdir(), `whisper-bin-x64-${Date.now()}.zip`);
  console.log(`Downloading whisper.cpp ${WHISPER_VERSION} (Windows x64)...`);
  await download(WHISPER_ZIP_URL, tmpZip);

  const tmpExtractDir = path.join(os.tmpdir(), `whisper-extract-${Date.now()}`);
  fs.mkdirSync(tmpExtractDir, { recursive: true });
  console.log("Extracting...");
  await extractZip(tmpZip, { dir: tmpExtractDir });

  const releaseDir = path.join(tmpExtractDir, "Release");
  for (const file of NEEDED_FILES) {
    fs.copyFileSync(path.join(releaseDir, file), path.join(BIN_DIR, file));
  }

  fs.rmSync(tmpZip, { force: true });
  fs.rmSync(tmpExtractDir, { recursive: true, force: true });
  console.log("whisper.cpp binary ready.");
}

async function setupModel() {
  if (fs.existsSync(MODEL_PATH)) {
    console.log(`Model ggml-${MODEL}.bin already present, skipping.`);
    return;
  }
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  console.log(`Downloading Whisper model "${MODEL}" (this may take a few minutes)...`);
  const tmpPath = MODEL_PATH + ".part";
  await download(MODEL_URL, tmpPath);
  fs.renameSync(tmpPath, MODEL_PATH);
  console.log("Model ready.");
}

async function setupDiarizationModels() {
  const segModelPath = path.join(SEGMENTATION_MODEL_DIR, "model.onnx");
  if (!fs.existsSync(segModelPath)) {
    fs.mkdirSync(DIARIZATION_DIR, { recursive: true });
    console.log("Downloading speaker segmentation model...");
    const tmpBz2 = path.join(os.tmpdir(), `seg-${Date.now()}.tar.bz2`);
    await download(SEGMENTATION_MODEL_URL, tmpBz2);
    console.log("Extracting segmentation model...");
    await new Promise((resolve, reject) => {
      fs.createReadStream(tmpBz2)
        .pipe(bz2())
        .pipe(tar.extract({ cwd: DIARIZATION_DIR }))
        .on("finish", resolve)
        .on("error", reject);
    });
    fs.rmSync(tmpBz2, { force: true });
    console.log("Segmentation model ready.");
  } else {
    console.log("Speaker segmentation model already present, skipping.");
  }

  if (!fs.existsSync(EMBEDDING_MODEL_PATH)) {
    fs.mkdirSync(DIARIZATION_DIR, { recursive: true });
    console.log("Downloading speaker embedding model...");
    const tmpPath = EMBEDDING_MODEL_PATH + ".part";
    await download(EMBEDDING_MODEL_URL, tmpPath);
    fs.renameSync(tmpPath, EMBEDDING_MODEL_PATH);
    console.log("Embedding model ready.");
  } else {
    console.log("Speaker embedding model already present, skipping.");
  }
}

async function main() {
  await setupWhisperBinary();
  await setupModel();
  await setupDiarizationModels();
  console.log("\nSetup complete. Run `npm start` to launch the app.");
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
