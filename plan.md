Here’s a **ready-to-drop `PLAN.md`** for your Cursor workspace. It’s tailored to your current repo and fixes the issues that typically break AI Studio → Vite imports, env handling, and client-side key exposure.

---

# PLAN.md — Doodle2Comic (Cursor Build Plan)

## 0) What’s here now (quick audit)

* **Vite + TS + vanilla DOM app** (no React) using `@google/genai` via ESM import map in `index.html`. &#x20;
* **Env usage bug:** code reads `process.env.API_KEY` in the browser (undefined in Vite by default).
* **Secrets in client**: hardcoded **Fal** + **ElevenLabs** API keys inside `index.tsx` (security + CORS risk).&#x20;
* **SDK usage shape**: using `GoogleGenAI` (the newer `@google/genai` SDK) and `ai.models.generateContent(...)`. Keep this SDK, but we’ll fix request shapes/env handling.&#x20;
* **Package setup**: Vite 6, TS 5.8, `@google/genai@0.14.2`. Good baseline.&#x20;
* **App metadata** requests camera permission. Good.&#x20;
* **README** mentions `.env.local` + `GEMINI_API_KEY`—we’ll align with Vite’s `VITE_` convention.&#x20;
* **tsconfig** is set for ESM bundler/DOM. Fine.&#x20;
* **UI** is solid; keep CSS/HTML. &#x20;

---

## 1) Architecture fix (secure + shippable in hours)

**Goal:** Keep all **image generation** in the browser (Gemini), but **proxy partner calls** (Fal, ElevenLabs) via a tiny server route to avoid exposing keys and to bypass CORS.

### Split:

* **Client** (Vite):

  * Gemini Image + Text (uses **public** key via free tier, OK to be in client during hackathon).
  * File upload, camera capture, UI flow.
* **Server** (tiny Node/Express or Vite middleware):

  * `POST /api/tts` → calls ElevenLabs with server-side key
  * `POST /api/grid` → calls fal.ai Grid with server-side key

> This keeps your ElevenLabs/Fal keys off the client bundle and avoids browser CORS surprises.

---

## 2) Environment variables

Create `.env.local` in the repo root:

```bash
# Gemini client key (Vite will expose only keys prefixed with VITE_)
VITE_GEMINI_API_KEY=xxx_your_gemini_key

# Server-only keys (NOT exposed in client)
ELEVENLABS_API_KEY=sk_...
FAL_API_KEY=...
```

Update **README** instructions to match `VITE_GEMINI_API_KEY`.&#x20;

---

## 3) Dependency check

Already good:

```json
"dependencies": {
  "@google/genai": "0.14.2"
},
"devDependencies": {
  "vite": "^6.2.0",
  "typescript": "~5.8.2",
  "@types/node": "^22.14.0"
}
```

Keep as-is.&#x20;

---

## 4) Vite config shim (server routes)

Create **`/server.ts`** (light Express) OR **Vite dev middleware**. For speed inside Cursor, we’ll add a lean Express server:

```ts
// server.ts
import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voiceId = '21m00Tcm4TlvDq8ikWAM' } = req.body || {};
    if (!process.env.ELEVENLABS_API_KEY) return res.status(500).json({ error: 'ELEVENLABS_API_KEY missing' });
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' })
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buf);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'tts failed' });
  }
});

app.post('/api/grid', async (req, res) => {
  try {
    const { image_urls, grid_cols = 2 } = req.body || {};
    if (!process.env.FAL_API_KEY) return res.status(500).json({ error: 'FAL_API_KEY missing' });
    const r = await fetch('https://fal.run/fal-ai/imageutils/grid', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${process.env.FAL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_urls, grid_cols })
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const json = await r.json();
    res.json(json);
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'grid failed' });
  }
});

const port = process.env.PORT || 5174;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
```

Add deps:

```bash
npm i express node-fetch body-parser
npm i -D @types/express
```

Adjust **package.json** scripts to run client + server concurrently during dev:

```json
{
  "scripts": {
    "dev": "vite",
    "dev:server": "tsx server.ts",
    "dev:all": "run-p dev dev:server", 
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "npm-run-all": "^4.1.5"
  }
}
```

*(You can also use two terminals: one for `npm run dev`, one for `npm run dev:server`.)*

---

## 5) Client fixes (index.tsx)

### 5.1 Env access (Vite)

Replace the **Gemini key gate** at the top:

```ts
// Before (breaks in browser)
if (!process.env.API_KEY) { ... }

// After (Vite)
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  const appRoot = document.getElementById('app');
  if (appRoot) {
    appRoot.innerHTML = `<div class="container" style="text-align:center">
      <div class="error-message"><strong>Fatal Error:</strong> Missing VITE_GEMINI_API_KEY.</div>
    </div>`;
  }
  throw new Error("FATAL: VITE_GEMINI_API_KEY is not defined.");
}
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
```

*(Everything else keeps using `ai`.)*
This aligns with **Vite env** and your **README** intent.&#x20;

### 5.2 Remove client-side partner keys

Delete these lines from `index.tsx` and refactor calls to hit our server routes:&#x20;

```ts
const FAL_API_KEY = '...';
const ELEVENLABS_API_KEY = '...';
```

### 5.3 ElevenLabs call → server

Replace `generateAudio` with:

```ts
async function generateAudio(text: string): Promise<string | null> {
  if (!text.trim()) return null;
  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!r.ok) throw new Error(`tts ${r.status}`);
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error('tts error', e);
    return null;
  }
}
```

