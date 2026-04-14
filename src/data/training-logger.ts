import fs from "fs/promises";
import path from "path";
import { prisma } from "../db/prisma.js";

interface TrainingEntry {
  step: "plan" | "character" | "scene_image" | "scene_video" | "image_analysis";
  inputPrompt: string;
  inputImages?: string[];
  outputRaw?: string;
  outputParsed?: string;
  model: string;
  params?: Record<string, unknown>;
  durationMs?: number;
  success: boolean;
  errorMsg?: string;
  creativeId?: string;
  systemPrompt?: string;
}

/**
 * 모든 AI 호출을 DB + JSONL 파일에 자동 기록한다.
 * 나중에 파인튜닝 데이터로 내보내기 위한 축적.
 */
export async function logTrainingData(entry: TrainingEntry): Promise<void> {
  // 1. DB 저장
  try {
    await prisma.trainingLog.create({
      data: {
        step: entry.step,
        inputPrompt: entry.inputPrompt,
        inputImages: entry.inputImages
          ? JSON.stringify(entry.inputImages)
          : null,
        outputRaw: entry.outputRaw,
        outputParsed: entry.outputParsed,
        model: entry.model,
        params: entry.params ? JSON.stringify(entry.params) : null,
        durationMs: entry.durationMs,
        success: entry.success,
        errorMsg: entry.errorMsg,
        creativeId: entry.creativeId,
        systemPrompt: entry.systemPrompt,
      },
    });
  } catch (e) {
    console.error("TrainingLog DB write failed:", e);
  }

  // 2. JSONL 파일 저장 (파인튜닝 내보내기 용이)
  try {
    const outputDir = process.env.OUTPUT_DIR || "./output";
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const dir = path.join(outputDir, "training-data", entry.step);
    await fs.mkdir(dir, { recursive: true });

    const jsonlPath = path.join(dir, `${date}.jsonl`);
    const line = JSON.stringify({
      ...entry,
      timestamp: new Date().toISOString(),
    });

    await fs.appendFile(jsonlPath, line + "\n", "utf-8");
  } catch (e) {
    console.error("TrainingLog JSONL write failed:", e);
  }
}
