# Transcript AI

Local web app that turns an uploaded video/audio file — or a recorded meeting —
into a timestamped transcript, powered by [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
(a fast, dependency-free open-source implementation of OpenAI's Whisper).

Everything runs on your machine: no cloud calls, no API keys. First run
auto-downloads a prebuilt whisper.cpp binary and a Whisper model.

## Requirements

- Node.js 18+ (Windows x64)
- Internet access for the one-time setup download (~150 MB model)

No Python, no ffmpeg install, no C++ compiler needed — a static ffmpeg binary
and prebuilt whisper.cpp binary are fetched automatically.

## Setup

```
npm install
npm run setup
```

`npm run setup` downloads:
- `bin/whisper/whisper-cli.exe` — the whisper.cpp CLI (Windows x64, CPU build)
- `models/ggml-base.en.bin` — the default English Whisper model (~148 MB)

To use a different model (e.g. better accuracy or multilingual support), set
`WHISPER_MODEL` before running setup, e.g.:

```
set WHISPER_MODEL=small
npm run setup
```

Common options: `tiny.en`, `base.en` (default), `small.en`, `small`, `medium`,
`medium.en`. Larger models are slower but more accurate; `.en` variants are
English-only and slightly faster/more accurate for English audio.

## Run

```
npm start
```

Then open http://localhost:3000 in your browser.

## Using the app

- **Upload file** — drag & drop or browse to a video/audio file (mp4, mov,
  mkv, mp3, wav, m4a, webm, …).
- **Record meeting** — records audio directly from your microphone in the
  browser.
- Pick a language (or leave on auto-detect) and click **Transcribe**.
- The transcript appears with per-segment timestamps, and can be downloaded
  as `.txt`, `.srt`, or `.vtt`.

## How it works

1. The uploaded/recorded media is saved temporarily.
2. `ffmpeg` (bundled via `ffmpeg-static`) converts it to 16kHz mono WAV.
3. `whisper-cli.exe` transcribes the WAV with word/segment-level timestamps,
   emitting JSON, SRT, VTT, and TXT.
4. The server parses the JSON and returns segments (with start/end times) to
   the browser; the raw SRT/VTT/TXT files stay on disk for download.

Transcripts are stored under `transcripts/<job-id>/`. Clean that folder
periodically if disk space matters — nothing there is required once you've
downloaded what you need.

## Notes on accuracy/speed

- CPU-only by default — fine for short/medium recordings. A 10-15 minute
  meeting on a modern laptop CPU typically transcribes in a few minutes with
  `base.en`.
- For long meetings or better accuracy, try `small.en` or `medium.en`
  (slower, more accurate). Re-run `npm run setup` with `WHISPER_MODEL` set
  to fetch the new model — old ones aren't deleted automatically.
