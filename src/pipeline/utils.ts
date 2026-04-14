/**
 * 씬 metadata에 새 필드를 안전하게 병합 (SQLite JSON 문자열용)
 */
export function mergeSceneMetadata(
  existing: string | null,
  updates: Record<string, unknown>
): string {
  let base: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed;
      }
    } catch {
      // ignore parse errors
    }
  }
  return JSON.stringify({ ...base, ...updates });
}

/**
 * unknown 타입 에러에서 메시지를 추출
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * MIME 타입에서 파일 확장자 추론
 */
export function mimeToExt(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}

/**
 * 이미지 URL/경로에서 MIME 타입 추론
 */
export function inferMimeType(url: string): string {
  if (url.endsWith(".png")) return "image/png";
  if (url.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
