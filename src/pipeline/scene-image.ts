import { prisma } from "../db/prisma.js";
import { AD_CREATIVE } from "../constants.js";
import {
  loadWorkflow,
  generateImage,
  uploadInputImage,
} from "../ai/comfyui.js";
import { saveImage } from "../storage/local-storage.js";
import {
  buildSceneImagePrompt,
  buildProductScenePrompt,
  getNegativePrompt,
} from "../prompts/loader.js";
import { getErrorMessage, mergeSceneMetadata } from "./utils.js";
import { logTrainingData } from "../data/training-logger.js";
import type { CreativePlanJson, JobCallbacks } from "./types.js";

interface SceneGenOptions {
  /** 캐릭터 참조 이미지의 ComfyUI input 이름 (캐릭터 없는 광고는 undefined) */
  characterRefComfyName?: string;
  characterDesc: string;
  /** 스타일 참조 이미지의 ComfyUI input 이름 (선택) */
  styleRefComfyName?: string;
  /** 제품 이미지의 ComfyUI input 이름 (선택) */
  productComfyName?: string;
  productDesc?: string;
}

/**
 * Step 3: 씬별 이미지 생성 (ComfyUI + Flux.1-dev + IP-Adapter)
 * 개별 씬 실패 시 에러를 기록하고 나머지 씬 생성을 계속한다.
 */
export async function generateSceneImages(
  creativeId: string,
  scenes: CreativePlanJson["scenes"],
  options: SceneGenOptions,
  callbacks: JobCallbacks
): Promise<void> {
  // 이미 이미지가 있는 씬 확인 (재시작 시 스킵용)
  const existingScenes = await prisma.adScene.findMany({
    where: { creativeId },
    select: { sceneIndex: true, imageUrl: true },
  });
  const completedSet = new Set(
    existingScenes.filter((s) => s.imageUrl).map((s) => s.sceneIndex)
  );

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];

    if (completedSet.has(scene.index)) {
      await callbacks.onStatus?.(
        `씬 ${i + 1}/${scenes.length} 이미지 이미 존재 — 스킵`
      );
      await callbacks.onProgress?.(i + 1, scenes.length);
      continue;
    }

    await callbacks.onStatus?.(
      `씬 ${i + 1}/${scenes.length} 이미지 생성 중...`
    );

    const startTime = Date.now();
    try {
      // 워크플로우 선택: 제품 합성 씬 vs 일반 씬 vs 스타일 참조 씬
      const isProductScene =
        options.productComfyName &&
        scene.imagePrompt.toLowerCase().includes("product");

      let workflowName: string;
      let prompt: string;
      const seed = Math.floor(Math.random() * 2 ** 32);

      const variables: Record<string, string | number> = {
        NEGATIVE_PROMPT: await getNegativePrompt(),
        SEED: seed,
        STEPS: AD_CREATIVE.STEPS,
        CFG: AD_CREATIVE.CFG,
        WIDTH: AD_CREATIVE.IMAGE_WIDTH,
        HEIGHT: AD_CREATIVE.IMAGE_HEIGHT,
      };

      // 캐릭터 참조가 있을 때만 IP-Adapter 관련 변수 설정
      if (options.characterRefComfyName) {
        variables.REFERENCE_IMAGE = options.characterRefComfyName;
        variables.IPADAPTER_WEIGHT = AD_CREATIVE.IPADAPTER_WEIGHT;
      }

      if (isProductScene && options.productComfyName) {
        workflowName = "scene-with-product.json";
        prompt = await buildProductScenePrompt(
          { imagePrompt: scene.imagePrompt, camera: scene.camera },
          options.characterDesc,
          options.productDesc || "product"
        );
        variables.PRODUCT_IMAGE = options.productComfyName;
      } else if (options.styleRefComfyName) {
        workflowName = "scene-with-style.json";
        prompt = await buildSceneImagePrompt(
          { imagePrompt: scene.imagePrompt, camera: scene.camera, role: scene.role },
          options.characterDesc
        );
        variables.STYLE_IMAGE = options.styleRefComfyName;
        variables.STYLE_WEIGHT = 0.5;
      } else if (options.characterRefComfyName) {
        // 캐릭터가 있는 경우 — IP-Adapter 워크플로우
        workflowName = "scene-with-ipadapter.json";
        prompt = await buildSceneImagePrompt(
          { imagePrompt: scene.imagePrompt, camera: scene.camera, role: scene.role },
          options.characterDesc
        );
      } else {
        // 캐릭터 없는 광고 — 기본 워크플로우 (IP-Adapter 없이)
        workflowName = "character-portrait.json";
        prompt = await buildSceneImagePrompt(
          { imagePrompt: scene.imagePrompt, camera: scene.camera, role: scene.role },
          options.characterDesc
        );
      }

      variables.PROMPT = prompt;

      const workflow = await loadWorkflow(workflowName, variables);
      const { buffer, filename } = await generateImage(workflow, {
        timeoutMs: AD_CREATIVE.COMFYUI_TIMEOUT_MS,
      });

      const saved = await saveImage(
        buffer,
        `scene_${creativeId}_${scene.index}.png`,
        "image/png"
      );

      await prisma.adScene.update({
        where: {
          creativeId_sceneIndex: { creativeId, sceneIndex: scene.index },
        },
        data: { imageUrl: saved.url, imagePath: saved.path },
      });

      await logTrainingData({
        step: "scene_image",
        inputPrompt: prompt,
        inputImages: options.characterRefComfyName ? [options.characterRefComfyName] : undefined,
        outputRaw: filename,
        model: options.characterRefComfyName ? `juggernaut-xl+ipadapter` : `juggernaut-xl`,
        params: { seed, workflow: workflowName, weight: AD_CREATIVE.IPADAPTER_WEIGHT },
        durationMs: Date.now() - startTime,
        success: true,
        creativeId,
      });
    } catch (error) {
      await prisma.adScene.update({
        where: {
          creativeId_sceneIndex: { creativeId, sceneIndex: scene.index },
        },
        data: {
          metadata: mergeSceneMetadata(null, {
            imageError: getErrorMessage(error),
          }),
        },
      });

      await logTrainingData({
        step: "scene_image",
        inputPrompt: scene.imagePrompt,
        model: "juggernaut-xl+ipadapter",
        durationMs: Date.now() - startTime,
        success: false,
        errorMsg: getErrorMessage(error),
        creativeId,
      });
    }

    await callbacks.onProgress?.(i + 1, scenes.length);

    if (i < scenes.length - 1) {
      await new Promise((r) => setTimeout(r, AD_CREATIVE.SCENE_DELAY_MS));
    }
  }
}
