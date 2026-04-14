import fs from "fs/promises";
import { analyzeImage, extractJson } from "../ai/ollama.js";
import {
  imageAnalysisSchema,
  type ImageAnalysisResult,
} from "./types.js";
import { buildImageAnalysisPrompt } from "./prompts.js";

/**
 * 첨부 이미지들을 Qwen-VL로 분석하여 유형/용도를 판단한다.
 * 각 이미지를 개별 분석 후 결과를 합침.
 */
export async function analyzeAttachedImages(
  imagePaths: string[]
): Promise<ImageAnalysisResult[]> {
  const results: ImageAnalysisResult[] = [];

  for (let i = 0; i < imagePaths.length; i++) {
    const imgPath = imagePaths[i];
    const buffer = await fs.readFile(imgPath);
    const base64 = buffer.toString("base64");

    const ext = imgPath.split(".").pop()?.toLowerCase() || "jpg";
    const mimeType =
      ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/jpeg";

    const prompt = buildImageAnalysisPrompt(1);
    const raw = await analyzeImage(prompt, base64, mimeType);
    const json = extractJson(raw);

    if (json) {
      const parsed = imageAnalysisSchema.safeParse(json);
      if (parsed.success && parsed.data.images.length > 0) {
        results.push({ ...parsed.data.images[0], index: i });
        continue;
      }
    }

    // 분석 실패 시 기본값
    results.push({
      index: i,
      type: "style_reference",
      description: `Image ${i + 1} (analysis failed)`,
      suggestedUse: "style_transfer",
    });
  }

  return results;
}

/**
 * 분석 결과를 기획 프롬프트에 삽입할 텍스트로 변환
 */
export function formatAnalysisForPlanner(
  results: ImageAnalysisResult[]
): string {
  return results
    .map(
      (r) =>
        `- Image ${r.index}: type="${r.type}", description="${r.description}", suggestedUse="${r.suggestedUse}"${r.dominantColors ? `, colors=[${r.dominantColors.join(", ")}]` : ""}`
    )
    .join("\n");
}
