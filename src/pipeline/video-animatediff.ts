import { prisma } from "../db/prisma.js";
import { AD_CREATIVE } from "../constants.js";
import { loadWorkflow, generateImage, queuePrompt, pollForCompletion, downloadImage } from "../ai/comfyui.js";
import { saveImage } from "../storage/local-storage.js";
import { getNegativePrompt } from "../prompts/loader.js";
import { getErrorMessage } from "./utils.js";
import { logTrainingData } from "../data/training-logger.js";
import type { JobCallbacks } from "./types.js";

/**
 * AnimateDiff를 사용한 씬 영상 생성
 * 각 씬의 videoPrompt를 기반으로 2초 WebP 클립 생성
 */
export async function generateSceneVideos(
  creativeId: string,
  sceneIds?: string[],
  callbacks?: JobCallbacks
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

    // 이미 영상이 있으면 스킵
    if (scene.videoUrl) {
      await callbacks?.onStatus?.(`씬 ${i + 1}/${scenes.length} 영상 이미 존재 — 스킵`);
      continue;
    }

    // videoPrompt 없으면 스킵
    if (!scene.videoPrompt) {
      await callbacks?.onStatus?.(`씬 ${i + 1}/${scenes.length} videoPrompt 없음 — 스킵`);
      continue;
    }

    await callbacks?.onStatus?.(`씬 ${i + 1}/${scenes.length} 영상 생성 중...`);
    await callbacks?.onProgress?.(i, scenes.length);

    const startTime = Date.now();
    try {
      const seed = Math.floor(Math.random() * 2 ** 32);
      const variables: Record<string, string | number> = {
        PROMPT: scene.videoPrompt,
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

      const workflow = await loadWorkflow("animatediff-scene.json", variables);
      const promptId = await queuePrompt(workflow);

      // AnimateDiff는 시간이 오래 걸리므로 polling으로 대기
      const result = await pollForCompletion(
        promptId,
        AD_CREATIVE.COMFYUI_POLL_INTERVAL_MS,
        AD_CREATIVE.VIDEO_TIMEOUT_MS
      );

      const img = result.images[0];
      const buffer = await downloadImage(img.filename, img.subfolder, img.type);

      const ext = img.filename.endsWith(".webp") ? "webp" : "gif";
      const saved = await saveImage(
        buffer,
        `video_${creativeId}_${scene.sceneIndex}.${ext}`,
        `image/${ext}`
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
        step: "scene_image",
        inputPrompt: scene.videoPrompt,
        outputRaw: img.filename,
        model: "juggernaut-xl+animatediff",
        params: { seed, frames: AD_CREATIVE.VIDEO_FRAMES, fps: AD_CREATIVE.VIDEO_FPS },
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
        step: "scene_image",
        inputPrompt: scene.videoPrompt || "",
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
