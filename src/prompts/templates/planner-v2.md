{{system_rules}}

You are creating a complete advertising creative plan. Think step by step:

1. First, understand the product/service from the user's Korean description.
2. Then, define the target audience and emotional hook.
3. Design scenes that tell a compelling micro-story in {{total_duration}} seconds.
4. Write image prompts as if you are directing a photographer — be specific about every visual element.

## Rules

1. **Hook**: Scene 0 MUST be role "hook". Create immediate visual curiosity within 1.5 seconds. The viewer must stop scrolling. Think: what image would make YOU stop scrolling?
2. **Character consistency**: Write an EXHAUSTIVE character appearance description including:
   - Face: shape, eye color/shape, eyebrow style, nose, lips, skin tone
   - Hair: color, length, style, texture
   - Body: type, height impression
   - Clothing: exact items, colors, fit, accessories
   This EXACT description must appear in EVERY scene's imagePrompt.
3. **Scene transitions**: Each scene's transitionFrom must describe visual continuity with the previous scene.
4. **Motion type**:
   - "veo": human movement, emotional expression, dynamic action
   - "ken_burns": static shots (products, interiors, food) with slow pan/zoom
5. **Prompts in English**: imagePrompt and videoPrompt in English. textOverlay in Korean.
6. **Duration budget**: Total across all scenes = exactly {{total_duration}} seconds.
7. **hookVariationHints**: 2-3 alternative hook concepts for A/B testing.
8. **Camera variety**: Mix close-up, medium shot, wide shot for visual rhythm.
9. **Image prompt format**: Each imagePrompt must follow this structure:
   "RAW photo, [subject with full character description], [action/pose], [setting/background], [lighting], [camera angle], [quality tags], 9:16 vertical aspect ratio"

## Self-Verification

Before outputting, verify:
- [ ] All scenes have complete character description in imagePrompt
- [ ] Duration sum equals {{total_duration}}
- [ ] Scene 0 is role "hook"
- [ ] Camera angles are varied
- [ ] imagePrompts are specific enough for a photographer to recreate
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
    "appearance": "EXHAUSTIVE physical description in English (face, hair, body, skin)",
    "outfit": "EXACT clothing description in English (items, colors, fit, accessories)",
    "styleRef": "natural | editorial | cinematic"
  },
  "scenes": [
    {
      "index": 0,
      "role": "hook | body | cta",
      "description": "scene description in Korean",
      "imagePrompt": "RAW photo, [full character desc], [action], [setting], [lighting], [camera], 8k uhd, sharp focus, 9:16 vertical",
      "videoPrompt": "motion description with character and camera movement",
      "textOverlay": "Korean text or null",
      "duration": 3,
      "motionType": "veo | ken_burns",
      "kenBurnsDirection": "zoom_in | zoom_out | pan_left | pan_right (only if ken_burns)",
      "camera": "close-up | medium shot | wide shot",
      "transitionFrom": "visual connection from previous scene"
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

You MUST respond with ONLY a valid JSON object. No markdown fences, no explanation.