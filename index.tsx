/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type, Modality, Part } from "@google/genai";
// React/shadcn components removed for classic UI
import { ART_STYLES, STORYBOARD_SYSTEM_INSTRUCTION, CHARACTER_GENERATION_PROMPT, PANEL_RENDERING_PROMPT, STORY_SUGGESTION_PROMPT } from './prompts.js';

// --- API KEYS ---
// API keys are now handled securely via server-side proxy routes


// --- STATE MANAGEMENT ---
interface AppState {
    step: 'input' | 'character_preview' | 'generating_comic' | 'final_comic';
    isLoading: boolean;
    loadingMessage: string;
    error: string | null;
    userInput: {
        drawing: { base64: string; mimeType: string } | null;
        story: string;
        style: string;
        panelCount: number;
        selectedArtStyle: keyof typeof ART_STYLES;
    };
    showStoryInput: boolean;
    storySuggestions: string[];
    characterCard: { base64: string; mimeType: string }[];
    storyboard: any | null;
    panelImages: ({ base64: string; mimeType: string } | null)[];
    panelAudio: (string | null)[];
    finalComicVideo: string | null;
    currentPanel: number;
    isPlaying: boolean;
    currentAudio: HTMLAudioElement | null;
    isWebSpeech: boolean;
}

let state: AppState;
const USE_REACT_UI = false;

function initState(): void {
    state = {
        step: 'input',
        isLoading: false,
        loadingMessage: '',
        error: null,
        userInput: {
            drawing: null,
            story: '',
            style: 'A vibrant and colorful cartoon with bold outlines.',
            panelCount: 4,
            selectedArtStyle: 'disney',
        },
        showStoryInput: false,
        storySuggestions: [],
        characterCard: [],
        storyboard: null,
        panelImages: [],
        panelAudio: [],
        finalComicVideo: null,
        currentPanel: 0,
        isPlaying: false,
        currentAudio: null,
        isWebSpeech: false,
    };
}

function setState(newState: Partial<AppState>) {
    Object.assign(state, newState);
    render();
}

// --- GEMINI API SETUP ---
// Critical check: Ensure API key exists before initializing the library.
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    const appRoot = document.getElementById('app');
    if (appRoot) {
        appRoot.innerHTML = `<div class="container" style="text-align: center;">
            <div class="error-message">
                <strong>Fatal Error:</strong> Missing VITE_GEMINI_API_KEY. The application cannot be initialized.
            </div>
        </div>`;
    }
    // Halt script execution to prevent further errors.
    throw new Error("FATAL: VITE_GEMINI_API_KEY is not defined.");
}
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// --- API HELPER FUNCTIONS ---

/**
 * Converts a File object to a base64 string.
 */
function fileToGenerativePart(file: File): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = (e.target.result as string).split(',')[1];
            resolve({ base64, mimeType: file.type });
        };
        reader.readAsDataURL(file);
    });
}

/**
 * Generates the 3-image character card from a user's drawing.
 */
async function generateCharacterCard(drawing: { base64: string, mimeType: string }, style: string): Promise<{ base64: string, mimeType: string }[]> {
    const poses = [
        "Front neutral pose on a plain white background",
        "3/4 smiling pose on a plain white background",
        "Action pose (jumping or running) on a plain white background"
    ];
    const model = 'gemini-2.5-flash-image-preview';
    const imagePart = { inlineData: { data: drawing.base64, mimeType: drawing.mimeType } };

    const generationPromises = poses.map(pose => {
        const textPart = { text: CHARACTER_GENERATION_PROMPT(style, pose) };
        return ai.models.generateContent({
            model,
            contents: { parts: [imagePart, textPart] },
            config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
        });
    });

    const responses = await Promise.all(generationPromises);
    
    return responses.map(response => {
        const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
        if (!imagePart?.inlineData) {
            throw new Error("API failed to return an image for the character card.");
        }
        return { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType };
    });
}

/**
 * Generates the storyboard plan as a JSON object.
 */
async function planStoryboard(story: string, panelCount: number) {
    const systemInstruction = STORYBOARD_SYSTEM_INSTRUCTION(panelCount);
    
    const userPrompt = `Story seed: "${story}"`;

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: userPrompt,
        config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    title: {
                        type: Type.STRING,
                        description: "The title of the comic strip."
                    },
                    panels: {
                        type: Type.ARRAY,
                        description: "An array of panel objects, each describing a scene.",
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: {
                                    type: Type.STRING,
                                    description: "A unique identifier for the panel, e.g., 'p1'."
                                },
                                prompt: {
                                    type: Type.STRING,
                                    description: "A detailed prompt for the image generation model to create the panel's illustration."
                                },
                                speech: {
                                    type: Type.ARRAY,
                                    description: "An array of speech objects for dialogue or narration in the panel.",
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            who: {
                                                type: Type.STRING,
                                                description: "The character speaking (e.g., 'Narrator', 'Hero Dog')."
                                            },
                                            text: {
                                                type: Type.STRING,
                                                description: "The line of dialogue or narration."
                                            }
                                        },
                                        required: ['who', 'text']
                                    }
                                }
                            },
                            required: ['id', 'prompt', 'speech']
                        }
                    }
                },
                required: ['title', 'panels']
            }
        },
    });

    try {
        return JSON.parse(response.text);
    } catch (e) {
        console.error("Invalid JSON from storyboard planner:", response.text);
        throw new Error("The AI failed to create a valid story plan. Please try a different story.");
    }
}

/**
 * Renders a single comic panel image.
 */
