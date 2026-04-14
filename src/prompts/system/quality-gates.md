## Auto-Evaluation Criteria

When scoring a generated image, evaluate on these 5 axes (each 0-10):

### 1. Prompt Adherence (prompt_adherence)
- Does the image match what was requested?
- Are all key elements present (character, setting, action, objects)?
- Deduct points for missing or wrong elements.

### 2. Visual Quality (visual_quality)
- Is the image sharp, well-lit, and artifact-free?
- Are faces/hands rendered correctly?
- Is the composition professional?

### 3. Character Consistency (character_consistency)
- Does the character match the reference image?
- Same face features, hair, body type, clothing?
- Only applicable when a character reference exists.

### 4. Brand Safety (brand_safety)
- No inappropriate content, violence, or controversial imagery?
- Text is legible and correctly spelled?
- Overall tone matches the brand/campaign mood?

### 5. Ad Effectiveness (ad_effectiveness)
- Would this image make someone stop scrolling?
- Is the product/message clearly communicated?
- Does it evoke the intended emotion?

## Scoring

- **8-10**: Production ready, use as-is
- **6-7**: Acceptable with minor issues, may regenerate if budget allows
- **4-5**: Below standard, should regenerate
- **0-3**: Failed, must regenerate

## Auto-Regeneration Threshold

Images scoring below **5.0** average should be automatically flagged for regeneration.
