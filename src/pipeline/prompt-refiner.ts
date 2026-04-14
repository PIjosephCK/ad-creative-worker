import { generateContent, extractJson } from "../ai/ollama.js";
import { buildEvaluateImagePrompt } from "../prompts/loader.js";
import fs from "fs/promises";
import path from "path";

interface RefineResult {
  refinedPrompt: string;
  changesMade: string[];
  additionalNegatives: string;
  confidence: number;
}

const REFINER_SYSTEM = `You are a prompt engineering expert specializing in Stable Diffusion and Flux.1 image generation models. Your job is to review and improve image generation prompts for advertising photography. Be specific, concrete, and actionable.`;

/**
 * Qwen으로 이미지 프롬프트를 검토/개선한다.
 * Claude Code의 "자기 검증" 패턴 적용.
 */
export async function refineImagePrompt(options: {
  originalPrompt: string;
  sceneRole: string;
  camera: string;
  characterDesc: string;
}): Promise<RefineResult> {
  const template = await fs.readFile(
    path.join(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
      "..",
      "prompts",
      "templates",
      "prompt-refiner.md"
    ),
    "utf-8"
  );

  const prompt = template
    .replace("{{original_prompt}}", options.originalPrompt)
    .replace("{{scene_role}}", options.sceneRole)
    .replace("{{camera}}", options.camera)
    .replace("{{character_desc}}", options.characterDesc);

  const raw = await generateContent(prompt, {
    systemPrompt: REFINER_SYSTEM,
    temperature: 0.3,
    maxTokens: 2048,
    jsonMode: true,
  });

  const json = extractJson(raw);
  if (!json) {
    // 리파인 실패 시 원본 반환
    return {
      refinedPrompt: options.originalPrompt,
      changesMade: [],
      additionalNegatives: "",
      confidence: 0.5,
    };
  }

  return {
    refinedPrompt: (json.refined_prompt as string) || options.originalPrompt,
    changesMade: (json.changes_made as string[]) || [],
    additionalNegatives: (json.additional_negatives as string) || "",
    confidence: (json.confidence as number) || 0.5,
  };
}

/**
 * 평가 결과를 기반으로 재생성 프롬프트를 만든다.
 * Claude Code의 "피드백 루프" 패턴 적용.
 */
export async function buildRegeneratePrompt(options: {
  originalPrompt: string;
  issues: string[];
  suggestions: string[];
  sceneRole: string;
  camera: string;
  characterDesc: string;
}): Promise<string> {
  const issueList = options.issues.map((i) => `- ${i}`).join("\n");
  const suggestionList = options.suggestions.map((s) => `- ${s}`).join("\n");

  const feedbackPrompt = `You are improving an image generation prompt based on quality evaluation feedback.

## Original Prompt
${options.originalPrompt}

## Quality Issues Found
${issueList}

## Improvement Suggestions
${suggestionList}

## Scene Context
- Role: ${options.sceneRole}
- Camera: ${options.camera}
- Character: ${options.characterDesc}

## Task
Rewrite the prompt to fix ALL listed issues while keeping the same creative intent.
The output must be a single image generation prompt string — no JSON, no explanation.
Start with "RAW photo," and include all quality tags.`;

  const raw = await generateContent(feedbackPrompt, {
    systemPrompt: REFINER_SYSTEM,
    temperature: 0.4,
    maxTokens: 1024,
  });

  // 응답에서 프롬프트만 추출 (첫 줄이 프롬프트)
  const cleaned = raw.trim().replace(/^["']|["']$/g, "");
  return cleaned || options.originalPrompt;
}