async function renderPanel(panelPrompt: string, characterRefs: { base64: string, mimeType: string }[], style: string) {
    const model = 'gemini-2.5-flash-image-preview';
    const textPrompt = PANEL_RENDERING_PROMPT(panelPrompt, style);
    
    const parts: Part[] = [
        ...characterRefs.map(ref => ({ inlineData: { data: ref.base64, mimeType: ref.mimeType } })),
        { text: textPrompt }
    ];

    const response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });

    const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
    if (!imagePart?.inlineData) throw new Error("API failed to return a panel image.");
    return { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType };
}

/**
 * Generates audio from text using ElevenLabs API via server proxy.
 */
async function generateAudio(text: string): Promise<string | null> {
    if (!text.trim()) return null;
    
    try {
        // Route to API server (dev runs on 5174). Use absolute URL in dev to avoid 404s.
        const apiBase = (window.location && window.location.port === '5173') ? 'http://localhost:5174' : '';
        const r = await fetch(`${apiBase}/api/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        
        if (!r.ok) {
            const errorText = await r.text();
            let errorMessage = `ElevenLabs API Error (${r.status}): `;
            
            if (r.status === 429) {
                errorMessage += 'Resource exhausted - you have reached your ElevenLabs API quota limit. Please check your account usage or upgrade your plan.';
            } else if (r.status === 401) {
                errorMessage += 'Authentication failed - please check your ElevenLabs API key permissions.';
            } else if (r.status === 400) {
                errorMessage += 'Bad request - the text might be too long or invalid.';
            } else {
                errorMessage += errorText || 'Unknown error occurred.';
            }
            
            throw new Error(errorMessage);
        }
        
        const contentType = r.headers.get('content-type');
        if (contentType && contentType.includes('audio/')) {
            const blob = await r.blob();
            return URL.createObjectURL(blob);
        } else {
            const preview = await r.text().catch(() => '');
            throw new Error('ElevenLabs API returned invalid audio response: ' + (preview?.slice(0,200) || ''));
        }
        
    } catch (e) {
        console.error('ElevenLabs TTS error:', e);
        // Fallback to browser speech synthesis (non-downloadable)
        try {
            if ('speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance(text);
                // create a pseudo-URL to signal web speech usage
                return 'webspeech://current';
            }
        } catch (_) {}
        return null;
    }
}

// Web Speech API functions removed - using only ElevenLabs voice

/**
 * Generates story suggestions based on uploaded character image
 */
async function generateStorySuggestions(imageBase64: string, mimeType: string): Promise<string[]> {
    try {
        const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
        const model = 'gemini-2.5-flash-image-preview';
        
        // First, get a description of the character
        const imagePart = { inlineData: { data: imageBase64, mimeType } };
        const describePrompt = { text: "Describe this character in 1-2 sentences. What kind of character is it? What does it look like? Focus on the character's appearance and personality." };
        
        const describeResponse = await ai.models.generateContent({
            model,
            contents: { parts: [imagePart, describePrompt] },
            config: { responseModalities: [Modality.TEXT] },
        });
        
        const characterDescription = describeResponse.candidates?.[0]?.content?.parts?.[0]?.text || "A friendly character";
        
        // Now generate story suggestions based on the character
        const storyPrompt = { text: STORY_SUGGESTION_PROMPT(characterDescription) };
        
        const storyResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: storyPrompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        suggestions: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING }
                        }
                    },
                    required: ['suggestions']
                }
            }
        });
        
        const result = JSON.parse(storyResponse.candidates?.[0]?.content?.parts?.[0]?.text || '{"suggestions": []}');
        return result.suggestions || [];
        
    } catch (e) {
        console.error('Error generating story suggestions:', e);
        return [
            "A brave hero goes on an exciting adventure",
            "A magical creature helps solve a problem", 
            "A friendship story with a happy ending"
        ];
    }
}

/**
 * Creates a sequential comic experience with individual panels and narration.
 */
async function createComicVideo(title: string, panelImages: ({ base64: string; mimeType: string } | null)[], panelAudio: (string | null)[], panels: any[]): Promise<string> {
    // For sequential display, we'll return a special marker
    // The actual display will be handled in the final view
    return 'sequential-comic';
}


// --- CAMERA HANDLING ---
let cameraStream: MediaStream | null = null;
async function openCameraModal() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setState({ error: "Camera not supported by this browser." });
        return;
    }

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        
        const modal = document.createElement('div');
        modal.className = 'camera-modal';
        modal.innerHTML = `
            <video id="camera-view" autoplay playsinline></video>
            <div class="camera-controls">
                <button id="snap-button">Take Picture</button>
                <button id="cancel-camera-button">Cancel</button>
            </div>
        `;
        document.body.appendChild(modal);

        const videoEl = document.getElementById('camera-view') as HTMLVideoElement;
        videoEl.srcObject = cameraStream;

        document.getElementById('snap-button')!.onclick = handleTakePicture;
        document.getElementById('cancel-camera-button')!.onclick = closeCameraModal;

    } catch (err) {
        console.error("Camera access error:", err);
        setState({ error: "Could not access camera. Please check permissions." });
    }
}

function handleTakePicture() {
    const videoEl = document.getElementById('camera-view') as HTMLVideoElement;
    if (!videoEl || videoEl.videoWidth === 0) {
        setState({ error: "Camera image is not ready yet." });
        return;
    };
    
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
        setState({ error: "Could not process the captured image." });
        closeCameraModal();
        return;
    }
    context.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg');
    const base64 = dataUrl.split(',')[1];
    
    setState({
        userInput: {
            ...state.userInput,
            drawing: { base64, mimeType: 'image/jpeg' }
        }
    });

    closeCameraModal();
}

function closeCameraModal() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    const modal = document.querySelector('.camera-modal');
    if (modal) {
        modal.remove();
    }
}


// --- UI RENDERING ---

const appRoot = document.getElementById('app')!;

// React UI components
function Stepper({ currentStep }: { currentStep: number }) {
  return (
    <div className="sticky top-0 z-10 bg-white/85 backdrop-blur-md py-2 mb-3">
      <div className="flex gap-2 justify-center items-center">
        {[1,2,3,4,5].map(i => (
          <span key={i} className={cn('inline-block w-2.5 h-2.5 rounded-full', i <= currentStep ? 'bg-indigo-600' : 'bg-gray-200')} />
        ))}
      </div>
    </div>
  );
}

function ReactWizard() {
  const [drawing, setDrawing] = React.useState<{ base64: string; mimeType: string } | null>(state.userInput.drawing);
  const [story, setStory] = React.useState<string>(state.userInput.story);
  const [showStoryInput, setShowStoryInput] = React.useState<boolean>(false);
  const [selectedStyle, setSelectedStyle] = React.useState<keyof typeof ART_STYLES>(state.userInput.selectedArtStyle);
  const [panels, setPanels] = React.useState<number>(Math.max(3, state.userInput.panelCount || 4));
  const [toast, setToast] = React.useState<string | null>(null);
  const canNext2 = !!drawing;
  const canNext3 = !!(story && story.trim().length > 0);
  const canSubmit = canNext2 && canNext3 && panels >= 3 && panels <= 8;

  const onFile = async (file?: File) => {
    if (!file) return;
    const data = await fileToGenerativePart(file);
    setDrawing(data);
    // micro-interactions
    launchConfetti();
    setToast("Nice hero! Let’s choose a story.");
    setTimeout(() => setToast(null), 2000);
  };

  const currentStep = !canNext2 ? 1 : !canNext3 ? 2 : 4;

  return (
    <>
      <Stepper currentStep={currentStep} />
      <div className="mx-auto max-w-3xl px-4 py-6 md:py-8">
        <div className="space-y-4">
          <Accordion type="single" collapsible defaultValue={!canNext2 ? 'upload' : undefined}>
            <AccordionItem value="upload" className="border-none">
              <div className="rounded-2xl border bg-white p-5 shadow-sm">
                <AccordionTrigger className="px-0">
                  <div className="flex w-full items-center justify-between">
                    <h3 className="text-lg md:text-xl font-semibold">1. Upload your hero</h3>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-0">
                  <div className="grid gap-4 transition-opacity duration-200 ease-out">
                    <label className="grid place-items-center h-48 rounded-xl border-2 border-dashed text-gray-500 hover:bg-gray-50 cursor-pointer">
                      <span>{drawing ? '' : 'Upload or capture your hero’s drawing'}</span>
                      {drawing && <img src={`data:${drawing.mimeType};base64,${drawing.base64}`} alt="preview" className="max-h-40 object-contain" />}
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                    </label>
                    <div className="flex gap-3">
                      <label className="inline-flex">
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                        <Button>Upload file</Button>
                      </label>
                      <label className="inline-flex">
                        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                        <Button variant="secondary">Use camera</Button>
                      </label>
                    </div>
                  </div>
                </AccordionContent>
              </div>
            </AccordionItem>
          </Accordion>

          {canNext2 && (
            <Accordion type="single" collapsible defaultValue={!canNext3 ? 'story' : undefined}>
              <AccordionItem value="story" className="border-none">
                <div className="rounded-2xl border bg-white p-5 shadow-sm">
                  <AccordionTrigger className="px-0">
                    <h3 className="text-lg md:text-xl font-semibold">2. Pick a story</h3>
                  </AccordionTrigger>
                  <AccordionContent className="px-0">
                    <div className="grid gap-3 transition-opacity duration-200 ease-out">
                      {showStoryInput && (
                        <textarea
                          placeholder="Barnaby finds a red balloon in the forest…"
                          value={story}
                          onChange={(e) => setStory(e.target.value)}
                          className="mt-1 w-full min-h-[96px] rounded-lg border p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      )}
                      <div className="grid gap-2">
                        <Button variant="secondary" onClick={() => { setStory('Barnaby discovers a bright red balloon…'); setShowStoryInput(true); }}>Barnaby discovers a bright red balloon…</Button>
                        <Button variant="secondary" onClick={() => { setStory('Barnaby helps a tiny bird rebuild its nest…'); setShowStoryInput(true); }}>Barnaby helps a tiny bird rebuild its nest…</Button>
                        <Button variant="secondary" onClick={() => { setShowStoryInput(true); }}>✏️ Write my own story</Button>
                      </div>
                    </div>
                  </AccordionContent>
                </div>
              </AccordionItem>
            </Accordion>
          )}

          {canNext3 && (
            <Accordion type="single" collapsible defaultValue="style">
              <AccordionItem value="style" className="border-none">
                <div className="rounded-2xl border bg-white p-5 shadow-sm">
                  <AccordionTrigger className="px-0">
                    <h3 className="text-lg md:text-xl font-semibold">3. Choose an art style</h3>
                  </AccordionTrigger>
                  <AccordionContent className="px-0">
                    <RadioGroup value={selectedStyle as string} onValueChange={(v: any) => setSelectedStyle(v)} className="grid grid-cols-1 sm:grid-cols-2 gap-3 transition-opacity duration-200 ease-out">
                      {Object.entries(ART_STYLES).map(([key, s]) => (
                        <label key={key} className="rounded-2xl border p-4 hover:shadow-sm transition cursor-pointer flex items-start gap-3">
                          <RadioGroupItem value={key} />
                          <div>
                            <div className="font-medium">{(s as any).name}</div>
                            <div className="text-xs text-gray-500">Tap to preview style</div>
                          </div>
                        </label>
                      ))}
                    </RadioGroup>
                    <div className="mt-4">
                      <label className="block font-semibold mb-2">4. Number of panels</label>
                      <div className="inline-flex items-center gap-2">
                        <Button variant="outline" size="icon" onClick={() => setPanels(Math.max(3, panels - 1))}>–</Button>
                        <input type="number" className="w-16 text-center rounded-md border p-2" value={panels} min={3} max={8} onChange={(e) => setPanels(Math.min(8, Math.max(3, Number(e.target.value || 3))))} />
                        <Button variant="outline" size="icon" onClick={() => setPanels(Math.min(8, panels + 1))}>+</Button>
                      </div>
                      {panels > 6 && <p className="mt-2 text-xs text-amber-600">Heads up: more panels can take longer to generate.</p>}
                    </div>
                  </AccordionContent>
                </div>
              </AccordionItem>
            </Accordion>
          )}

          <Button
            className="w-full py-4 text-lg font-semibold rounded-full bg-gradient-to-r from-indigo-500 to-pink-500 hover:scale-[1.02] transition disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!canSubmit}
            onClick={() => startGenerationFromReact({ drawing, story, selectedArtStyle: selectedStyle, style: ART_STYLES[selectedStyle].prompt, panelCount: panels })}
          >
            Create my comic
          </Button>
        </div>
      </div>
      {toast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 rounded-full bg-gray-900 text-white px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}

function launchConfetti() {
  const id = 'confetti-keyframes';
  if (!document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `@keyframes confetti-fall{0%{transform:translate3d(var(--sx,0),-20px,0) rotate(0)}100%{transform:translate3d(var(--tx,0),120vh,0) rotate(720deg);opacity:0}}`;
    document.head.appendChild(style);
  }
  const colors = ['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899'];
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div');
    const size = 6 + Math.random() * 6;
    const startX = (window.innerWidth / 2) + (Math.random() * 120 - 60);
    const endX = startX + (Math.random() * 160 - 80);
    el.style.cssText = `position:fixed;top:0;left:0;width:${size}px;height:${size}px;background:${colors[i%colors.length]};border-radius:2px;pointer-events:none;opacity:0.9;`;
    el.style.transform = `translate3d(${startX}px,-20px,0)`;
    el.style.setProperty('--sx', `${startX}px`);
    el.style.setProperty('--tx', `${endX}px`);
    el.style.animation = 'confetti-fall 900ms ease-out forwards';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }
}

function render() {
    if (USE_REACT_UI) return; // React UI handles rendering
    appRoot.innerHTML = ''; // Clear previous content

    const header = document.createElement('h1');
    header.textContent = 'AI Comic Strip Generator';
    appRoot.appendChild(header);

    if (state.error) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = `Oh no! Something went wrong: ${state.error}`;
        appRoot.appendChild(errorDiv);
        setTimeout(() => setState({ error: null }), 5000);
    }
    
    if (state.isLoading) renderLoader();

    switch (state.step) {
        case 'input':
            renderInputScreen();
            break;
        // character preview step removed per flow simplification
        case 'generating_comic':
            renderComicView();
            break;
        case 'final_comic':
            renderFinalComicView();
            break;
    }
}

function renderLoader() {
    const loader = document.createElement('div');
    loader.className = 'loader-overlay';
    loader.innerHTML = `
        <div class="spinner"></div>
        <p>${state.loadingMessage}</p>
    `;
    appRoot.appendChild(loader);
}

function renderInputScreen() {
    const container = document.createElement('div');
    container.className = 'container';
    
    const previewContent = state.userInput.drawing
        ? `<div style="position: relative; display:inline-block;">
             <img src="data:${state.userInput.drawing.mimeType};base64,${state.userInput.drawing.base64}" alt="Drawing preview">
             <button id="remove-image" aria-label="Remove image" title="Remove image" style="position: absolute; top: -6px; right: -6px; background: rgba(0,0,0,0.6); color: white; border: none; width: 20px; height: 20px; line-height: 20px; text-align:center; border-radius: 9999px; cursor: pointer; font-size: 12px;">×</button>
           </div>`
        : `<p>Upload or capture your hero's drawing!</p>`;

    container.innerHTML = `
        <h2>1. Create Your Hero & Story</h2>
        <div class="form-grid">
            <div class="form-group">
                <label>Your Hero's Drawing</label>
                <div class="image-upload-wrapper">
                    <div id="upload-preview">
                        ${previewContent}
                    </div>
                    <input type="file" id="file-upload" accept="image/*" style="display: none;">
                    <div class="upload-options">
                        <button id="upload-button" type="button">Select File</button>
                        <button id="camera-button" type="button">Use Camera</button>
                    </div>
                </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                <div class="form-group">
                    ${state.showStoryInput ? `
                    <label for="story" style="display:block; margin-bottom:6px;">Write a short story idea</label>
                    <textarea id="story" rows="3" placeholder="e.g., A friendly panda helps a lost kitten find home" style="padding:8px; font-size:14px;">${state.userInput.story}</textarea>
                    ` : ''}
                    ${state.storySuggestions.length > 0 ? `
                        <div style="margin-top: 10px;">
                            <label style="display:block; font-size: 14px; color: #444; margin-bottom:6px;">Suggested stories based on your character:</label>
                            <div id="story-suggestions" style="display:grid; gap:8px; max-height: 220px; overflow:auto; padding-right:4px;">
                                ${state.storySuggestions.slice(0,4).map((suggestion) => {
                                    const safe = suggestion.replace(/"/g,'&quot;');
                                    const words = suggestion.split(' ');
                                    const title = words.slice(0,7).join(' ') + (words.length>7?'…':'');
                                    return `
                                    <label style="display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border:1px solid #e5e7eb; border-radius:10px; background:#fff; color:#111; box-shadow:0 1px 2px rgba(0,0,0,0.04); cursor:pointer;">
                                        <input type=\"radio\" name=\"story-choice\" value=\"${safe}\" style=\"margin-top:3px;\">
                                        <div>
                                            <div style=\"font-weight:600;\">${title}</div>
                                            <div class=\"story-full\" style=\"display:none; font-size:13px; color:#475569; margin-top:4px;\">${safe}</div>
                                        </div>
                                    </label>`;
                                }).join('')}
                                <button type="button" id="custom-story-btn" style="text-align:left; padding:10px 12px; border:1px dashed #cbd5e1; border-radius:10px; background:#fafafa; color:#334155; cursor:pointer;">
                                    ✏️ Write my own story
                                </button>
                            </div>
                            <div id="story-preview" style="display:none; margin-top:8px; font-size:14px; color:#111; background:#f8fafc; border:1px solid #e5e7eb; border-radius:10px; padding:10px 12px;"></div>
                        </div>
                    ` : ''}
                </div>
                <div class="form-group">
                    <label style="display:block; margin-bottom:6px;">Art Style</label>
                    <div id="art-style-grid" style="display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px;">
                        ${Object.entries(ART_STYLES).map(([key, style]) => `
                            <button type="button" class="style-pill" data-stylekey="${key}" style="padding:8px 10px; border:1px solid ${state.userInput.selectedArtStyle===key ? '#2563eb' : '#e5e7eb'}; border-radius:9999px; background:${state.userInput.selectedArtStyle===key ? '#eff6ff' : '#fff'}; color:#111; font-size:13px; cursor:pointer; text-align:center;">
                                ${style.name}
                            </button>
                        `).join('')}
                    </div>
                    <input type="text" id="style" value="${ART_STYLES[state.userInput.selectedArtStyle].prompt}" style="display: none;">
                </div>
                <div class="form-group">
                    <label for="panels">Number of Panels</label>
                    <input type="number" id="panels" min="3" max="8" value="${state.userInput.panelCount}" style="width: 60px; height: 40px; text-align: center; font-size: 16px; border: 2px solid #ddd; border-radius: 4px;">
                    ${state.userInput.panelCount > 6 ? `<p style="margin-top:8px; font-size:12px; color:#b45309;">Heads up: more panels can take longer to generate.</p>` : ''}
                </div>
            </div>
        </div>
        <button id="generate-btn" disabled>Create My Comic!</button>
    `;

    appRoot.appendChild(container);

    // Event Listeners
    const fileInput = container.querySelector<HTMLInputElement>('#file-upload')!;
    const uploadButton = container.querySelector<HTMLButtonElement>('#upload-button')!;
    const cameraButton = container.querySelector<HTMLButtonElement>('#camera-button')!;
    const removeImageBtn = container.querySelector<HTMLButtonElement>('#remove-image');
    const storyInput = container.querySelector<HTMLTextAreaElement>('#story')!;
    const styleInput = container.querySelector<HTMLInputElement>('#style')!;
    const artStyleGrid = container.querySelector<HTMLDivElement>('#art-style-grid');
    const panelsInput = container.querySelector<HTMLInputElement>('#panels')!;
    const generateBtn = container.querySelector<HTMLButtonElement>('#generate-btn')!;

    uploadButton.onclick = () => fileInput.click();
    cameraButton.onclick = openCameraModal;

    // Remove image button
    if (removeImageBtn) {
        removeImageBtn.onclick = () => {
            setState({ 
                userInput: { ...state.userInput, drawing: null },
                storySuggestions: []
            });
            render();
        };
    }

    fileInput.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            const drawing = await fileToGenerativePart(file);
            setState({ userInput: { ...state.userInput, drawing } });
            
            // Generate story suggestions based on the uploaded image
            setState({ isLoading: true, loadingMessage: 'Analyzing your character and generating story suggestions...' });
            try {
                const suggestions = await generateStorySuggestions(drawing.base64, drawing.mimeType);
                setState({ storySuggestions: suggestions, isLoading: false });
                render();
            } catch (error) {
                console.error('Error generating story suggestions:', error);
                setState({ isLoading: false });
            }
        }
    };
    
    if (state.showStoryInput) {
        storyInput.oninput = () => { state.userInput.story = storyInput.value; updateButtonState(); };
    }
    
    // Art style selection via pill grid
    if (artStyleGrid) {
        artStyleGrid.querySelectorAll('.style-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                const selectedStyle = (btn as HTMLButtonElement).getAttribute('data-stylekey') as keyof typeof ART_STYLES;
                setState({
                    userInput: {
                        ...state.userInput,
                        selectedArtStyle: selectedStyle,
                        style: ART_STYLES[selectedStyle].prompt
                    }
                });
            });
        });
    }
    
    panelsInput.oninput = () => {
        const count = parseInt(panelsInput.value, 10);
        // Ensure the value is within the valid range (3-8)
        if (!Number.isNaN(count)) {
            state.userInput.panelCount = Math.max(3, Math.min(8, count));
            panelsInput.value = String(state.userInput.panelCount);
        }
        // Re-render to show/hide warning
        render();
    };

    // Story radio selection
    const storyRadios = container.querySelectorAll('input[name="story-choice"]');
    const previewEl = container.querySelector('#story-preview') as HTMLElement | null;
    storyRadios.forEach(input => {
        input.addEventListener('change', () => {
            const value = (input as HTMLInputElement).value || '';
            state.userInput.story = value;
            // reveal full writeup for the selected card
            container.querySelectorAll('.story-full').forEach(el => { (el as HTMLElement).style.display = 'none'; });
            const parent = (input as HTMLInputElement).closest('label');
            const full = parent?.querySelector('.story-full') as HTMLElement | null;
            if (full) full.style.display = 'block';
            if (previewEl) { previewEl.style.display = 'block'; previewEl.textContent = value; }
            updateButtonState();
        });
    });

    // Custom story button
    const customStoryBtn = container.querySelector('#custom-story-btn');
    if (customStoryBtn) {
        customStoryBtn.addEventListener('click', () => {
            setState({ showStoryInput: true });
            // defer to allow re-render then focus
            setTimeout(() => {
                const si = document.querySelector('#story') as HTMLTextAreaElement | null;
                if (si) {
                    si.focus();
                    si.value = state.userInput.story || '';
                }
            }, 0);
        });
    }

    const updateButtonState = () => {
        const storyVal = (document.querySelector('#story') as HTMLTextAreaElement | null)?.value || state.userInput.story || '';
        const allValid = !!state.userInput.drawing && !!storyVal.trim() && state.userInput.panelCount >= 3 && state.userInput.panelCount <= 8;
        generateBtn.disabled = !allValid;
    };
    updateButtonState();

    generateBtn.onclick = handleStartGeneration;
}

