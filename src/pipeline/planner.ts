import { generateContent, extractJson } from "../ai/ollama.js";
import { AD_CREATIVE } from "../constants.js";
import { creativePlanSchema, type CreativePlanJson } from "./types.js";
import { buildPlannerPrompt } from "./prompts.js";

/**
 * Step 1: 자연어 한 줄 → JSON 기획서 생성
 * Qwen3-8B via Ollama로 광고 크리에이티브 기획 JSON을 생성한다.
 * JSON 안정성을 위해 최대 3회 재시도.
 */
export async function generateCreativePlan(
  prompt: string,
  options?: {
    totalDuration?: number;
    imageAnalysis?: string;
    campaignId?: string;
  }
): Promise<{ plan: CreativePlanJson; systemRules: string }> {
  const totalDuration = options?.totalDuration || AD_CREATIVE.DEFAULT_DURATION;
  const { prompt: plannerPrompt, systemRules } = await buildPlannerPrompt(
    prompt,
    {
      totalDuration,
      imageAnalysis: options?.imageAnalysis,
      campaignId: options?.campaignId,
    }
  );

  let lastError: string = "";

  for (let attempt = 0; attempt < AD_CREATIVE.PLAN_JSON_MAX_RETRIES; attempt++) {
    const promptWithRetry =
      attempt === 0
        ? plannerPrompt
        : `${plannerPrompt}\n\n[RETRY ${attempt}/${AD_CREATIVE.PLAN_JSON_MAX_RETRIES}] The previous response was not valid JSON. Error: ${lastError}\nPlease output ONLY a valid JSON object with no extra text.`;

    const raw = await generateContent(promptWithRetry, {
      systemPrompt: systemRules,
      temperature: AD_CREATIVE.PLAN_TEMPERATURE,
      maxTokens: AD_CREATIVE.PLAN_MAX_TOKENS,
      jsonMode: true,
    });

    const json = extractJson(raw);
    if (!json) {
      lastError = "응답에서 JSON을 추출할 수 없습니다.";
      continue;
    }

    try {
      return { plan: validatePlan(json, totalDuration), systemRules };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  throw new Error(
    `기획서 JSON 생성에 실패했습니다 (${AD_CREATIVE.PLAN_JSON_MAX_RETRIES}회 시도). 마지막 에러: ${lastError}`
  );
}

/** @internal planner 내부에서만 사용 — plan만 필요한 기존 호출 호환용 */
export async function generateCreativePlanCompat(
  prompt: string,
  options?: {
    totalDuration?: number;
    imageAnalysis?: string;
    campaignId?: string;
  }
): Promise<CreativePlanJson> {
  const { plan } = await generateCreativePlan(prompt, options);
  return plan;
}

function validatePlan(
  json: Record<string, unknown>,
  totalDuration: number
): CreativePlanJson {
  // Qwen이 null을 넣는 경우 optional 필드를 정리
  if (Array.isArray((json as any).scenes)) {
    for (const scene of (json as any).scenes) {
      if (scene.kenBurnsDirection === null) delete scene.kenBurnsDirection;
      if (scene.transitionFrom === null) delete scene.transitionFrom;
      if (scene.textOverlay === null) scene.textOverlay = null; // nullable 허용
    }
  }
  const result = creativePlanSchema.safeParse(json);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new Error(`기획서 검증 실패: ${errors}`);
  }

  const plan = result.data;
  const totalSceneDuration = plan.scenes.reduce(
    (sum, s) => sum + s.duration,
    0
  );
  if (totalSceneDuration !== totalDuration) {
    console.warn(
      `씬 duration 합계(${totalSceneDuration}초)가 목표(${totalDuration}초)와 다릅니다.`
    );
  }

  return plan;
}
