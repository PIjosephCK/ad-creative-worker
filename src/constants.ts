// ============================================================
// Ad Creative Worker — constants
// ============================================================

export const AD_CREATIVE = {
  // Qwen planning
  PLAN_TEMPERATURE: 0.4,
  PLAN_MAX_TOKENS: 4096,
  PLAN_JSON_MAX_RETRIES: 3,

  // ComfyUI image generation (Juggernaut XL)
  CHARACTER_TEMPERATURE: 1.0,
  SCENE_IMAGE_TEMPERATURE: 0.8,
  COMFYUI_POLL_INTERVAL_MS: 1_000,
  COMFYUI_TIMEOUT_MS: 120_000,
  STEPS: 25,
  CFG: 7,
  IPADAPTER_WEIGHT: 0.7,
  IMAGE_WIDTH: 768,
  IMAGE_HEIGHT: 1536, // 9:16 SDXL native

  // Pipeline
  DEFAULT_DURATION: 45,
  MAX_SCENES: 10,
  CHARACTER_CANDIDATES: 3,
  SCENE_DELAY_MS: 1500,

  // Video (Phase 2 — deferred)
  VIDEO_CONCURRENCY: 2,

  // Output
  OUTPUT_FORMAT: "mp4" as const,
  OUTPUT_RESOLUTION: "1080x1920" as const,
} as const;

export const LABELS = {
  AD_CREATIVE_STATUS: {
    planning: "기획 중",
    character_select: "캐릭터 선택 대기",
    scene_gen: "씬 이미지 생성 중",
    video_gen: "영상 생성 중",
    completed: "완료",
    failed: "실패",
  } as Record<string, string>,
  SCENE_ROLE: {
    hook: "후크",
    body: "본문",
    cta: "CTA",
  } as Record<string, string>,
} as const;
