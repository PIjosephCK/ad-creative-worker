/**
 * 프롬프트 빌더 — 외부 템플릿 시스템으로 위임
 *
 * 기존 import 경로 호환을 위해 래퍼로 유지.
 * 실제 로직은 src/prompts/loader.ts에 있다.
 */

export {
  buildPlannerPrompt,
  buildCharacterPrompt,
  buildSceneImagePrompt,
  buildProductScenePrompt,
  buildImageAnalysisPrompt,
  buildEvaluateImagePrompt,
  getNegativePrompt,
  getQualityThreshold,
  clearPromptCache,
} from "../prompts/loader.js";

export type { CampaignOverride } from "../prompts/loader.js";
