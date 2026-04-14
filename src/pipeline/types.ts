import { z } from "zod";

// === Step 1 기획 JSON 스키마 ===

export const creativePlanSchema = z.object({
  title: z.string(),
  adType: z.enum(["product", "store", "service", "brand", "event", "person"]).optional().default("brand"),
  concept: z.string(),
  targetAudience: z.string(),
  mood: z.string(),
  character: z.object({
    gender: z.string(),
    ageRange: z.string(),
    appearance: z.string(),
    outfit: z.string(),
    styleRef: z.enum(["natural", "editorial", "cinematic"]),
  }).nullable(),
  scenes: z
    .array(
      z.object({
        index: z.number().int().min(0),
        role: z.enum(["hook", "body", "cta"]),
        description: z.string(),
        imagePrompt: z.string(),
        videoPrompt: z.string(),
        textOverlay: z.string().nullable(),
        duration: z.number().int().min(1).max(15),
        motionType: z.enum(["veo", "ken_burns"]),
        kenBurnsDirection: z
          .enum(["zoom_in", "zoom_out", "pan_left", "pan_right"])
          .nullable()
          .optional(),
        camera: z.string(),
        transitionFrom: z.string().optional(),
      })
    )
    .min(3)
    .max(10),
  bgm: z.object({
    mood: z.string(),
    tempo: z.string(),
    genre: z.string(),
  }),
  hookVariationHints: z.array(z.string()).min(1).max(5),
});

export type CreativePlanJson = z.infer<typeof creativePlanSchema>;

// === 조합 메타데이터 ===

export interface CompositionClip {
  sceneIndex: number;
  type: "video" | "ken_burns" | "manual_placeholder";
  sourceUrl: string;
  duration: number;
  textOverlay?: {
    text: string;
    position: "top" | "center" | "bottom";
    animation: "fade_in" | "slide_up" | "typing";
  };
  transition: "cut" | "crossfade" | "fade_black";
}

export interface CompositionMetadata {
  clips: CompositionClip[];
  bgm: { mood: string; tempo: string; genre: string };
  totalDuration: number;
  outputFormat: string;
  resolution: string;
}

// === 캐릭터 후보 ===

export interface CharacterCandidate {
  url: string;
  path: string;
  selected: boolean;
  error?: string;
}

// === 상태 타입 ===

export type AdCreativeStatus =
  | "planning"
  | "character_select"
  | "scene_gen"
  | "video_gen"
  | "completed"
  | "failed";

export type SceneRole = "hook" | "body" | "cta";
export type MotionType = "veo" | "ken_burns" | "manual";

// === 이미지 첨부 분석 결과 ===

export interface ImageAnalysisResult {
  index: number;
  type: "product" | "style_reference" | "model" | "brand_asset";
  description: string;
  dominantColors?: string[];
  suggestedUse: "scene_composite" | "style_transfer" | "character_ref" | "overlay";
}

export const imageAnalysisSchema = z.object({
  images: z.array(
    z.object({
      index: z.number(),
      type: z.enum(["product", "style_reference", "model", "brand_asset"]),
      description: z.string(),
      dominantColors: z.array(z.string()).optional(),
      suggestedUse: z.enum([
        "scene_composite",
        "style_transfer",
        "character_ref",
        "overlay",
      ]),
    })
  ),
});

// === Job callbacks ===

export interface JobCallbacks {
  onStatus?: (message: string) => Promise<void> | void;
  onProgress?: (step: number, total: number) => Promise<void> | void;
}
