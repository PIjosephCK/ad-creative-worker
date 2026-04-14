import express from "express";
import path from "path";
import { prisma } from "./db/prisma.js";
import { toJsonString, fromJsonString } from "./db/json.js";
import { executeJob, getJobStatus } from "./job/runner.js";
import {
  executePlanningPipeline,
  executeGenerationPipeline,
} from "./pipeline/pipeline.js";
import { generateSceneVideos } from "./pipeline/video-animatediff.js";
import {
  saveUploadedImage,
  listImages,
  deleteImageByName,
  clearSubdir,
  getStorageStats,
} from "./storage/local-storage.js";
import { healthCheck as comfyHealthCheck } from "./ai/comfyui.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR || "./output";

app.use(express.json({ limit: "50mb" }));

// 정적 파일 서빙 (이미지 접근용)
app.use("/output", express.static(path.resolve(OUTPUT_DIR)));

// === Health Check ===

app.get("/health", async (_req, res) => {
  const ollamaOk = await checkOllama();
  const comfyOk = await comfyHealthCheck();

  res.json({
    status: ollamaOk && comfyOk ? "healthy" : "degraded",
    services: {
      ollama: ollamaOk,
      comfyui: comfyOk,
      database: true,
    },
  });
});

// === Pipeline API ===

/**
 * POST /api/pipeline/plan
 * Phase 1: 기획 + 캐릭터 후보 생성
 * Body: { prompt, totalDuration?, images?: [{ data: base64, name: string }] }
 */
