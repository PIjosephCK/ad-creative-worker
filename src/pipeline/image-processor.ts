import fs from "fs/promises";
import path from "path";
import {
  loadWorkflow,
  generateImage,
  uploadInputImage,
} from "../ai/comfyui.js";
import { saveImage } from "../storage/local-storage.js";
import type { ImageAnalysisResult } from "./types.js";

/**
 * 분석 결과에 따라 이미지를 전처리한다.
 * - product → 배경 제거
 * - model → 얼굴 크롭 (캐릭터 참조용)
 * - style_reference → 그대로 저장
 * - brand_asset → 배경 제거
 */
export async function preprocessImages(
  imagePaths: string[],
  analysisResults: ImageAnalysisResult[],
  creativeId: string
): Promise<
  Array<{
    originalPath: string;
    processedPath: string;
    type: ImageAnalysisResult["type"];
    comfyInputName?: string; // ComfyUI input에 업로드된 이름
  }>
> {
  const processed: Array<{
    originalPath: string;
    processedPath: string;
    type: ImageAnalysisResult["type"];
    comfyInputName?: string;
  }> = [];

  for (const analysis of analysisResults) {
    const imgPath = imagePaths[analysis.index];
    const buffer = await fs.readFile(imgPath);
    const ext = path.extname(imgPath) || ".jpg";

    if (analysis.type === "product" || analysis.type === "brand_asset") {
      // 배경 제거 워크플로우 실행
      try {
        const inputName = await uploadInputImage(
          buffer,
          `input_${creativeId}_${analysis.index}${ext}`
        );
        const workflow = await loadWorkflow("product-prepare.json", {
          INPUT_IMAGE: inputName,
        });
        const result = await generateImage(workflow);
        const saved = await saveImage(
          result.buffer,
          `processed_${creativeId}_${analysis.index}_nobg.png`,
          "image/png"
        );

        // 처리된 이미지도 ComfyUI input에 업로드 (씬 합성용)
        const comfyName = await uploadInputImage(
          result.buffer,
          `product_${creativeId}_${analysis.index}.png`
        );

        processed.push({
          originalPath: imgPath,
          processedPath: saved.path,
          type: analysis.type,
          comfyInputName: comfyName,
        });
      } catch {
        // 배경 제거 실패 시 원본 그대로 사용
        const saved = await saveImage(
          buffer,
          `processed_${creativeId}_${analysis.index}${ext}`,
          "image/png"
        );
        const comfyName = await uploadInputImage(
          buffer,
          `product_${creativeId}_${analysis.index}${ext}`
        );
        processed.push({
          originalPath: imgPath,
          processedPath: saved.path,
          type: analysis.type,
          comfyInputName: comfyName,
        });
      }
    } else if (analysis.type === "model") {
      // 인물 사진은 ComfyUI input에 업로드 (IP-Adapter 참조용)
      const comfyName = await uploadInputImage(
        buffer,
        `model_ref_${creativeId}${ext}`
      );
      const saved = await saveImage(
        buffer,
        `model_${creativeId}_${analysis.index}${ext}`,
        "image/jpeg"
      );
      processed.push({
        originalPath: imgPath,
        processedPath: saved.path,
        type: analysis.type,
        comfyInputName: comfyName,
      });
    } else {
      // style_reference — 그대로 저장 + ComfyUI에 업로드
      const comfyName = await uploadInputImage(
        buffer,
        `style_ref_${creativeId}_${analysis.index}${ext}`
      );
      const saved = await saveImage(
        buffer,
        `style_${creativeId}_${analysis.index}${ext}`,
        "image/jpeg"
      );
      processed.push({
        originalPath: imgPath,
        processedPath: saved.path,
        type: analysis.type,
        comfyInputName: comfyName,
      });
    }
  }

  return processed;
}
