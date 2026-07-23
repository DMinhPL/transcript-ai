# Transcript AI

Local web app that turns an uploaded video/audio file — or a recorded meeting —
into a timestamped transcript, powered by [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
(a fast, dependency-free open-source implementation of OpenAI's Whisper), with
optional speaker diarization ("who said what") via
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx).

Everything runs on your machine: no cloud calls, no API keys. First run
auto-downloads prebuilt binaries and models.

## Getting started

1. **Check requirements** — Node.js 18+ on Windows x64, and internet access
   for the one-time model download. No Python, no ffmpeg install, no C++
   compiler needed — a static ffmpeg binary and prebuilt whisper.cpp binary
   are fetched automatically.

2. **Install dependencies**
   ```
   npm install
   ```

3. **Run setup** (one-time; downloads whisper-cli.exe + the default English
   model, ~150 MB)
   ```
   npm run setup
   ```

4. *(Optional but recommended)* **Add a multilingual model** if you'll
   transcribe anything other than English — the default model from step 3
   is English-only and cannot transcribe other languages at all:
   ```
   set WHISPER_MODEL=small
   npm run setup
   ```
   This adds `models/ggml-small.bin` (~488 MB) alongside the English model;
   the app automatically uses the right one per request. See
   [Choosing a model](#choosing-a-model) below for other sizes, and
   [Better Vietnamese accuracy](#better-vietnamese-accuracy) for a
   Vietnamese-specialized option.

   Speaker diarization models (~490 MB) are downloaded automatically in
   step 3 — no extra step needed for that.

5. **Start the server**
   ```
   npm start
   ```

6. **Open the app** — go to http://localhost:3000 in your browser.

7. **Stop the server** when you're done — `Ctrl+C` in the terminal running
   `npm start`.

## Using the app

- **Upload file** — drag & drop or browse to a video/audio file (mp4, mov,
  mkv, mp3, wav, m4a, webm, …).
- **Record meeting** — records audio directly from your microphone in the
  browser.
- Pick a language (or leave on auto-detect).
- Check **Identify speakers** to enable diarization. If you know how many
  people are in the recording, enter it — a known speaker count is
  significantly more accurate than auto-detection, which tends to
  over-count speakers on short/noisy audio.
- Click **Transcribe**. The transcript appears with per-segment timestamps
  (and speaker labels, if enabled), and can be downloaded as `.txt`, `.srt`,
  or `.vtt` — speaker labels are included in the downloads too.

## How it works

1. The uploaded/recorded media is saved temporarily.
2. `ffmpeg` (bundled via `ffmpeg-static`) converts it to 16kHz mono WAV.
3. `whisper-cli.exe` transcribes the WAV with word/segment-level timestamps,
   emitting JSON, SRT, VTT, and TXT.
4. If diarization is enabled, `sherpa-onnx` (pyannote segmentation model +
   a 3D-Speaker voice-embedding model) clusters the same WAV into
   per-speaker time segments. Each whisper segment is labeled with whichever
   speaker overlaps it the most.
5. The server writes the final SRT/VTT/TXT (with speaker labels merged in)
   and returns segments (start/end times + speaker) to the browser.

Transcripts are stored under `transcripts/<job-id>/`. Clean that folder
periodically if disk space matters — nothing there is required once you've
downloaded what you need.

## Speaker diarization notes

- Diarization tells you *who* spoke *when* (voice clustering) — it does not
  identify people by name, and it's a separate model from Whisper, so it can
  occasionally disagree slightly with Whisper's segment boundaries (each
  transcript line is labeled with whichever speaker overlaps it most).
- If you don't specify the number of speakers, auto-detection is used, which
  tends to over-count speakers (split one person's voice into 2-3 "speakers")
  on shorter or noisier recordings — specifying the count when known avoids
  this.
- Speaker IDs (Speaker 1, Speaker 2, ...) are only stable *within* one
  transcript, not across separate uploads.

## Choosing a model

CPU-only by default — fine for short/medium recordings. A 10-15 minute
meeting on a modern laptop CPU typically transcribes in a few minutes with
`base.en`. For long meetings or better accuracy, set `WHISPER_MODEL` before
`npm run setup` to one of:

`tiny.en`, `base.en` (default), `small.en`, `small`, `medium`, `medium.en`,
`large-v3`. Larger models are slower but more accurate; `.en` variants are
English-only and slightly faster/more accurate for English audio. Old models
aren't deleted automatically — you can keep several installed at once, and
the app automatically picks an English model for English and a multilingual
one for everything else.

## Better Vietnamese accuracy

The generic multilingual models above know ~100 languages but aren't
specialized in any of them, which shows up as spelling/diacritic mistakes in
Vietnamese. [PhoWhisper](https://github.com/VinAIResearch/PhoWhisper) (VinAI
Research) is a Whisper fine-tuned on 844 hours of Vietnamese speech and is a
straightforward accuracy upgrade. To use it:

1. Download a `ggml`-format PhoWhisper build (same file format this app
   already uses), e.g. from Hugging Face:
   - `small` (488 MB, same size/speed as the default multilingual model):
     https://huggingface.co/dongxiat/ggml-PhoWhisper-small
   - `medium` (1.53 GB, slower, more accurate):
     https://huggingface.co/dongxiat/ggml-PhoWhisper-medium
2. Save it into `models/` under the matching generic name so the app picks
   it up automatically — e.g. save the `small` build as
   `models/ggml-small.bin` (replacing/alongside the generic one), or the
   `medium` build as `models/ggml-medium.bin`.
3. Restart the server (`npm start`) and transcribe with language set to
   Vietnamese.