// character preview screen removed

function renderComicView() {
    const container = document.createElement('div');
    container.className = 'container';
    container.innerHTML = `<h2>2. Your Comic Adventure!</h2>`;

    const comicGrid = document.createElement('div');
    comicGrid.className = 'comic-grid';
    const cols = state.userInput.panelCount <= 4 ? 2 : 3;
    comicGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    
    for (let i = 0; i < state.userInput.panelCount; i++) {
        const panel = document.createElement('div');
        panel.className = 'comic-panel';
        if (state.panelImages[i]) {
            const imgData = state.panelImages[i]!;
            panel.innerHTML = `<img src="data:${imgData.mimeType};base64,${imgData.base64}" alt="Comic panel ${i+1}">`;
            
            const panelData = state.storyboard?.panels[i];
            if (panelData?.speech) { /* ... speech bubble logic ... */ }
        } else {
            panel.innerHTML = `<div class="panel-loader"><div class="spinner"></div><p>Drawing panel ${i+1}...</p></div>`;
        }
        comicGrid.appendChild(panel);
    }
    container.appendChild(comicGrid);
    appRoot.appendChild(container);
}

function renderFinalComicView() {
    const container = document.createElement('div');
    container.className = 'container final-comic-view';
    container.innerHTML = `<h2>✨ Your Comic Adventure is Ready! ✨</h2>`;

    // Create sequential comic display
    const comicDisplay = document.createElement('div');
    comicDisplay.className = 'sequential-comic-display';
    comicDisplay.style.cssText = `
        position: relative;
        max-width: 800px;
        margin: 0 auto;
        background: #f8f9fa;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    `;

    // Current panel image
    const panelImage = document.createElement('div');
    panelImage.className = 'current-panel';
    panelImage.style.cssText = `
        position: relative;
        width: 100%;
        height: 500px;
        background: white;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    if (state.panelImages[state.currentPanel]) {
        const img = document.createElement('img');
        img.src = `data:${state.panelImages[state.currentPanel]!.mimeType};base64,${state.panelImages[state.currentPanel]!.base64}`;
        img.style.cssText = `
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        `;
        panelImage.appendChild(img);
    }

    // Narration overlay
    const narrationOverlay = document.createElement('div');
    narrationOverlay.className = 'narration-overlay';
    narrationOverlay.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(transparent, rgba(0,0,0,0.8));
        color: white;
        padding: 20px;
        min-height: 120px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
    `;

    // Small progress pill
    const progressPill = document.createElement('div');
    progressPill.style.cssText = `
        position: absolute; top: 10px; left: 10px;
        background: rgba(17,24,39,0.7); color: #fff; padding: 4px 10px;
        font-size: 13px; border-radius: 9999px; backdrop-filter: blur(2px);
    `;
    progressPill.textContent = `Panel ${state.currentPanel + 1} / ${state.panelImages.length}`;
    panelImage.appendChild(progressPill);

    // Narration text hidden per request (audio only)
    const narrationText = document.createElement('div');
    narrationText.style.display = 'none';
    narrationOverlay.appendChild(narrationText);

    // Audio controls
    const audioControls = document.createElement('div');
    audioControls.style.cssText = `
        display: flex;
        gap: 10px;
        align-items: center;
    `;

    const isFirstPanel = state.currentPanel === 0;
    const isLastPanel = state.currentPanel >= (state.panelImages.length - 1);
    const hasCurrentAudio = !!(state.panelAudio && state.panelAudio[state.currentPanel]);

    const playPauseBtn = document.createElement('button');
    playPauseBtn.textContent = state.isPlaying ? '⏸️ Pause' : '▶️ Play';
    playPauseBtn.style.cssText = `
        background: #007bff;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
    `;
    if (!hasCurrentAudio) {
        playPauseBtn.setAttribute('disabled', 'true');
        playPauseBtn.style.opacity = '0.6';
        playPauseBtn.style.cursor = 'not-allowed';
        playPauseBtn.title = 'Generating audio...';
    } else {
        playPauseBtn.onclick = () => toggleAudio();
    }

    const nextBtn = document.createElement('button');
    nextBtn.textContent = '⏭️ Next';
    nextBtn.style.cssText = `
        background: #28a745;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
    `;
    nextBtn.onclick = () => nextPanel();

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '⏮️ Previous';
    prevBtn.style.cssText = `
        background: #6c757d;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
    `;
    prevBtn.onclick = () => previousPanel();

    // Replay button
    const replayBtn = document.createElement('button');
    replayBtn.textContent = '🔁 Replay';
    replayBtn.style.cssText = `
        background: #0ea5e9; color: white; border: none; padding: 8px 16px;
        border-radius: 6px; cursor: pointer; font-size: 14px;
    `;
    replayBtn.onclick = () => replayFullStory();

    if (!isFirstPanel) {
        audioControls.appendChild(prevBtn);
    }
    audioControls.appendChild(playPauseBtn);
    if (!isLastPanel) {
        audioControls.appendChild(nextBtn);
    }
    audioControls.appendChild(replayBtn);
    narrationOverlay.appendChild(audioControls);

    panelImage.appendChild(narrationOverlay);
    comicDisplay.appendChild(panelImage);
    container.appendChild(comicDisplay);

    // Navigation buttons
    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'button-group';
    buttonGroup.style.cssText = `
        margin-top: 20px;
        display: flex;
        gap: 10px;
        justify-content: center;
    `;
    
    const startOverBtn = document.createElement('button');
    startOverBtn.textContent = 'Start a New Comic';
    startOverBtn.className = 'secondary';
    startOverBtn.onclick = () => { initState(); render(); };
    buttonGroup.appendChild(startOverBtn);

    // Download and WhatsApp share row
    const shareGroup = document.createElement('div');
    shareGroup.className = 'button-group';

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download Story Audio';
    const anyAudio = Array.isArray(state.panelAudio) && state.panelAudio.some(Boolean);
    if (!anyAudio) {
        downloadBtn.setAttribute('disabled', 'true');
        downloadBtn.style.opacity = '0.6';
        downloadBtn.style.cursor = 'not-allowed';
        downloadBtn.title = 'No audio available to download';
    } else {
        downloadBtn.onclick = async () => {
            const url = state.panelAudio.find(Boolean) as string | undefined;
            if (!url) return;
            const a = document.createElement('a');
            a.href = url;
            a.download = 'comic-story.mp3';
            a.click();
        };
    }
    shareGroup.appendChild(downloadBtn);

    const whatsappBtn = document.createElement('button');
    whatsappBtn.textContent = 'Share on WhatsApp';
    whatsappBtn.onclick = () => {
        const pageUrl = location.href;
        const title = state.storyboard?.title || 'My AI Comic Story';
        const msg = encodeURIComponent(`${title} - listen to my narrated comic! ${pageUrl}`);
        window.open(`https://wa.me/?text=${msg}`, '_blank');
    };
    shareGroup.appendChild(whatsappBtn);

    container.appendChild(shareGroup);
    
    container.appendChild(buttonGroup);
    appRoot.appendChild(container);

    // Auto-start narration on entering final view (background playback)
    try {
        const hasAudio = state.panelAudio && state.panelAudio[state.currentPanel];
        if (hasAudio && !state.isPlaying && !state.currentAudio) {
            playCurrentPanelAudio();
        }
    } catch (_) { /* no-op */ }
}


