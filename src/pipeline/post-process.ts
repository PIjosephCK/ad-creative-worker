import { AD_CREATIVE } from "../constants.js";
import type {
  CompositionMetadata,
  CompositionClip,
  CreativePlanJson,
} from "./types.js";

interface SceneData {
  sceneIndex: number;
  role: string;
  motionType: string;
  veoStatus?: string | null;
  videoUrl?: string | null;
  imageUrl?: string | null;
  textOverlay?: string | null;
  duration: number;
}

/**
 * Step 5: 조합 메타데이터 생성 (순수 함수)
 */
export function generateCompositionMetadata(
  scenes: SceneData[],
  plan: CreativePlanJson
): CompositionMetadata {
  const clips: CompositionClip[] = scenes.map((scene, i) => {
    let type: CompositionClip["type"] = "video";
    if (scene.motionType === "ken_burns") type = "ken_burns";
    if (scene.motionType === "manual" || scene.veoStatus === "fallback")
      type = "manual_placeholder";

    const sourceUrl =
      type === "video" && scene.videoUrl
        ? scene.videoUrl
        : scene.imageUrl || "";

    const transition: CompositionClip["transition"] =
      i === 0 ? "cut" : "crossfade";

    const clip: CompositionClip = {
      sceneIndex: scene.sceneIndex,
      type,
      sourceUrl,
      duration: scene.duration,
      transition,
    };

    if (scene.textOverlay) {
      clip.textOverlay = {
        text: scene.textOverlay,
        position: scene.role === "cta" ? "center" : "bottom",
        animation: scene.role === "hook" ? "slide_up" : "fade_in",
      };
    }

    return clip;
  });

  const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);

  return {
    clips,
    bgm: plan.bgm,
    totalDuration,
    outputFormat: AD_CREATIVE.OUTPUT_FORMAT,
    resolution: AD_CREATIVE.OUTPUT_RESOLUTION,
  };
}
