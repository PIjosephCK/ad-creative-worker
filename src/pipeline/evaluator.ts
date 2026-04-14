import { prisma } from "../db/prisma.js";
import { analyzeImage } from "../ai/ollama.js";
import { buildEvaluateImagePrompt, getQualityThreshold } from "../prompts/loader.js";
import fs from "fs/promises";
import path from "path";

export interface EvalScores {
  prompt_adherence: number;
  visual_quality: number;
  character_consistency: number;
  brand_safety: number;
  ad_effectiveness: number;
}

export interface EvalResult {
  scores: EvalScores;
  average: number;
  issues: string[];
  suggestions: string[];
  regenerate: boolean;
}

/**
 * 생성된 이미지를 Qwen-VL로 자동 평가한다.
 * TrainingLog에 연결된 QualityEval 레코드를 생성한다.
 */
export async function evaluateGeneratedImage(options: {
  trainingLogId: string;
  imagePath: string;
  originalPrompt: string;
  sceneRole: string;
  camera: string;
  mood: string;
  campaignId?: string;
}): Promise<EvalResult> {
  // 이미지를 base64로 로딩
  const imageBuffer = await fs.readFile(options.imagePath);
  const base64 = imageBuffer.toString("base64");
  const ext = path.extname(options.imagePath).toLowerCase();
  const mimeType =
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : "image/jpeg";

  // 평가 프롬프트 조립
  const evalPrompt = await buildEvaluateImagePrompt({
    originalPrompt: options.originalPrompt,
    sceneRole: options.sceneRole,
    camera: options.camera,
    mood: options.mood,
  });

  // Qwen-VL로 평가 실행
  const raw = await analyzeImage(evalPrompt, base64, mimeType);
  const result = parseEvalResponse(raw);

  // 캠페인별 재생성 기준
  const threshold = await getQualityThreshold(options.campaignId);
  result.regenerate = result.average < threshold;

  // DB에 저장
  await prisma.qualityEval.create({
    data: {
      trainingLogId: options.trainingLogId,
      promptAdherence: result.scores.prompt_adherence,
      visualQuality: result.scores.visual_quality,
      characterConsistency: result.scores.character_consistency,
      brandSafety: result.scores.brand_safety,
      adEffectiveness: result.scores.ad_effectiveness,
      averageScore: result.average,
      issues: result.issues.length > 0 ? JSON.stringify(result.issues) : null,
      suggestions:
        result.suggestions.length > 0
          ? JSON.stringify(result.suggestions)
          : null,
      shouldRegenerate: result.regenerate,
    },
  });

  return result;
}

/**
 * VL 응답을 파싱한다. JSON 파싱 실패 시 기본 점수 반환.
 */
function parseEvalResponse(raw: string): EvalResult {
  try {
    // JSON 추출 (마크다운 코드블록 제거)
    const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found");

    const parsed = JSON.parse(match[0]);

    const scores: EvalScores = {
      prompt_adherence: clampScore(parsed.scores?.prompt_adherence),
      visual_quality: clampScore(parsed.scores?.visual_quality),
      character_consistency: clampScore(parsed.scores?.character_consistency),
      brand_safety: clampScore(parsed.scores?.brand_safety),
      ad_effectiveness: clampScore(parsed.scores?.ad_effectiveness),
    };

    const values = Object.values(scores);
    const average =
      Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) /
      10;

    return {
      scores,
      average,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      regenerate: parsed.regenerate ?? average < 5.0,
    };
  } catch {
    // 파싱 실패 시 중간 점수를 반환하고 수동 평가를 유도
    return {
      scores: {
        prompt_adherence: 5,
        visual_quality: 5,
        character_consistency: 5,
        brand_safety: 7,
        ad_effectiveness: 5,
      },
      average: 5.4,
      issues: ["Auto-evaluation parse failed — manual review recommended"],
      suggestions: [],
      regenerate: false,
    };
  }
}

function clampScore(val: unknown): number {
  const num = Number(val);
  if (isNaN(num)) return 5;
  return Math.max(0, Math.min(10, num));
}

/**
 * 수동 피드백을 QualityEval에 기록한다.
 */
export async function submitHumanFeedback(
  trainingLogId: string,
  score: number,
  feedback?: string
): Promise<void> {
  await prisma.qualityEval.update({
    where: { trainingLogId },
    data: {
      humanOverride: Math.max(0, Math.min(10, score)),
      humanFeedback: feedback || null,
    },
  });
}

/**
 * 특정 creative의 모든 이미지 평가 요약을 반환한다.
 */
export async function getCreativeEvalSummary(creativeId: string): Promise<{
  totalImages: number;
  averageScore: number;
  needsRegeneration: number;
  scores: Array<{
    sceneIndex: number;
    averageScore: number;
    shouldRegenerate: boolean;
  }>;
}> {
  const logs = await prisma.trainingLog.findMany({
    where: {
      creativeId,
      step: { in: ["character", "scene_image"] },
      success: true,
    },
    include: { evaluation: true },
    orderBy: { createdAt: "asc" },
  });

  const evaluated = logs.filter((l) => l.evaluation);
  const avgScore =
    evaluated.length > 0
      ? Math.round(
          (evaluated.reduce(
            (sum, l) => sum + (l.evaluation!.averageScore ?? 0),
            0
          ) /
            evaluated.length) *
            10
        ) / 10
      : 0;

  return {
    totalImages: evaluated.length,
    averageScore: avgScore,
    needsRegeneration: evaluated.filter((l) => l.evaluation!.shouldRegenerate)
      .length,
    scores: evaluated.map((l, i) => ({
      sceneIndex: i,
      averageScore: l.evaluation!.averageScore,
      shouldRegenerate: l.evaluation!.shouldRegenerate,
    })),
  };
}