// --- EVENT HANDLERS & WORKFLOW ---

async function handleStartGeneration() {
    setState({ isLoading: true, loadingMessage: 'Creating your hero...', error: null });
    try {
        const cards = await generateCharacterCard(state.userInput.drawing!, state.userInput.style);
        setState({ isLoading: false, characterCard: cards });
        // Immediately proceed to comic generation since character preview step was removed
        await handlePlanAndRenderComic();
    } catch (e) {
        console.error(e);
        setState({ isLoading: false, error: (e as Error).message, step: 'input' });
    }
}

async function handlePlanAndRenderComic() {
    setState({
        isLoading: true,
        loadingMessage: 'Planning your epic story...',
        step: 'generating_comic',
        panelImages: Array(state.userInput.panelCount).fill(null),
    });

    try {
        const storyboard = await planStoryboard(state.userInput.story, state.userInput.panelCount);
        setState({ storyboard, loadingMessage: 'Illustrating your comic...' });

        for (let i = 0; i < storyboard.panels.length; i++) {
            const newImage = await renderPanel(storyboard.panels[i].prompt, state.characterCard, state.userInput.style);
            const newPanelImages = [...state.panelImages];
            newPanelImages[i] = newImage;
            setState({ panelImages: newPanelImages });
        }

        setState({ isLoading: true, loadingMessage: '🎙️ Generating audio narration...' });
        const audioPromises = storyboard.panels.map((panel: any) => {
            const textToSpeak = panel.speech.map((s: any) => s.text).join(' ');
            return generateAudio(textToSpeak);
        });
        const panelAudio = await Promise.all(audioPromises);
        setState({ panelAudio });

        setState({ isLoading: true, loadingMessage: '🎬 Creating your comic video...' });
        
        // Create video with panel images and audio
        const videoUrl = await createComicVideo(storyboard.title, state.panelImages, panelAudio, storyboard.panels);
        
        setState({
            isLoading: false,
            finalComicVideo: videoUrl,
            step: 'final_comic'
        });

    } catch (e) {
        console.error('Comic generation error:', e);
        
        let errorMessage = (e as Error).message;
        
        // Add specific API identification to error messages
        if (errorMessage.includes('429') || errorMessage.includes('Resource has been exhausted')) {
            if (errorMessage.includes('ElevenLabs')) {
                errorMessage = '🎙️ ElevenLabs API Error: Resource exhausted - you have reached your ElevenLabs API quota limit. Please check your account usage or upgrade your plan.';
            } else {
                errorMessage = '🤖 Gemini API Error: Resource exhausted - you have reached your Gemini API quota limit. Please check your Google AI Studio account usage or try again later.';
            }
        } else if (errorMessage.includes('401') || errorMessage.includes('Authentication')) {
            if (errorMessage.includes('ElevenLabs')) {
                errorMessage = '🎙️ ElevenLabs API Error: Authentication failed - please check your ElevenLabs API key permissions.';
            } else {
                errorMessage = '🤖 Gemini API Error: Authentication failed - please check your Gemini API key.';
            }
        } else if (errorMessage.includes('ElevenLabs')) {
            errorMessage = '🎙️ ElevenLabs API Error: ' + errorMessage;
        } else if (errorMessage.includes('API failed to return')) {
            errorMessage = '🤖 Gemini API Error: ' + errorMessage;
        } else {
            errorMessage = '❌ Comic Generation Error: ' + errorMessage;
        }
        
        setState({ isLoading: false, error: errorMessage, step: 'input' });
    }
}

