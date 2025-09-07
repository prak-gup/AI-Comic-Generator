<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1W5x2Q5fT4c0LfKrEVIs2-V1DfS96GRrH

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env.local` file in the project root with your API keys:
   ```bash
   # Gemini client key (Vite will expose only keys prefixed with VITE_)
   VITE_GEMINI_API_KEY=your_gemini_api_key_here
   
   # Server-only keys (NOT exposed in client)
   ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
   FAL_API_KEY=your_fal_api_key_here
   ```

3. Run the application:
   ```bash
   # Option 1: Run both client and server concurrently
   npm run dev:all
   
   # Option 2: Run in separate terminals
   npm run dev         # Vite client (http://localhost:5173)
   npm run dev:server  # API server (http://localhost:5174)
   ```

4. Open [http://localhost:5173](http://localhost:5173) in your browser

## Architecture

This app uses a secure architecture where:
- **Client (Vite)**: Handles Gemini image generation and UI
- **Server (Express)**: Proxies ElevenLabs and Fal.ai API calls to keep keys secure
