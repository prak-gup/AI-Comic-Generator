/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Type, Modality, Part } from "@google/genai";

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
    };
    characterCard: { base64: string; mimeType: string }[];
    storyboard: any | null;
    panelImages: ({ base64: string; mimeType: string } | null)[];
    panelAudio: (string | null)[];
    finalComicImage: { base64: string; mimeType: string } | null;
}

let state: AppState;

function initState(): void {
    state = {
        step: 'input',
        isLoading: false,
        loadingMessage: '',
        error: null,
        userInput: {
            drawing: null,
            story: 'A hero dog flies in to save a cat stuck in a tree.',
            style: 'A vibrant and colorful cartoon with bold outlines.',
            panelCount: 4,
        },
        characterCard: [],
        storyboard: null,
        panelImages: [],
        panelAudio: [],
        finalComicImage: null,
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
        const textPart = { text: `You are a kid-friendly visual director. Preserve the child's drawing identity and style. 
    Keep the same costume colors and face shape. Avoid realism; keep a playful cartoon look.
    Strictly output only the image, no text.
    
    Create a character from this drawing. Style: ${style}. Pose: ${pose}.` };
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
    const systemInstruction = `You turn a 1-2 sentence parent/child story into a ${panelCount}-panel storyboard for a children's comic.
    Include camera notes (wide/medium/close), setting details, and short speech lines suitable for ages 5-10.
    Keep it wholesome and positive. Output valid JSON.`;
    
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
    const textPrompt = `You are a consistent scene illustrator. Strictly preserve the hero's look from the reference images.
    Keep style: ${style}. Keep continuity across panels. Avoid realism. Optimize for kid-safe content.
    The image should be text-free as speech bubbles will be added later.
    
    Create Panel. Scene prompt: ${panelPrompt}`;
    
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
        const r = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (!r.ok) throw new Error(`tts ${r.status}`);
        
        // Check if response is JSON (new format) or blob (audio)
        const contentType = r.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const result = await r.json();
            console.log('TTS response:', result.message);
            return null; // No audio for now due to API key permissions
        } else {
            const blob = await r.blob();
            return URL.createObjectURL(blob);
        }
    } catch (e) {
        console.error('tts error', e);
        return null;
    }
}

/**
 * Uses Fal.ai to generate a final comic strip layout via server proxy.
 */
async function generateComicLayout(title: string, panels: { image: { base64: string }, caption: string }[]): Promise<{ base64: string, mimeType: string }> {
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

function render() {
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
        case 'character_preview':
            renderCharacterPreview();
            break;
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
        ? `<img src="data:${state.userInput.drawing.mimeType};base64,${state.userInput.drawing.base64}" alt="Drawing preview">`
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
                    <label for="story">Tell us your story in 1-2 lines</label>
                    <textarea id="story" rows="4">${state.userInput.story}</textarea>
                </div>
                <div class="form-group">
                    <label for="style">Art Style</label>
                    <input type="text" id="style" value="${state.userInput.style}">
                </div>
                <div class="form-group">
                    <label for="panels">Number of Panels: <span id="panels-value">${state.userInput.panelCount}</span></label>
                    <input type="range" id="panels" min="3" max="6" value="${state.userInput.panelCount}">
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
    const storyInput = container.querySelector<HTMLTextAreaElement>('#story')!;
    const styleInput = container.querySelector<HTMLInputElement>('#style')!;
    const panelsInput = container.querySelector<HTMLInputElement>('#panels')!;
    const generateBtn = container.querySelector<HTMLButtonElement>('#generate-btn')!;
    const panelsValue = container.querySelector<HTMLSpanElement>('#panels-value')!;

    uploadButton.onclick = () => fileInput.click();
    cameraButton.onclick = openCameraModal;

    fileInput.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            const drawing = await fileToGenerativePart(file);
            setState({ userInput: { ...state.userInput, drawing } });
        }
    };
    
    storyInput.oninput = () => { state.userInput.story = storyInput.value; updateButtonState(); };
    styleInput.oninput = () => state.userInput.style = styleInput.value;
    panelsInput.oninput = () => {
        const count = parseInt(panelsInput.value, 10);
        panelsValue.textContent = count.toString();
        state.userInput.panelCount = count;
    };

    const updateButtonState = () => { generateBtn.disabled = !state.userInput.drawing || !storyInput.value.trim(); };
    updateButtonState();

    generateBtn.onclick = handleStartGeneration;
}