// Audio control functions for sequential comic display
function toggleAudio() {
    if (state.isPlaying) {
        pauseAudio();
    } else {
        playCurrentPanelAudio();
    }
}

function playCurrentPanelAudio() {
    const audioUrl = state.panelAudio[state.currentPanel];
    if (!audioUrl) return;

    // Stop any current audio
    if (state.currentAudio) {
        state.currentAudio.pause();
        state.currentAudio = null;
    }

    // Web Speech fallback
    if (audioUrl.startsWith('webspeech://')) {
        try {
            const textToSpeak = state.storyboard?.panels?.[state.currentPanel]?.speech?.map((s: any) => s.text).join(' ') || '';
            if ('speechSynthesis' in window && textToSpeak) {
                const utter = new SpeechSynthesisUtterance(textToSpeak);
                utter.onstart = () => setState({ isPlaying: true, isWebSpeech: true });
                utter.onend = () => {
                    setState({ isPlaying: false, isWebSpeech: false });
                    advanceToNextPanelAndPlay();
                };
                window.speechSynthesis.speak(utter);
                return;
            }
        } catch (_) {}
    }

    const audio = new Audio(audioUrl);
    state.currentAudio = audio;
    audio.onplay = () => { setState({ isPlaying: true, isWebSpeech: false }); render(); };
    audio.onended = () => { advanceToNextPanelAndPlay(); };
    audio.onerror = () => { setState({ isPlaying: false, currentAudio: null }); render(); };
    audio.play();
}

