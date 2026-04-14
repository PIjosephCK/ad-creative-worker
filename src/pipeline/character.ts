import { prisma } from "../db/prisma.js";
import { AD_CREATIVE } from "../constants.js";
import { loadWorkflow, generateImage, uploadInputImage } from "../ai/comfyui.js";
import { saveImage } from "../storage/local-storage.js";
import { buildCharacterPrompt, getNegativePrompt } from "./prompts.js";
import { getErrorMessage } from "./utils.js";
import { toJsonString } from "../db/json.js";
import { logTrainingData } from "../data/training-logger.js";
import type { CreativePlanJson, CharacterCandidate } from "./types.js";

/**
 * Step 2: 캐릭터 후보 3장 생성 (ComfyUI + Flux.1-dev)
 * 부분 실패 허용: 1장이라도 성공하면 CharacterSheet를 생성한다.
 * modelRefComfyName이 있으면 첨부된 인물 사진을 참조로 사용.
 */
export async function generateCharacterCandidates(
  characterDesc: CreativePlanJson["character"],
  creativeId: string,
  modelRefComfyName?: string
): Promise<{
  characterSheetId: string;
  candidates: CharacterCandidate[];
}> {
  const candidates: CharacterCandidate[] = [];

  for (let i = 0; i < AD_CREATIVE.CHARACTER_CANDIDATES; i++) {
    const startTime = Date.now();
    try {
      const prompt = buildCharacterPrompt(characterDesc, i);
      const seed = Math.floor(Math.random() * 2 ** 32);

      // 인물 참조 이미지가 있으면 IP-Adapter 워크플로우 사용
      const workflowName = modelRefComfyName
        ? "scene-with-ipadapter.json"
        : "character-portrait.json";

      const variables: Record<string, string | number> = {
        PROMPT: prompt,
        NEGATIVE_PROMPT: getNegativePrompt(),
        SEED: seed,
        STEPS: AD_CREATIVE.STEPS,
        CFG: AD_CREATIVE.CFG,
        WIDTH: AD_CREATIVE.IMAGE_WIDTH,
        HEIGHT: AD_CREATIVE.IMAGE_HEIGHT,
      };

      if (modelRefComfyName) {
        variables.REFERENCE_IMAGE = modelRefComfyName;
        variables.IPADAPTER_WEIGHT = AD_CREATIVE.IPADAPTER_WEIGHT;
      }

      const workflow = await loadWorkflow(workflowName, variables);
      const { buffer, filename } = await generateImage(workflow, {
        timeoutMs: AD_CREATIVE.COMFYUI_TIMEOUT_MS,
      });

      const saved = await saveImage(
        buffer,
        `character_${creativeId}_${i}.png`,
        "image/png"
      );

      candidates.push({ url: saved.url, path: saved.path, selected: false });

      await logTrainingData({
        step: "character",
        inputPrompt: prompt,
        outputRaw: filename,
        model: modelRefComfyName ? "juggernaut-xl+ipadapter" : "juggernaut-xl",
        params: { seed, workflow: workflowName },
        durationMs: Date.now() - startTime,
        success: true,
        creativeId,
      });
    } catch (error) {
      candidates.push({
        url: "",
        path: "",
        selected: false,
        error: getErrorMessage(error),
      });

      await logTrainingData({
        step: "character",
        inputPrompt: buildCharacterPrompt(characterDesc, i),
        model: "juggernaut-xl",
        durationMs: Date.now() - startTime,
        success: false,
        errorMsg: getErrorMessage(error),
        creativeId,
      });
    }

    if (i < AD_CREATIVE.CHARACTER_CANDIDATES - 1) {
      await new Promise((r) => setTimeout(r, AD_CREATIVE.SCENE_DELAY_MS));
    }
  }

  const successCount = candidates.filter((c) => c.url).length;
  if (successCount === 0) {
    throw new Error(
      `캐릭터 이미지 생성에 모두 실패했습니다: ${candidates.map((c) => c.error).join(", ")}`
    );
  }

  const sheet = await prisma.characterSheet.create({
    data: {
      creativeId,
      description: `${characterDesc.appearance}, ${characterDesc.outfit}`,
      candidates: toJsonString(candidates),
    },
  });

  return { characterSheetId: sheet.id, candidates };
}
