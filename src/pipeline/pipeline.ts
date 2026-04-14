import { prisma } from "../db/prisma.js";
import { toJsonString, fromJsonString } from "../db/json.js";
import { creativePlanSchema, type CreativePlanJson, type JobCallbacks } from "./types.js";
import { generateCreativePlan } from "./planner.js";
import { generateCharacterCandidates } from "./character.js";
import { generateSceneImages } from "./scene-image.js";
import { generateCompositionMetadata } from "./post-process.js";
import { analyzeAttachedImages, formatAnalysisForPlanner } from "./image-analyzer.js";
import { preprocessImages } from "./image-processor.js";
import { uploadInputImage } from "../ai/comfyui.js";
import { logTrainingData } from "../data/training-logger.js";
import fs from "fs/promises";

/**
 * Phase 1 파이프라인: (이미지 분석 +) 기획 + 캐릭터 후보 생성
 */
export async function executePlanningPipeline(
  creativeId: string,
  callbacks: JobCallbacks
): Promise<{ creativeId: string; characterSheetId: string }> {
  const creative = await prisma.adCreative.findUniqueOrThrow({
    where: { id: creativeId },
    include: { characterSheet: true, scenes: true },
  });

  const attachedImages = fromJsonString<string[]>(creative.attachedImages);

  // Step 0: 첨부 이미지 분석 (있을 경우)
  let imageAnalysisText: string | undefined;
  let processedImages: Awaited<ReturnType<typeof preprocessImages>> = [];
  let modelRefComfyName: string | undefined;

  if (attachedImages && attachedImages.length > 0) {
    await callbacks.onStatus?.("첨부 이미지 분석 중...");

    const analysisResults = await analyzeAttachedImages(attachedImages);
    imageAnalysisText = formatAnalysisForPlanner(analysisResults);

    await logTrainingData({
      step: "image_analysis",
      inputPrompt: `Analyzed ${attachedImages.length} images`,
      inputImages: attachedImages,
      outputParsed: JSON.stringify(analysisResults),
      model: process.env.OLLAMA_VL_MODEL || "qwen2.5-vl:7b",
      success: true,
      creativeId,
    });

    // 이미지 전처리
    await callbacks.onStatus?.("이미지 전처리 중...");
    processedImages = await preprocessImages(
      attachedImages,
      analysisResults,
      creativeId
    );

    // model 타입 이미지가 있으면 캐릭터 참조로 사용
    const modelImg = processedImages.find((p) => p.type === "model");
    if (modelImg?.comfyInputName) {
      modelRefComfyName = modelImg.comfyInputName;
    }

    // DB에 첨부 이미지 메타데이터 저장
    for (const proc of processedImages) {
      const analysis = analysisResults.find(
        (a) => attachedImages[a.index] === proc.originalPath
      );
      await prisma.attachedImage.create({
        data: {
          creativeId,
          originalName: proc.originalPath.split("/").pop() || "unknown",
          storagePath: proc.processedPath,
          type: proc.type,
          description: analysis?.description,
          processedPath: proc.processedPath,
          metadata: analysis ? JSON.stringify(analysis) : null,
        },
      });
    }
  }

  // Step 1: 기획서 생성 (이미 있으면 스킵)
  let plan: CreativePlanJson;
  if (creative.planJson && creative.scenes.length > 0) {
    await callbacks.onStatus?.("기획서 이미 존재 — 스킵");
    plan = creativePlanSchema.parse(fromJsonString(creative.planJson));
  } else {
    await callbacks.onStatus?.("기획서 생성 중...");
    await callbacks.onProgress?.(0, 2);

    const startTime = Date.now();
    plan = await generateCreativePlan(creative.prompt, {
      totalDuration: creative.totalDuration,
      imageAnalysis: imageAnalysisText,
    });

    await logTrainingData({
      step: "plan",
      inputPrompt: creative.prompt,
      outputParsed: JSON.stringify(plan),
      model: process.env.OLLAMA_MODEL || "qwen3:8b",
      durationMs: Date.now() - startTime,
      success: true,
      creativeId,
    });

    await prisma.$transaction([
      prisma.adCreative.update({
        where: { id: creativeId },
        data: { planJson: toJsonString(plan) },
      }),
      ...plan.scenes.map((scene) =>
        prisma.adScene.create({
          data: {
            creativeId,
            sceneIndex: scene.index,
            role: scene.role,
            imagePrompt: scene.imagePrompt,
            videoPrompt: scene.videoPrompt,
            textOverlay: scene.textOverlay,
            duration: scene.duration,
            motionType: scene.motionType,
            metadata: scene.kenBurnsDirection
              ? JSON.stringify({ kenBurnsDirection: scene.kenBurnsDirection })
              : undefined,
          },
        })
      ),
    ]);
  }

  await callbacks.onProgress?.(1, 2);

  // Step 2: 캐릭터 후보 생성 (이미 있으면 스킵)
  let characterSheetId: string;
  if (creative.characterSheet) {
    await callbacks.onStatus?.("캐릭터 시트 이미 존재 — 스킵");
    characterSheetId = creative.characterSheet.id;
  } else {
    await callbacks.onStatus?.("캐릭터 후보 생성 중...");
    const result = await generateCharacterCandidates(
      plan.character,
      creativeId,
      modelRefComfyName
    );
    characterSheetId = result.characterSheetId;
  }

  await prisma.adCreative.update({
    where: { id: creativeId },
    data: { status: "character_select" },
  });

  await callbacks.onProgress?.(2, 2);
  return { creativeId, characterSheetId };
}

