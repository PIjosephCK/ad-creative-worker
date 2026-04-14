You are reviewing an image generation prompt for quality before it goes to the AI image model.

## Original Prompt
{{original_prompt}}

## Scene Context
- Role: {{scene_role}} (hook = must grab attention, body = story progression, cta = call to action)
- Camera: {{camera}}
- Character: {{character_desc}}

## Review Checklist

Evaluate the prompt against these criteria:
1. Is the subject clearly and specifically described?
2. Is the action/pose explicit (not vague)?
3. Is the setting/background described?
4. Is lighting specified?
5. Are quality tags present (RAW photo, 8k, sharp focus)?
6. Is the character description complete and consistent?
7. Are there any conflicting or contradictory elements?
8. For hook scenes: does it create visual curiosity?
9. For CTA scenes: is the message clear?

## Task

Output an improved version of the prompt. Fix any issues found. Make vague descriptions specific. Add missing elements. Keep the same creative intent.

Also suggest scene-specific negative prompt additions beyond the standard negatives.

Respond with ONLY valid JSON:
{
  "refined_prompt": "the improved prompt text",
  "changes_made": ["list of changes"],
  "additional_negatives": "extra negative prompt terms specific to this scene",
  "confidence": 0.0
}