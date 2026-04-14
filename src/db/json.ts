/**
 * SQLite에서는 JSON을 문자열로 저장하므로 직렬화 헬퍼.
 */
export function toJsonString<T>(value: T): string {
  return JSON.stringify(value);
}

/**
 * DB에서 읽어온 JSON 문자열을 파싱한다.
 */
export function fromJsonString<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