app.post("/api/pipeline/plan", async (req, res) => {
  try {
    const { prompt, totalDuration, images } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "prompt is required" });
    }

    // 첨부 이미지 저장
    let attachedPaths: string[] = [];
    if (images && Array.isArray(images)) {
      for (const img of images) {
        const buffer = Buffer.from(img.data, "base64");
        const savedPath = await saveUploadedImage(buffer, img.name);
        attachedPaths.push(savedPath);
      }
    }

    // AdCreative 레코드 생성
    const creative = await prisma.adCreative.create({
      data: {
        prompt,
        totalDuration: totalDuration || 45,
        status: "planning",
        attachedImages:
          attachedPaths.length > 0 ? toJsonString(attachedPaths) : null,
      },
    });

    // Job 실행 (비동기)
    const jobId = await executeJob(
      "ad_creative_plan",
      { creativeId: creative.id },
      (callbacks) => executePlanningPipeline(creative.id, callbacks)
    );

    await prisma.adCreative.update({
      where: { id: creative.id },
      data: { jobId },
    });

    res.json({ creativeId: creative.id, jobId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/pipeline/generate
 * Phase 2: 씬 이미지 생성 (캐릭터 선택 후)
 * Body: { creativeId }
 */
app.post("/api/pipeline/generate", async (req, res) => {
  try {
    const { creativeId } = req.body;

    if (!creativeId) {
      return res.status(400).json({ error: "creativeId is required" });
    }

    const jobId = await executeJob(
      "ad_creative_generate",
      { creativeId },
      (callbacks) => executeGenerationPipeline(creativeId, callbacks)
    );

    await prisma.adCreative.update({
      where: { id: creativeId },
      data: { jobId },
    });

    res.json({ jobId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/creative/:id/select-character
 * 캐릭터 선택
 * Body: { selectedIndex: number }
 */
app.post("/api/creative/:id/select-character", async (req, res) => {
  try {
    const { id } = req.params;
    const { selectedIndex } = req.body;

    if (typeof selectedIndex !== "number") {
      return res.status(400).json({ error: "selectedIndex must be a number" });
    }

    const sheet = await prisma.characterSheet.findUnique({
      where: { creativeId: id },
    });

    if (!sheet) {
      return res.status(404).json({ error: "Character sheet not found" });
    }

    const candidates = fromJsonString<
      Array<{ url: string; path: string; selected: boolean }>
    >(sheet.candidates);

    if (!candidates || selectedIndex >= candidates.length) {
      return res.status(400).json({ error: "Invalid selectedIndex" });
    }

    const selected = candidates[selectedIndex];
    if (!selected.url) {
      return res.status(400).json({ error: "Selected candidate has no image" });
    }

    await prisma.characterSheet.update({
      where: { id: sheet.id },
      data: {
        selectedIndex,
        selectedUrl: selected.url,
      },
    });

    res.json({ selectedUrl: selected.url });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/pipeline/video
 * Phase 3: 씬 영상 생성 (AnimateDiff)
 * Body: { creativeId, sceneIds?: string[] }
 */
app.post("/api/pipeline/video", async (req, res) => {
  try {
    const { creativeId, sceneIds } = req.body;

    if (!creativeId) {
      return res.status(400).json({ error: "creativeId is required" });
    }

    const jobId = await executeJob(
      "ad_creative_video",
      { creativeId, sceneIds },
      (callbacks) => generateSceneVideos(creativeId, sceneIds, callbacks)
    );

    res.json({ jobId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: msg });
  }
});

// === Query API ===

app.get("/api/job/:id", async (req, res) => {
  const job = await getJobStatus(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.get("/api/creative/:id", async (req, res) => {
  const creative = await prisma.adCreative.findUnique({
    where: { id: req.params.id },
    include: { characterSheet: true, scenes: { orderBy: { sceneIndex: "asc" } } },
  });
  if (!creative) return res.status(404).json({ error: "Creative not found" });
  res.json({
    ...creative,
    planJson: fromJsonString(creative.planJson),
    characterSheet: creative.characterSheet
      ? {
          ...creative.characterSheet,
          candidates: fromJsonString(creative.characterSheet.candidates),
        }
      : null,
  });
});

app.get("/api/creatives", async (_req, res) => {
  const creatives = await prisma.adCreative.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(
    creatives.map((c) => ({
      ...c,
      planJson: fromJsonString(c.planJson),
    }))
  );
});

// === Storage Management API ===

/**
 * GET /api/storage/stats
 * 스토리지 용량 조회
 */
app.get("/api/storage/stats", async (_req, res) => {
  const stats = await getStorageStats();
  res.json(stats);
});

/**
 * GET /api/storage/images?subdir=images
 * 이미지 목록 조회
 */
app.get("/api/storage/images", async (req, res) => {
  const subdir = (req.query.subdir as string) || "images";
  const images = await listImages(subdir);
  res.json(images);
});

/**
 * DELETE /api/storage/images/:subdir/:filename
 * 개별 이미지 삭제
 */
app.delete("/api/storage/images/:subdir/:filename", async (req, res) => {
  const { subdir, filename } = req.params;
  const deleted = await deleteImageByName(subdir, filename);
  if (deleted) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

/**
 * DELETE /api/storage/clear/:subdir
 * 서브디렉토리 전체 삭제
 */
app.delete("/api/storage/clear/:subdir", async (req, res) => {
  const count = await clearSubdir(req.params.subdir);
  res.json({ deleted: count });
});

/**
 * DELETE /api/creative/:id/images
 * 특정 크리에이티브의 이미지만 삭제
 */
app.delete("/api/creative/:id/images", async (req, res) => {
  const { id } = req.params;
  const images = await listImages("images");
  let deleted = 0;
  for (const img of images) {
    if (img.name.includes(id)) {
      await deleteImageByName("images", img.name);
      deleted++;
    }
  }
  res.json({ deleted });
});

// === Ollama health ===

async function checkOllama(): Promise<boolean> {
  try {
    const url = process.env.OLLAMA_BASE_URL?.replace("/v1", "") || "http://localhost:11434";
    const res = await fetch(`${url}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

// === Start ===

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Ad Creative Worker running on http://0.0.0.0:${PORT}`);
  console.log(`Output served at http://0.0.0.0:${PORT}/output/`);
});