### 5.4 fal.ai grid → server

Replace `generateComicLayout` with:

```ts
async function generateComicLayout(title: string, panels: { image: { base64: string }, caption: string }[]) {
  const image_urls = panels.map(p => `data:image/png;base64,${p.image.base64}`);
  const gridCols = state.userInput.panelCount <= 4 ? 2 : 3;

  const r = await fetch('/api/grid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_urls, grid_cols: gridCols })
  });
  if (!r.ok) throw new Error(`Fal grid ${r.status}`);
  const result = await r.json();

  // existing parsing
  if (!result.images?.[0]?.url) throw new Error('No grid image returned');
  const url = result.images[0].url;
  const base64 = url.split(',')[1] || '';
  return { base64, mimeType: 'image/png' };
}
```

### 5.5 Minor stability

* Keep **model names** you used:

  * `"gemini-2.5-flash-image-preview"` for images
  * `"gemini-2.5-flash"` for text planning
* When calling `ai.models.generateContent`, ensure `contents` is either a **string** or a **proper parts array**. Your current calls use `{ parts: [...] }` which is valid shape in `@google/genai`—we’ll keep it.&#x20;
* Retain HTML import map for `@google/genai` (browser ESM)—matches your setup.&#x20;

---

## 6) Dev & Run

```bash
npm install
# add envs to .env.local (see Section 2)

# run in two terminals:
npm run dev         # Vite client (http://localhost:5173)
npm run dev:server  # API server (http://localhost:5174)

# or concurrently (if you added run-p):
npm run dev:all
```

Open **[http://localhost:5173](http://localhost:5173)**.
The UI flow remains: Upload drawing → “Create My Comic!” → approve character → generate panels → audio → grid.

---

## 7) Testing checklist (fast)

* **Env gate:** Missing `VITE_GEMINI_API_KEY` shows friendly fatal error. (top of `index.tsx`)
* **Character card:** Generates **3 poses** (the code maps three promises for poses).&#x20;
* **Storyboard:** JSON is parsed; if invalid, user sees a clear error “try a different story.”&#x20;
* **Panels:** Appear incrementally in the grid as each resolves.&#x20;
* **Audio:** Plays sequentially across panels.&#x20;
* **Grid:** Returns base64; full comic shows. Fallback shows individual panels if grid fails.&#x20;

---

## 8) Rate-limit strategy (Kaggle/Nano Banana)

* Default **4 panels** (you already default to 4) to stay well under **20 images/min** and **200/day**; allow user to choose 3–6 with a warning prompt.&#x20;
* Reuse the **character card** across edits; don’t regenerate it unless user retries.

---

## 9) Production deploy (Cloud Run)

* Build client: `npm run build` → deploy `/dist` to static hosting (or Vite preview).
* Deploy server: containerize `server.ts` (Node 20), expose `/api/*`.
* Set envs on the service (no `VITE_` for server keys).
* Configure client `fetch('/api/...')` with your prod base path (e.g., Nginx reverse proxy or set `VITE_API_BASE` and use `import.meta.env.VITE_API_BASE`).

---

## 10) Kaggle deliverables (ready text)

* **Title:** Doodle2Comic – Kids’ Storyboard Generator
* **Writeup (≤200 words):** use the template we prepared earlier (paste/adapt).
* **Public demo:**

  * Option A: Host client and server publicly (Cloud Run / Vercel + Fly)
  * Option B: GitHub repo with clear `README` steps (this plan) + Loom/YouTube 2-min demo
* **Video beats:** Hook → Input → Character card → Panels + edit → Narration → Final grid → Close.

---

## 11) Polishing ideas (optional if time allows)

* Add **Hindi/English toggle** in UI → set ElevenLabs voice or SSML by locale.
* Small **speech bubble overlay** per panel (drawn on `<canvas>` at render time, not part of the generated image).
* Button: “Make the dragon friendly 🐉” to demo edit-with-words quickly.

---

## 12) File-by-file references (for reviewers)

* **tsconfig.json** — bundler, DOM libs, React JSX (fine with TS/DOM).&#x20;
* **package.json** — `@google/genai@0.14.2`, Vite 6, TS 5.8 scripts.&#x20;
* **metadata.json** — app name/permissions (camera).&#x20;
* **index.tsx** — core logic (state, Gemini calls, UI). *(We’re patching env + partner calls here.)*&#x20;
* **index.html** — ESM import map for `@google/genai`, loads `index.tsx`.&#x20;
* **index.css** — existing UI is good; no changes required.&#x20;
* **README.md** — switch to `VITE_GEMINI_API_KEY` in instructions.&#x20;

---

## 13) If something still “doesn’t work”

* **Symptom:** “Missing key” → Check `.env.local` and that you restarted Vite.
* **CORS** on ElevenLabs/Fal → Confirm calls route via `/api/*` (server.ts), not from browser.
* **JSON parse fail** in storyboard → log `response.text` and retry with simpler story; the schema is strict.&#x20;
* **SDK import mismatch** → Keep `@google/genai` + `GoogleGenAI` as you already use in both HTML importmap and TS imports. &#x20;

---

### Done.

Drop this `PLAN.md` into your repo. If you want, I can also paste the **exact diffs** for `index.tsx`, `package.json`, and a minimal **Dockerfile** for Cloud Run.
