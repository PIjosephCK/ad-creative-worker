import fs from "fs/promises";
import path from "path";
import WebSocket from "ws";

const COMFYUI_URL = () => process.env.COMFYUI_URL || "http://localhost:8188";
const COMFYUI_WS_URL = () => process.env.COMFYUI_WS_URL || "ws://localhost:8188/ws";

interface ComfyResult {
  images: Array<{ filename: string; subfolder: string; type: string }>;
}

/**
 * ComfyUI 워크플로우 JSON 로드 + 변수 치환
 */
export async function loadWorkflow(
  templateName: string,
  variables: Record<string, string | number>
): Promise<Record<string, unknown>> {
  const templatePath = path.join(
    process.cwd(),
    "src",
    "workflows",
    templateName
  );
  let content = await fs.readFile(templatePath, "utf-8");

  for (const [key, value] of Object.entries(variables)) {
    content = content.replaceAll(`{{${key}}}`, String(value));
  }

  return JSON.parse(content);
}

/**
 * ComfyUI에 워크플로우 제출 → prompt_id 반환
 */
export async function queuePrompt(
  workflow: Record<string, unknown>
): Promise<string> {
  const res = await fetch(`${COMFYUI_URL()}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ComfyUI queue failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { prompt_id: string };
  return data.prompt_id;
}

/**
 * WebSocket으로 ComfyUI 작업 완료 대기
 * ComfyUI 0.19.0: "executed" = per-node, "execution_success" = per-prompt
 */
export async function waitForCompletion(
  promptId: string,
  timeoutMs: number = 120_000
): Promise<ComfyResult> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${COMFYUI_WS_URL()}?clientId=worker`);
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => reject(new Error(`ComfyUI timeout after ${timeoutMs}ms`)));
    }, timeoutMs);

    ws.on("message", (raw) => {
      try {
        const text = raw.toString();
        if (!text.startsWith("{")) return; // skip binary preview frames

        const msg = JSON.parse(text);

        // per-node completion with output (legacy + some versions)
        if (msg.type === "executed" && msg.data?.prompt_id === promptId) {
          const output = msg.data.output;
          if (output?.images) {
            settle(() => resolve({ images: output.images }));
            return;
          }
        }

        // per-prompt completion (ComfyUI 0.19.0+)
        if (msg.type === "execution_success" && msg.data?.prompt_id === promptId) {
          settle(() => {
            fetchHistoryResult(promptId).then(resolve).catch(reject);
          });
          return;
        }

        // execution error
        if (msg.type === "execution_error" && msg.data?.prompt_id === promptId) {
          settle(() =>
            reject(new Error(`ComfyUI 실행 에러: ${msg.data.exception_message || "unknown"}`))
          );
          return;
        }
      } catch {
        // ignore non-JSON messages (binary preview frames)
      }
    });

    ws.on("error", (err) => {
      settle(() => reject(new Error(`ComfyUI WebSocket error: ${err.message}`)));
    });
  });
}

/**
 * ComfyUI history API에서 실행 결과 가져오기
 */
async function fetchHistoryResult(promptId: string): Promise<ComfyResult> {
  const res = await fetch(`${COMFYUI_URL()}/history/${promptId}`);
  if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);

  const history = (await res.json()) as Record<string, unknown>;
  const entry = history[promptId] as
    | { outputs?: Record<string, { images?: ComfyResult["images"]; gifs?: ComfyResult["images"] }> }
    | undefined;

  if (entry?.outputs) {
    for (const output of Object.values(entry.outputs)) {
      // AnimateDiff returns "gifs" instead of "images"
      const items = output?.images || output?.gifs;
      if (items?.length) {
        return { images: items };
      }
    }
  }
  throw new Error("No images/gifs in history after execution_success");
}

/**
 * 폴링 방식으로 완료 대기 (WebSocket 불가 시 fallback)
 */
export async function pollForCompletion(
  promptId: string,
  intervalMs: number = 1_000,
  timeoutMs: number = 120_000
): Promise<ComfyResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${COMFYUI_URL()}/history/${promptId}`);
    if (res.ok) {
      const history = (await res.json()) as Record<string, unknown>;
      const entry = history[promptId] as
        | { outputs?: Record<string, { images?: ComfyResult["images"]; gifs?: ComfyResult["images"] }> }
        | undefined;

      if (entry?.outputs) {
        for (const output of Object.values(entry.outputs)) {
          const items = output?.images || output?.gifs;
          if (items?.length) {
            return { images: items };
          }
        }
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`ComfyUI poll timeout after ${timeoutMs}ms`);
}

/**
 * ComfyUI 출력 이미지 다운로드
 */
export async function downloadImage(
  filename: string,
  subfolder: string = "",
  type: string = "output"
): Promise<Buffer> {
  const params = new URLSearchParams({ filename, subfolder, type });
  const res = await fetch(`${COMFYUI_URL()}/view?${params}`);

  if (!res.ok) {
    throw new Error(`ComfyUI image download failed: ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * ComfyUI input 폴더에 이미지 업로드 (참조 이미지용)
 */
export async function uploadInputImage(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const formData = new FormData();
  formData.append("image", new Blob([new Uint8Array(buffer)]), filename);
  formData.append("overwrite", "true");

  const res = await fetch(`${COMFYUI_URL()}/upload/image`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`ComfyUI upload failed: ${res.status}`);
  }

  const data = (await res.json()) as { name: string };
  return data.name;
}

/**
 * 워크플로우 실행 → 이미지 다운로드까지 한번에
 */
export async function generateImage(
  workflow: Record<string, unknown>,
  options?: { timeoutMs?: number }
): Promise<{ buffer: Buffer; filename: string }> {
  const promptId = await queuePrompt(workflow);

  let result: ComfyResult;
  try {
    result = await waitForCompletion(
      promptId,
      options?.timeoutMs || 120_000
    );
  } catch {
    // WebSocket 실패 시 polling fallback
    result = await pollForCompletion(promptId);
  }

  const img = result.images[0];
  const buffer = await downloadImage(img.filename, img.subfolder, img.type);
  return { buffer, filename: img.filename };
}

/**
 * ComfyUI 서비스 상태 확인
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${COMFYUI_URL()}/system_stats`);
    return res.ok;
  } catch {
    return false;
  }
}
