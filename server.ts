// server.ts
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import express from 'express';
import fetch from 'node-fetch';
import bodyParser from 'body-parser';

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

// Enable CORS for Vite dev server
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    // Use the user-provided voice ID for storytelling
    const { text, voiceId = 'WtA85syCrJwasGeHGH2p' } = req.body || {};
    if (!process.env.ELEVENLABS_API_KEY) return res.status(500).json({ error: 'ELEVENLABS_API_KEY missing' });
    
    console.log('TTS request for text:', text);
    
    // Try the ElevenLabs API with proper headers
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: text,
        // Use multilingual v2 to improve language support and quality
        model_id: 'eleven_multilingual_v2',
        output_format: 'mp3_44100_128',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs API error:', response.status, errorText);
      
      let errorMessage = `ElevenLabs API Error (${response.status}): `;
      
      if (response.status === 429) {
        errorMessage += 'Resource exhausted - you have reached your ElevenLabs API quota limit. Please check your account usage or upgrade your plan.';
      } else if (response.status === 401) {
        errorMessage += 'Authentication failed - please check your ElevenLabs API key permissions.';
      } else if (response.status === 400) {
        errorMessage += 'Bad request - the text might be too long or invalid.';
      } else {
        errorMessage += errorText || 'Unknown error occurred.';
      }
      
      return res.status(500).json({ error: errorMessage });
    }

    // Set proper headers for audio response
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="speech.mp3"');
    
    // Stream the audio data
    response.body.pipe(res);
    
  } catch (e: any) {
    console.error('TTS error:', e);
    res.status(500).json({ error: e.message || 'tts failed' });
  }
});

// Grid endpoint removed - now using client-side video generation

const port = process.env.PORT || 5174;
app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
  console.log('Environment check:', {
    hasGeminiKey: !!process.env.VITE_GEMINI_API_KEY,
    hasElevenLabsKey: !!process.env.ELEVENLABS_API_KEY,
    hasFalKey: !!process.env.FAL_API_KEY
  });
});
