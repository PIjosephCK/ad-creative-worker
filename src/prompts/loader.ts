import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In-memory cache: template name → content
const cache = new Map<string, string>();

/**
 * 템플릿 파일을 읽어 캐싱한다.
 * 개발 중에는 캐시를 비활성화할 수 있다.
 */
async function readTemplate(
  category: "system" | "templates" | "overrides",
  name: string
): Promise<string> {
  const key = `${category}/${name}`;
  if (!process.env.PROMPT_NO_CACHE && cache.has(key)) {
    return cache.get(key)!;
  }

  const filePath = path.join(__dirname, category, name);
  const content = await fs.readFile(filePath, "utf-8");
  cache.set(key, content);
  return content;
}

/**
 * 템플릿 문자열에서 {{key}} 변수를 치환한다.
 */
function interpolate(
  template: string,
  variables: Record<string, string | number>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = variables[key];
    return val !== undefined ? String(val) : "";
  });
}

/**
 * 캠페인별 오버라이드 규칙을 로딩한다.
 * 파일이 없으면 빈 문자열 반환 (오버라이드 없음).
 */
async function loadOverride(campaignId?: string): Promise<string> {
  if (!campaignId) return "";
  try {
    const override = await readTemplate("overrides", `${campaignId}.json`);
    const parsed = JSON.parse(override) as CampaignOverride;
    const parts: string[] = [];

    if (parsed.styleGuide) {
      parts.push(`## Campaign Style Guide\n${parsed.styleGuide}`);
    }
    if (parsed.additionalRules?.length) {
      parts.push(
        `## Campaign-Specific Rules\n${parsed.additionalRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
      );
    }
    if (parsed.negativePromptAppend) {
      parts.push(
        `## Additional Negative Prompt\n${parsed.negativePromptAppend}`
      );
    }
    if (parsed.characterOverride) {
      parts.push(
        `## Character Override\n${JSON.stringify(parsed.characterOverride, null, 2)}`
      );
    }

    return parts.length > 0 ? "\n" + parts.join("\n\n") : "";
  } catch {
    return "";
  }
}

/** 캠페인 오버라이드 JSON 스키마 */
export interface CampaignOverride {
  campaignId: string;
  styleGuide?: string;
  additionalRules?: string[];
  negativePromptAppend?: string;
  characterOverride?: {
    appearance?: string;
    outfit?: string;
    styleRef?: string;
  };
  qualityThreshold?: number; // 평가 점수 기준 오버라이드
  promptSuffix?: string; // 모든 이미지 프롬프트에 추가될 접미사
}

// ─── Public API ───

/**
 * 기획 프롬프트 조립: system rules + planner template + override
 */
export async function buildPlannerPrompt(
  userPrompt: string,
  options: {
    totalDuration?: number;
    imageAnalysis?: string;
    campaignId?: string;
  } = {}
): Promise<{ prompt: string; systemRules: string }> {
  const systemRules = await readTemplate("system", "base-rules.md");
  const template = await readTemplate("templates", "planner.md");
  const overrideRules = await loadOverride(options.campaignId);

  const imageContext = options.imageAnalysis
    ? `\n## Attached Image Analysis\n${options.imageAnalysis}\n\nYou MUST incorporate these images into the creative plan. For "product" images, include scenes where the product naturally appears. For "style_reference" images, match the overall visual style. For "model" images, use them as the character reference.\n`
    : "";

  const prompt = interpolate(template, {
    system_rules: systemRules,
    total_duration: options.totalDuration ?? 45,
    image_context: imageContext,
    override_rules: overrideRules,
    user_prompt: userPrompt,
  });

  return { prompt, systemRules };
}

/**
 * 캐릭터 이미지 프롬프트 조립
 */
