# Meeting & Learning AI

A real-time speech translation, transcription, and note-taking web app for Japanese-language meetings and English-language learning. Built with React + Vite, deployed on Vercel, and powered by Anthropic Claude (translation & summarization) with an optional OpenAI Realtime speech-to-text engine.

> The app lives in the [`meeting-app/`](meeting-app) folder.

## Features

- **🎙️ Live Translate (JP → CN / JP → EN)** — Real-time Japanese speech translation with a Notta-style transcript feed: timestamps, per-line speaker labels (up to 5 speakers you name yourself), inline text editing with automatic re-translation, and paragraph-level batching.
- **🎬 Video Transcribe** — Translate English learning videos to Chinese, either by pasting a transcript or by capturing audio live.
- **📋 Meeting Minutes** — AI-generated, structured minutes saved and archived by date. Output language is selectable (日本語 / 中文 / English) and generated from the original transcript. The full speaker-labeled transcript is attached to each record for reference. Titles and content are editable.
- **📚 Study Notes** — Auto-generate concise, categorized study notes from any content, archived by date.
- **📊 Weekly Report** — Pick any past week and generate either a **Work report** (a client-ready weekly summary in Japanese, built from that week's meeting minutes) or a **Study report** (a study summary in Chinese, built from that week's notes). Reports are saved and browsable, split by type.
- **PWA** — Installable to the home screen and works full-screen like a native app.

## Speech engines

Two interchangeable speech-to-text engines, switchable per session:

| Engine | Backend | Notes |
| --- | --- | --- |
| **Free** | Browser Web Speech API (Google) | No cost. Excellent Japanese accuracy; can drop words at pauses on some browsers. |
| **Pro** | OpenAI Realtime transcription over WebRTC (`gpt-4o-transcribe`) | Gapless, low-latency streaming. Requires OpenAI API credits. |

## Tech stack

- **Frontend:** React 18, Vite, glassmorphism UI (inline styles), theme-aware
- **AI:** Anthropic Claude for translation & summarization, via a serverless proxy
- **Speech:** Browser Web Speech API + OpenAI Realtime API (WebRTC, ephemeral tokens)
- **Backend:** Vercel serverless functions (`api/claude.js`, `api/transcribe`, `api/openai-realtime-token.js`)
- **Storage:** Browser `localStorage` (per-device), with JSON export/import backup

## Getting started

```bash
cd meeting-app
npm install
npm run dev        # front-end only (the /api routes need `vercel dev`)
```

To run the serverless API routes locally:

```bash
npm i -g vercel
vercel dev
```

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables (Production):

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | Claude API — translation & summarization |
| `OPENAI_API_KEY` | Optional | Enables the **Pro** realtime speech engine |

## Deploy (Vercel)

- Connect this GitHub repository to Vercel.
- Set **Root Directory** to `meeting-app`.
- Add the environment variables above (Production), then deploy.
- Pushing to `main` redeploys automatically.

## Notes

- Notes, minutes, and reports are stored in the browser's `localStorage`, so they are per-device and per-browser. Use the **Export / Import** buttons to back up and move data. On iOS, prefer opening the app one consistent way (browser tab *or* installed PWA) to avoid separate storage.
- Speech recognition works best in desktop Chrome.

## License

Personal project — no license specified.
