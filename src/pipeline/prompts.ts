import { AD_CREATIVE } from "../constants.js";

/**
 * Step 1 시스템 프롬프트: 자연어 한 줄 → JSON 기획서 생성 (Qwen 최적화)
 */
export function buildPlannerPrompt(
  userPrompt: string,
  totalDuration: number = AD_CREATIVE.DEFAULT_DURATION,
  imageAnalysis?: string
): string {
  const imageContext = imageAnalysis
    ? `\n## Attached Image Analysis\n${imageAnalysis}\n\nYou MUST incorporate these images into the creative plan. For "product" images, include scenes where the product naturally appears. For "style_reference" images, match the overall visual style. For "model" images, use them as the character reference.\n`
    : "";

  return `You are an expert advertising creative director specializing in short-form vertical video ads (Instagram Reels, TikTok, Meta Ads).

Given a one-line description in Korean, produce a complete creative brief as a JSON object.

## Rules

1. **Hook**: The first scene MUST be role "hook". It should create immediate visual curiosity or emotional tension within 1.5 seconds. The viewer must stop scrolling.
2. **Character consistency**: Write a DETAILED character appearance description (face shape, hair color/style, body type, skin tone, clothing). This EXACT description must be embedded in EVERY scene's imagePrompt and videoPrompt so the same person appears throughout.
3. **Scene transitions**: Each scene's transitionFrom field should describe how it connects to the previous scene's ending action, ensuring visual continuity when clips are stitched.
4. **Motion type selection**:
   - Use "veo" for scenes with significant human movement, emotional expression, or dynamic action.
   - Use "ken_burns" for static shots (product close-ups, interiors, signage, food/drink close-ups) where a slow pan/zoom suffices.
5. **Prompts in English**: imagePrompt and videoPrompt must be in English for best generation quality. textOverlay must be in Korean.
6. **Duration budget**: Total duration across all scenes must equal exactly ${totalDuration} seconds.
7. **hookVariationHints**: Provide 2-3 alternative hook concepts that could replace Scene 0 for A/B testing.
8. **Camera variety**: Mix close-up, medium shot, and wide shot across scenes for visual rhythm.
${imageContext}
## Output JSON Schema (strict)

{
  "title": "short Korean title for the creative",
  "concept": "1-2 sentence concept summary in Korean",
  "targetAudience": "inferred target audience in Korean",
  "mood": "overall mood keyword",
  "character": {
    "gender": "여성 | 남성 | 기타",
    "ageRange": "e.g. 20대 초반",
    "appearance": "detailed physical description in English",
    "outfit": "detailed clothing description in English",
    "styleRef": "natural | editorial | cinematic"
  },
  "scenes": [
    {
      "index": 0,
      "role": "hook | body | cta",
      "description": "scene description in Korean",
      "imagePrompt": "English prompt optimized for image generation. MUST include full character appearance description.",
      "videoPrompt": "English prompt optimized for video generation. MUST include full character appearance and motion description.",
      "textOverlay": "Korean text or null",
      "duration": 3,
      "motionType": "veo | ken_burns",
      "kenBurnsDirection": "zoom_in | zoom_out | pan_left | pan_right (only if ken_burns)",
      "camera": "close-up | medium shot | wide shot",
      "transitionFrom": "description of how this scene connects from previous scene's ending"
    }
  ],
  "bgm": {
    "mood": "mood keyword",
    "tempo": "slow | medium | fast",
    "genre": "e.g. lo-fi, acoustic, electronic"
  },
  "hookVariationHints": ["alternative hook idea 1 in Korean", "alternative hook idea 2 in Korean"]
}

## User Input

"${userPrompt}"

You MUST respond with ONLY a valid JSON object. No markdown fences, no explanation before or after the JSON. Do not include any text outside the JSON.`;
}

/**
 * 캐릭터 이미지 생성 프롬프트 (Flux.1-dev 최적화)
 */
export function buildCharacterPrompt(
  character: {
    gender: string;
    ageRange: string;
    appearance: string;
    outfit: string;
    styleRef: string;
  },
  candidateIndex: number
): string {
  const styleMap: Record<string, string> = {
    natural:
      "natural lighting, candid photography style, soft bokeh background, photorealistic",
    editorial:
      "editorial fashion photography, studio-quality lighting, clean background, photorealistic",
    cinematic:
      "cinematic color grading, dramatic lighting, shallow depth of field, photorealistic",
  };
  const style = styleMap[character.styleRef] || styleMap.natural;

  const poseVariations = [
    "slight head tilt to the left, confident smile",
    "looking directly at camera, neutral expression with soft eyes",
    "three-quarter view, gentle smile, hand near chin",
  ];
  const pose = poseVariations[candidateIndex] || poseVariations[0];

  return `upper body portrait of a person for advertising campaign, ${character.appearance}, wearing ${character.outfit}, ${character.ageRange}, ${character.gender}, ${pose}, ${style}, masterpiece, best quality, high resolution, 9:16 vertical aspect ratio`;
}

/**
 * 씬 이미지 생성 프롬프트 (Flux.1-dev + IP-Adapter 최적화)
 * IP-Adapter가 캐릭터 일관성을 담당하므로 프롬프트는 씬 묘사에 집중
 */
export function buildSceneImagePrompt(
  scene: {
    imagePrompt: string;
    camera: string;
    role: string;
  },
  characterDesc: string
): string {
  return `${scene.imagePrompt}, ${characterDesc}, ${scene.camera} shot, photorealistic, masterpiece, best quality, high resolution, 9:16 vertical aspect ratio, advertising photography`;
}

/**
 * 제품 합성 씬 프롬프트 (인페인팅용)
 */
export function buildProductScenePrompt(
  scene: {
    imagePrompt: string;
    camera: string;
  },
  characterDesc: string,
  productDesc: string
): string {
  return `${scene.imagePrompt}, ${characterDesc}, holding or near ${productDesc}, ${scene.camera} shot, photorealistic, masterpiece, best quality, product placement, advertising photography, 9:16 vertical`;
}

/**
 * 이미지 분석 프롬프트 (Qwen-VL용)
 */
export function buildImageAnalysisPrompt(imageCount: number): string {
  return `Analyze the attached ${imageCount} image(s) for use in an advertising creative pipeline.

For each image, determine:
1. type: "product" (packaged product, item to sell), "style_reference" (mood/aesthetic reference), "model" (person/character to use), or "brand_asset" (logo, CI element)
2. description: brief description of what's in the image
3. dominantColors: 2-3 hex color codes
4. suggestedUse: "scene_composite" (composite into scenes), "style_transfer" (use as style ref), "character_ref" (use as character), "overlay" (overlay on final output)

Respond with ONLY a valid JSON object:
{
  "images": [
    { "index": 0, "type": "...", "description": "...", "dominantColors": ["#xxx"], "suggestedUse": "..." }
  ]
}`;
}

/**
 * Negative prompt (ComfyUI 공통)
 */
export function getNegativePrompt(): string {
  return "worst quality, low quality, blurry, deformed, disfigured, extra limbs, bad anatomy, text, watermark, signature, cropped, out of frame, ugly, duplicate";
}