/**
 * Phase 2 파이프라인: 씬 이미지 생성 + 후처리
 * (영상 생성은 Phase 2로 미룸)
 */
export async function executeGenerationPipeline(
  creativeId: string,
  callbacks: JobCallbacks
): Promise<{ creativeId: string }> {
  const creative = await prisma.adCreative.findUniqueOrThrow({
    where: { id: creativeId },
    include: { characterSheet: true, scenes: true },
  });

  const plan = creativePlanSchema.parse(fromJsonString(creative.planJson));
  const characterRefUrl = creative.characterSheet?.selectedUrl;
  if (!characterRefUrl) {
    throw new Error("캐릭터가 선택되지 않았습니다.");
  }

  const scenes = creative.scenes;
  const totalSteps = scenes.length + 1; // 씬 이미지 + 후처리

  // 캐릭터 참조 이미지를 ComfyUI input에 업로드
  await callbacks.onStatus?.("씬 이미지 생성 준비 중...");
  const refBuffer = await fetchImageBuffer(characterRefUrl);
  const characterRefComfyName = await uploadInputImage(
    refBuffer,
    `char_ref_${creativeId}.png`
  );

  // 첨부 이미지 중 제품/스타일 참조 확인
  const attachedImgs = await prisma.attachedImage.findMany({
    where: { creativeId },
  });
  const productImg = attachedImgs.find((a) => a.type === "product");
  const styleImg = attachedImgs.find((a) => a.type === "style_reference");

  // Step 3: 씬 이미지 생성
  await callbacks.onStatus?.("씬 이미지 생성 중...");
  await prisma.adCreative.update({
    where: { id: creativeId },
    data: { status: "scene_gen" },
  });

  const characterDesc = `${plan.character.appearance}, ${plan.character.outfit}`;
  await generateSceneImages(
    creativeId,
    plan.scenes,
    {
      characterRefComfyName,
      characterDesc,
      styleRefComfyName: styleImg
        ? `style_ref_${creativeId}_${styleImg.id}.png`
        : undefined,
      productComfyName: productImg
        ? `product_${creativeId}_${productImg.id}.png`
        : undefined,
      productDesc: productImg?.description || undefined,
    },
    {
      onStatus: callbacks.onStatus,
      onProgress: async (step) => {
        await callbacks.onProgress?.(step, totalSteps);
      },
    }
  );

  // Step 5: 후처리 메타데이터
  await callbacks.onStatus?.("후처리 메타데이터 생성 중...");
  const finalScenes = await prisma.adScene.findMany({
    where: { creativeId },
    orderBy: { sceneIndex: "asc" },
  });
  const composition = generateCompositionMetadata(finalScenes, plan);

  await prisma.adCreative.update({
    where: { id: creativeId },
    data: {
      status: "completed",
      planJson: toJsonString({ ...plan, composition }),
    },
  });

  await callbacks.onProgress?.(totalSteps, totalSteps);
  await callbacks.onStatus?.("크리에이티브 생성 완료!");
  return { creativeId };
}

/**
 * URL 또는 로컬 경로에서 이미지 Buffer를 가져온다.
 */
async function fetchImageBuffer(urlOrPath: string): Promise<Buffer> {
  if (urlOrPath.startsWith("http")) {
    const res = await fetch(urlOrPath);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFile(urlOrPath);
}