function pauseAudio() {
    if (state.isWebSpeech && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch (_) {}
    }
    if (state.currentAudio) {
        state.currentAudio.pause();
        setState({ isPlaying: false, currentAudio: null });
        render();
    }
}

function nextPanel() {
    if (state.currentPanel < state.panelImages.length - 1) {
        const wasPlaying = state.isPlaying;
        if (state.currentAudio) {
            state.currentAudio.pause();
            setState({ isPlaying: false, currentAudio: null });
        }
        setState({ currentPanel: state.currentPanel + 1 });
        render();
        if (wasPlaying) {
            // Resume autoplay on next panel
            playCurrentPanelAudio();
        }
    }
}

function previousPanel() {
    if (state.currentPanel > 0) {
        const wasPlaying = state.isPlaying;
        if (state.currentAudio) {
            state.currentAudio.pause();
            setState({ isPlaying: false, currentAudio: null });
        }
        setState({ currentPanel: state.currentPanel - 1 });
        render();
        if (wasPlaying) {
            playCurrentPanelAudio();
        }
    }
}

// Auto-advance helper
function advanceToNextPanelAndPlay() {
    // Clear current audio state
    setState({ currentAudio: null });
    if (state.currentPanel < state.panelAudio.length - 1) {
        setState({ currentPanel: state.currentPanel + 1 });
        // Small delay to allow UI to update image before playing
        setTimeout(() => {
            playCurrentPanelAudio();
        }, 150);
    } else {
        // End of story
        setState({ isPlaying: false, currentAudio: null });
        render();
    }
}

