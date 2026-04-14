{{system_rules}}

Given a one-line description in Korean, produce a complete creative brief as a JSON object.

## Rules

1. **Hook**: The first scene MUST be role "hook". It should create immediate visual curiosity or emotional tension within 1.5 seconds. The viewer must stop scrolling.
2. **Character consistency**: Write a DETAILED character appearance description (face shape, hair color/style, body type, skin tone, clothing). This EXACT description must be embedded in EVERY scene's imagePrompt and videoPrompt so the same person appears throughout.
3. **Scene transitions**: Each scene's transitionFrom field should describe how it connects to the previous scene's ending action, ensuring visual continuity when clips are stitched.
4. **Motion type selection**:
   - Use "veo" for scenes with significant human movement, emotional expression, or dynamic action.
   - Use "ken_burns" for static shots (product close-ups, interiors, signage, food/drink close-ups) where a slow pan/zoom suffices.
5. **Prompts in English**: imagePrompt and videoPrompt must be in English for best generation quality. textOverlay must be in Korean.
6. **Duration budget**: Total duration across all scenes must equal exactly {{total_duration}} seconds.
7. **hookVariationHints**: Provide 2-3 alternative hook concepts that could replace Scene 0 for A/B testing.
8. **Camera variety**: Mix close-up, medium shot, and wide shot across scenes for visual rhythm.
{{image_context}}
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

{{override_rules}}

## User Input

"{{user_prompt}}"

You MUST respond with ONLY a valid JSON object. No markdown fences, no explanation before or after the JSON. Do not include any text outside the JSON.
