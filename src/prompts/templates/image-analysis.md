Analyze the attached {{image_count}} image(s) for use in an advertising creative pipeline.

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
}