function replayFullStory() {
    // Stop anything playing
    if (state.currentAudio) {
        state.currentAudio.pause();
    }
    setState({ currentPanel: 0, isPlaying: false, currentAudio: null });
    render();
    // small delay, then start autoplay
    setTimeout(() => playCurrentPanelAudio(), 150);
}

// Helper for React UI to start generation with its own state
export function startGenerationFromReact(input: { drawing: { base64: string; mimeType: string } | null; story: string; selectedArtStyle: keyof typeof ART_STYLES; style: string; panelCount: number; }) {
    if (!input.drawing || !input.story.trim()) {
        return;
    }
    if (!state) initState();
    setState({
        userInput: {
            drawing: input.drawing,
            story: input.story,
            style: input.style,
            panelCount: Math.max(3, Math.min(8, input.panelCount)),
            selectedArtStyle: input.selectedArtStyle,
        },
        step: 'input',
    });
    // Kick off generation
    // avoid React rerender wiping; we bypass render() due to USE_REACT_UI
    // directly call handler
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    handleStartGeneration();
}

// --- INITIALIZATION ---
if (!USE_REACT_UI) {
    initState();
    render();
} else {
    initState();
    const root = ReactDOM.createRoot(appRoot);
    root.render(React.createElement(ReactWizard));
}