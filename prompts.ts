/**
 * AI Comic Generator - Prompts Configuration
 * This file contains all the prompts used throughout the application
 */

export const ART_STYLES = {
  ghibli: {
    name: "Studio Ghibli",
    description: "Whimsical and magical with soft, dreamy colors and detailed backgrounds",
    prompt: "Studio Ghibli style with soft watercolor-like textures, magical lighting, detailed backgrounds with lush nature, gentle character expressions, and a dreamy, whimsical atmosphere. Use muted pastels and earth tones."
  },
  disney: {
    name: "Disney Classic",
    description: "Bright, colorful, and expressive with bold character designs",
    prompt: "Disney classic animation style with bold, expressive character designs, bright and vibrant colors, smooth rounded shapes, large expressive eyes, and a cheerful, optimistic atmosphere. Clean lines and polished look."
  },
  "3d": {
    name: "3D Animation",
    description: "Modern 3D rendered look with depth and realistic lighting",
    prompt: "Modern 3D animation style with realistic lighting, depth of field, soft shadows, and smooth surfaces. Characters should have a polished, rendered appearance with subtle textures and professional lighting effects."
  },
  claymation: {
    name: "Claymation",
    description: "Hand-crafted clay animation with textured, organic feel",
    prompt: "Claymation style with visible clay textures, organic shapes, hand-crafted appearance, soft lighting, and a warm, tactile feel. Characters should look like they're made of clay with visible fingerprints and natural imperfections."
  }
} as const;

export const STORY_SUGGESTIONS = {
  // These will be generated dynamically based on uploaded image
  default: [
    "A brave hero goes on an exciting adventure",
    "A magical creature helps solve a problem",
    "A friendship story with a happy ending",
    "A hero saves the day with kindness"
  ]
};

export const CHARACTER_CONSISTENCY_PROMPT = `CRITICAL: Maintain exact character consistency across all panels.

CHARACTER CONSISTENCY RULES:
- Use the reference images as the EXACT visual guide for character appearance
- Keep the same facial features, body proportions, clothing, and colors in every panel
- If the character is a panda, maintain the same black and white pattern, same clothing, same accessories
- If the character is an animal, keep the same fur color, markings, and physical characteristics
- Only change the character's pose and expression, NEVER their basic appearance`;

export const STORYBOARD_SYSTEM_INSTRUCTION = (panelCount: number) => `You turn a 1-2 sentence parent/child story into a ${panelCount}-panel storyboard for a children's comic.
Include camera notes (wide/medium/close), setting details, and engaging speech lines suitable for ages 5-10.
Keep it wholesome and positive. 

NARRATION REQUIREMENTS:
- Make each panel's narration 2-3 sentences long for better storytelling
- Use descriptive language that paints a picture for children
- Include emotions, sounds, and actions to make it engaging
- Use simple but vivid vocabulary that children can understand
- Make the story flow naturally from panel to panel

CHARACTER CONSISTENCY:
- Always describe the main character with the same physical features, clothing, and appearance in every panel
- Use specific details like "black and white panda with brown gi and yellow belt" or "orange tabby cat with white paws"
- Ensure visual consistency across all panels

Output valid JSON.`;

export const CHARACTER_GENERATION_PROMPT = (style: string, pose: string) => `You are a kid-friendly visual director. Preserve the child's drawing identity and style. 
Keep the same costume colors and face shape. Avoid realism; keep a playful cartoon look.
Strictly output only the image, no text.

Create a character from this drawing. Style: ${style}. Pose: ${pose}.`;

export const PANEL_RENDERING_PROMPT = (panelPrompt: string, style: string) => `You are a consistent scene illustrator. ${CHARACTER_CONSISTENCY_PROMPT}

Style: ${style}. Keep continuity across panels. Avoid realism. Optimize for kid-safe content.
The image should be text-free as speech bubbles will be added later.

Create Panel. Scene prompt: ${panelPrompt}`;

export const STORY_SUGGESTION_PROMPT = (imageDescription: string) => `Based on this character image: "${imageDescription}"

Generate 3 child-friendly story suggestions (1-2 sentences each) that would work well with this character. The stories should be:
- Age-appropriate for children 5-10 years old
- Wholesome and positive
- Engaging and fun
- Suitable for a 4-panel comic strip

Return as a JSON array of strings.`;