function renderCharacterPreview() {
    const container = document.createElement('div');
    container.className = 'container character-preview';
    container.innerHTML = `<h2>2. Meet Your Hero!</h2>`;
    
    const grid = document.createElement('div');
    grid.className = 'character-grid';
    const poses = ['Front View', '3/4 View', 'Action Pose'];
    state.characterCard.forEach((card, i) => {
        grid.innerHTML += `
            <div class="character-card">
                <img src="data:${card.mimeType};base64,${card.base64}" alt="Character pose ${i+1}">
                <p>${poses[i]}</p>
            </div>
        `;
    });
    container.appendChild(grid);

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'button-group';
    
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = "Looks Good, Let's Go!";
    confirmBtn.onclick = handlePlanAndRenderComic;
    buttonGroup.appendChild(confirmBtn);
    
    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Try Again';
    retryBtn.className = 'secondary';
    retryBtn.onclick = handleStartGeneration;
    buttonGroup.appendChild(retryBtn);

    container.appendChild(buttonGroup);
    appRoot.appendChild(container);
}

function renderComicView() {
    const container = document.createElement('div');
    container.className = 'container';
    container.innerHTML = `<h2>3. Your Comic Adventure!</h2>`;

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

    if (state.finalComicImage) {
        const comicHolder = document.createElement('div');
        comicHolder.className = 'final-comic-holder';
        comicHolder.innerHTML = `<img src="data:${state.finalComicImage.mimeType};base64,${state.finalComicImage.base64}" alt="Final comic strip">`;
        container.appendChild(comicHolder);
    } else {
        // Fallback to showing the grid if the final layout failed
        container.innerHTML += `<p>Here are your generated panels:</p>`;
        const comicGrid = document.createElement('div');
        comicGrid.className = 'comic-grid';
        const cols = state.userInput.panelCount <= 4 ? 2 : 3;
        comicGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        state.panelImages.forEach((imgData, i) => {
            if (!imgData) return;
            const panel = document.createElement('div');
            panel.className = 'comic-panel';
            panel.innerHTML = `<img src="data:${imgData.mimeType};base64,${imgData.base64}" alt="Comic panel ${i+1}">`;
            comicGrid.appendChild(panel);
        });
        container.appendChild(comicGrid);
    }

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'button-group';

    if (state.panelAudio.some(a => a)) {
        const playBtn = document.createElement('button');
        playBtn.textContent = '▶️ Play Full Story';
        playBtn.onclick = playFullStory;
        buttonGroup.appendChild(playBtn);
    }
    
    const startOverBtn = document.createElement('button');
    startOverBtn.textContent = 'Start a New Comic';
    startOverBtn.className = 'secondary';
    startOverBtn.onclick = () => { initState(); render(); };
    buttonGroup.appendChild(startOverBtn);
    
    container.appendChild(buttonGroup);
    appRoot.appendChild(container);
}


// --- EVENT HANDLERS & WORKFLOW ---

async function handleStartGeneration() {
    setState({ isLoading: true, loadingMessage: 'Creating your hero...', error: null });
    try {
        const cards = await generateCharacterCard(state.userInput.drawing!, state.userInput.style);
        setState({ isLoading: false, characterCard: cards, step: 'character_preview' });
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

        setState({ isLoading: true, loadingMessage: '🎨 Assembling final comic strip...' });
        const panelDataForLayout = state.panelImages.map((img, i) => ({
          image: img!,
          caption: storyboard.panels[i].speech.find((s:any) => s.who.toLowerCase() === 'narrator')?.text || ''
        }));

        const finalImage = await generateComicLayout(storyboard.title, panelDataForLayout);
        setState({
            isLoading: false,
            finalComicImage: finalImage,
            step: 'final_comic'
        });

    } catch (e) {
        console.error(e);
        setState({ isLoading: false, error: (e as Error).message, step: 'input' });
    }
}

function playFullStory() {
    const audioUrls = state.panelAudio.filter(url => url) as string[];
    if (audioUrls.length === 0) return;

    let currentAudioIndex = 0;
    const audio = new Audio();

    audio.onended = () => {
        currentAudioIndex++;
        if (currentAudioIndex < audioUrls.length) {
            audio.src = audioUrls[currentAudioIndex];
            audio.play();
        }
    };
    
    audio.src = audioUrls[0];
    audio.play();
}

// --- INITIALIZATION ---
initState();
render();