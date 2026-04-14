import OpenAI from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
      apiKey: "ollama", // required by SDK, ignored by Ollama
    });
  }
  return _client;
}

/**
 * Qwen3 텍스트 생성 (OpenAI-compatible API via Ollama)
 * Claude Code 패턴 적용: system/user role 분리
 */
export async function generateContent(
  prompt: string,
  options: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    systemPrompt?: string;
  } = {}
): Promise<string> {
  const client = getClient();
  const model = process.env.OLLAMA_MODEL || "qwen3:8b";

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  // system role 분리 — Qwen이 규칙을 더 잘 따름
  if (options.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }

  // Qwen3: /no_think suffix disables thinking mode for structured output
  const finalPrompt = options.jsonMode
    ? `${prompt}\n\n/no_think`
    : prompt;

  messages.push({ role: "user", content: finalPrompt });

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxTokens ?? 4096,
    ...(options.jsonMode && {
      response_format: { type: "json_object" },
    }),
  });

  return response.choices[0]?.message?.content ?? "";
}

/**
 * Qwen-VL 멀티모달 이미지 분석 (이미지 URL 또는 base64)
 */
export async function analyzeImage(
  prompt: string,
  imageBase64: string,
  mimeType: string = "image/jpeg",
  systemPrompt?: string
): Promise<string> {
  const client = getClient();
  const model = process.env.OLLAMA_VL_MODEL || "qwen2.5-vl:7b";

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  messages.push({
    role: "user",
    content: [
      {
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${imageBase64}`,
        },
      },
      { type: "text", text: `${prompt}\n\n/no_think` },
    ],
  });

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.2,
    max_tokens: 2048,
    response_format: { type: "json_object" },
  });

  return response.choices[0]?.message?.content ?? "";
}

/**
 * Gemini 호환 extractJson — 응답에서 JSON 추출
 */
export function extractJson(raw: string): Record<string, unknown> | null {
  let cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const result = JSON.parse(match[0]);
      if (
        typeof result === "object" &&
        result !== null &&
        Object.values(result).some(Boolean)
      ) {
        return result;
      }
    } catch {
      // JSON parse failed
    }
  }
  return null;
}
