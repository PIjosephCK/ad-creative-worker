import fs from "fs/promises";
import { prisma } from "../db/prisma.js";
import { AD_CREATIVE } from "../constants.js";
import { loadWorkflow, queuePrompt, pollForCompletion, downloadImage, uploadInputImage } from "../ai/comfyui.js";
import { saveVideo } from "../storage/local-storage.js";
import { getNegativePrompt } from "../prompts/loader.js";
import { getErrorMessage } from "./utils.js";
import { logTrainingData } from "../data/training-logger.js";
import type { JobCallbacks } from "./types.js";

interface VideoGenOptions {
  promptOverride?: string;
  force?: boolean;
  useIpadapter?: boolean; // default true
}

/**
 * AnimateDiff를 사용한 씬 영상 생성
 * 씬 이미지가 있으면 IPAdapter로 참조, 없으면 텍스트만으로 생성
 */
export async function generateSceneVideos(
  creativeId: string,
  sceneIds?: string[],
  callbacks?: JobCallbacks,
  options?: VideoGenOptions
): Promise<{ generated: number; failed: number }> {
  const scenes = await prisma.adScene.findMany({
    where: {
      creativeId,
      ...(sceneIds ? { id: { in: sceneIds } } : {}),
    },
    orderBy: { sceneIndex: "asc" },
  });

  let generated = 0;
  let failed = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];

    // 이미 영상이 있으면 스킵 (force가 아닌 경우)
    if (scene.videoUrl && !options?.force) {
      await callbacks?.onStatus?.(`씬 ${i + 1}/${scenes.length} 영상 이미 존재 — 스킵`);
      continue;
    }

    // force인 경우 기존 영상 정보 초기화
    if (scene.videoUrl && options?.force) {
      await prisma.adScene.update({
        where: { id: scene.id },
        data: { videoUrl: null, videoPath: null, veoStatus: null },
      });
    }

    // videoPrompt 없으면 스킵
    const effectivePrompt = options?.promptOverride || scene.videoPrompt;
    if (!effectivePrompt) {
      await callbacks?.onStatus?.(`씬 ${i + 1}/${scenes.length} videoPrompt 없음 — 스킵`);
      continue;
    }

    await callbacks?.onStatus?.(`씬 ${i + 1}/${scenes.length} 영상 생성 중...`);
    await callbacks?.onProgress?.(i, scenes.length);

    const startTime = Date.now();
    try {
      const seed = Math.floor(Math.random() * 2 ** 32);
      const variables: Record<string, string | number> = {
        PROMPT: effectivePrompt,
        NEGATIVE_PROMPT: await getNegativePrompt(),
        SEED: seed,
        STEPS: AD_CREATIVE.VIDEO_STEPS,
        CFG: AD_CREATIVE.VIDEO_CFG,
        WIDTH: AD_CREATIVE.VIDEO_WIDTH,
        HEIGHT: AD_CREATIVE.VIDEO_HEIGHT,
        FRAMES: AD_CREATIVE.VIDEO_FRAMES,
        FPS: AD_CREATIVE.VIDEO_FPS,
        FILENAME_PREFIX: `video_${creativeId}_${scene.sceneIndex}`,
      };

      // IPAdapter 워크플로우 선택 (씬 이미지가 있으면 참조)
      let workflowName = "animatediff-scene.json";

      if (options?.useIpadapter !== false && scene.imagePath) {
        try {
          await fs.access(scene.imagePath);
          const imgBuffer = await fs.readFile(scene.imagePath);
          const refName = await uploadInputImage(
            imgBuffer,
            `video_ref_${creativeId}_${scene.sceneIndex}.png`
          );
          variables.REFERENCE_IMAGE = refName;
          variables.IPADAPTER_WEIGHT = AD_CREATIVE.VIDEO_IPADAPTER_WEIGHT;
          workflowName = "animatediff-ipadapter.json";
        } catch {
          // 씬 이미지 접근 불가 → text-only fallback
        }
      }

      const workflow = await loadWorkflow(workflowName, variables);
      const promptId = await queuePrompt(workflow);

      const result = await pollForCompletion(
        promptId,
        AD_CREATIVE.COMFYUI_POLL_INTERVAL_MS,
        AD_CREATIVE.VIDEO_TIMEOUT_MS
      );

      const img = result.images[0];
      const buffer = await downloadImage(img.filename, img.subfolder, img.type);

      const ext = img.filename.endsWith(".webp") ? "webp" : "gif";
      const saved = await saveVideo(
        buffer,
        `video_${creativeId}_${scene.sceneIndex}.${ext}`,
        `video/${ext}`
      );

      await prisma.adScene.update({
        where: { id: scene.id },
        data: {
          videoUrl: saved.url,
          videoPath: saved.path,
          veoStatus: "completed",
        },
      });

      await logTrainingData({
        step: "scene_video",
        inputPrompt: effectivePrompt,
        outputRaw: img.filename,
        model: workflowName.includes("ipadapter")
          ? "juggernaut-xl+animatediff+ipadapter"
          : "juggernaut-xl+animatediff",
        params: { seed, frames: AD_CREATIVE.VIDEO_FRAMES, fps: AD_CREATIVE.VIDEO_FPS, workflow: workflowName },
        durationMs: Date.now() - startTime,
        success: true,
        creativeId,
      });

      generated++;
    } catch (error) {
      await prisma.adScene.update({
        where: { id: scene.id },
        data: { veoStatus: "failed" },
      });

      await logTrainingData({
        step: "scene_video",
        inputPrompt: effectivePrompt,
        model: "juggernaut-xl+animatediff",
        durationMs: Date.now() - startTime,
        success: false,
        errorMsg: getErrorMessage(error),
        creativeId,
      });

      failed++;
    }

    if (i < scenes.length - 1) {
      await new Promise((r) => setTimeout(r, AD_CREATIVE.SCENE_DELAY_MS));
    }
  }

  await callbacks?.onProgress?.(scenes.length, scenes.length);
  return { generated, failed };
}

/**
 * 개별 씬 영상 재생성
 */
export async function generateSingleSceneVideo(
  sceneId: string,
  options?: { promptOverride?: string; force?: boolean },
  callbacks?: JobCallbacks
): Promise<{ success: boolean }> {
  const scene = await prisma.adScene.findUniqueOrThrow({
    where: { id: sceneId },
  });

  const result = await generateSceneVideos(
    scene.creativeId,
    [sceneId],
    callbacks,
    { force: options?.force ?? true, promptOverride: options?.promptOverride }
  );

  return { success: result.generated > 0 };
}