export async function buildCharacterPrompt(
  character: {
    gender: string;
    ageRange: string;
    appearance: string;
    outfit: string;
    styleRef: string;
  },
  candidateIndex: number,
  campaignId?: string
): Promise<string> {
  const template = await readTemplate("templates", "character.md");

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

  let prompt = interpolate(template, {
    appearance: character.appearance,
    outfit: character.outfit,
    age_range: character.ageRange,
    gender: character.gender,
    pose,
    style,
  });

  // 캠페인 오버라이드: promptSuffix 추가
  if (campaignId) {
    const override = await loadCampaignOverride(campaignId);
    if (override?.promptSuffix) {
      prompt += `, ${override.promptSuffix}`;
    }
  }

  return prompt;
}

/**
 * 씬 이미지 프롬프트 조립
 */
export async function buildSceneImagePrompt(
  scene: { imagePrompt: string; camera: string; role: string },
  characterDesc: string,
  campaignId?: string
): Promise<string> {
  const template = await readTemplate("templates", "scene-image.md");

  let prompt = interpolate(template, {
    image_prompt: scene.imagePrompt,
    character_desc: characterDesc,
    camera: scene.camera,
  });

  if (campaignId) {
    const override = await loadCampaignOverride(campaignId);
    if (override?.promptSuffix) {
      prompt += `, ${override.promptSuffix}`;
    }
  }

  return prompt;
}

/**
 * 제품 합성 씬 프롬프트 조립
 */
export async function buildProductScenePrompt(
  scene: { imagePrompt: string; camera: string },
  characterDesc: string,
  productDesc: string,
  campaignId?: string
): Promise<string> {
  const template = await readTemplate("templates", "product-scene.md");

  let prompt = interpolate(template, {
    image_prompt: scene.imagePrompt,
    character_desc: characterDesc,
    product_desc: productDesc,
    camera: scene.camera,
  });

  if (campaignId) {
    const override = await loadCampaignOverride(campaignId);
    if (override?.promptSuffix) {
      prompt += `, ${override.promptSuffix}`;
    }
  }

  return prompt;
}

/**
 * 이미지 분석 프롬프트 조립
 */
export async function buildImageAnalysisPrompt(
  imageCount: number
): Promise<string> {
  const template = await readTemplate("templates", "image-analysis.md");
  return interpolate(template, { image_count: imageCount });
}

/**
 * 이미지 평가 프롬프트 조립
 */
export async function buildEvaluateImagePrompt(options: {
  originalPrompt: string;
  sceneRole: string;
  camera: string;
  mood: string;
}): Promise<string> {
  const template = await readTemplate("templates", "evaluate-image.md");
  return interpolate(template, {
    original_prompt: options.originalPrompt,
    scene_role: options.sceneRole,
    camera: options.camera,
    mood: options.mood,
  });
}

/**
 * 네거티브 프롬프트 조립 (캠페인별 추가 가능)
 */
export async function getNegativePrompt(
  campaignId?: string
): Promise<string> {
  const base = await readTemplate("templates", "negative.md");

  if (campaignId) {
    const override = await loadCampaignOverride(campaignId);
    if (override?.negativePromptAppend) {
      return `${base}, ${override.negativePromptAppend}`;
    }
  }

  return base;
}

/**
 * 캠페인 오버라이드 JSON 로딩 (캐싱)
 */
async function loadCampaignOverride(
  campaignId: string
): Promise<CampaignOverride | null> {
  try {
    const raw = await readTemplate("overrides", `${campaignId}.json`);
    return JSON.parse(raw) as CampaignOverride;
  } catch {
    return null;
  }
}

/**
 * 품질 평가 기준 점수 로딩
 */
export async function getQualityThreshold(
  campaignId?: string
): Promise<number> {
  const DEFAULT_THRESHOLD = 5.0;
  if (campaignId) {
    const override = await loadCampaignOverride(campaignId);
    if (override?.qualityThreshold) return override.qualityThreshold;
  }
  return DEFAULT_THRESHOLD;
}

/**
 * 캐시 초기화 (개발/테스트용)
 */
export function clearPromptCache(): void {
  cache.clear();
}
