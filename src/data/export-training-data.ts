import fs from "fs/promises";
import path from "path";
import { prisma } from "../db/prisma.js";

/**
 * 학습 데이터 내보내기 CLI
 *
 * Usage:
 *   npx tsx src/data/export-training-data.ts --step plan --format qwen-lora
 *   npx tsx src/data/export-training-data.ts --step character --format image-caption
 *   npx tsx src/data/export-training-data.ts --step plan --format qwen-lora --min-score 7
 *   npx tsx src/data/export-training-data.ts --step scene_image --format dpo
 */

const args = process.argv.slice(2);

function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const stepArg = getArg("step", "plan");
const formatArg = getArg("format", "qwen-lora");
const minScore = parseFloat(getArg("min-score", "0"));

async function main() {
  const logs = await prisma.trainingLog.findMany({
    where: { step: stepArg, success: true },
    include: { evaluation: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${logs.length} training logs for step="${stepArg}"`);

  // 품질 필터링
  const filtered = minScore > 0
    ? logs.filter((log) => {
        if (!log.evaluation) return false;
        const score = log.evaluation.humanOverride ?? log.evaluation.averageScore;
        return score >= minScore;
      })
    : logs;

  if (minScore > 0) {
    console.log(`After quality filter (>= ${minScore}): ${filtered.length} logs`);
  }

  const exportDir = path.join(
    process.env.OUTPUT_DIR || "./output",
    "exports",
    `${stepArg}_${formatArg}_${Date.now()}`
  );
  await fs.mkdir(exportDir, { recursive: true });

  if (formatArg === "qwen-lora") {
    await exportQwenLora(filtered, exportDir);
  } else if (formatArg === "image-caption") {
    await exportImageCaption(filtered, exportDir);
  } else if (formatArg === "dpo") {
    await exportDPO(logs, exportDir); // DPO는 전체 로그 필요 (좋은/나쁜 쌍)
  } else {
    console.error(
      `Unknown format: ${formatArg}. Use "qwen-lora", "image-caption", or "dpo".`
    );
    process.exit(1);
  }

  await prisma.$disconnect();
}

/**
 * Qwen LoRA 학습용: system + user + assistant messages 포맷 JSONL
 * system prompt를 포함하여 규칙 준수를 학습시킨다.
 */
async function exportQwenLora(
  logs: Awaited<ReturnType<typeof prisma.trainingLog.findMany>>,
  exportDir: string
) {
  const lines = logs.map((log) => {
    const messages: Array<{ role: string; content: string }> = [];

    // system prompt가 기록되어 있으면 포함
    if (log.systemPrompt) {
      messages.push({ role: "system", content: log.systemPrompt });
    }

    messages.push({ role: "user", content: log.inputPrompt });
    messages.push({
      role: "assistant",
      content: log.outputParsed || log.outputRaw || "",
    });

    return JSON.stringify({ messages });
  });

  const outPath = path.join(exportDir, "train.jsonl");
  await fs.writeFile(outPath, lines.join("\n"), "utf-8");
  console.log(`Exported ${lines.length} examples to ${outPath}`);

  // 메타데이터 파일
  await fs.writeFile(
    path.join(exportDir, "metadata.json"),
    JSON.stringify(
      {
        step: stepArg,
        format: "qwen-lora",
        count: lines.length,
        minScore,
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );
}

/**
 * 이미지 LoRA 학습용: 이미지 + 캡션 메타데이터
 */
async function exportImageCaption(
  logs: Awaited<ReturnType<typeof prisma.trainingLog.findMany>>,
  exportDir: string
) {
  const imagesDir = path.join(exportDir, "images");
  await fs.mkdir(imagesDir, { recursive: true });

  const metadata: Array<{
    file: string;
    caption: string;
    score?: number;
  }> = [];

  for (const log of logs) {
    if (!log.outputRaw) continue;

    const srcPath = log.outputRaw;
    const destName = `${log.id}.png`;
    const destPath = path.join(imagesDir, destName);

    const possiblePaths = [
      srcPath,
      path.join(
        process.env.COMFYUI_OUTPUT_DIR || "/opt/comfyui/output",
        srcPath
      ),
    ];

    let copied = false;
    for (const p of possiblePaths) {
      try {
        await fs.copyFile(p, destPath);
        copied = true;
        break;
      } catch {
        continue;
      }
    }

    if (copied) {
      const entry: { file: string; caption: string; score?: number } = {
        file: destName,
        caption: log.inputPrompt,
      };

      // 평가 점수가 있으면 포함
      const evalLog = log as typeof log & {
        evaluation?: { averageScore: number; humanOverride: number | null };
      };
      if (evalLog.evaluation) {
        entry.score =
          evalLog.evaluation.humanOverride ?? evalLog.evaluation.averageScore;
      }

      metadata.push(entry);
    }
  }

  const metaPath = path.join(exportDir, "metadata.jsonl");
  await fs.writeFile(
    metaPath,
    metadata.map((m) => JSON.stringify(m)).join("\n"),
    "utf-8"
  );
  console.log(
    `Exported ${metadata.length} image-caption pairs to ${exportDir}`
  );
}

/**
 * DPO (Direct Preference Optimization) 학습용:
 * 같은 creativeId에 대한 성공 결과들을 점수로 정렬하여 chosen/rejected 쌍 생성
 */
async function exportDPO(
  logs: Awaited<ReturnType<typeof prisma.trainingLog.findMany>>,
  exportDir: string
) {
  // evaluation이 있는 로그를 include해서 다시 쿼리
  const evalLogs = await prisma.trainingLog.findMany({
    where: {
      step: stepArg,
      success: true,
      evaluation: { isNot: null },
    },
    include: { evaluation: true },
    orderBy: { createdAt: "asc" },
  });

  // creativeId별로 그룹핑
  const groups = new Map<string, typeof evalLogs>();
  for (const log of evalLogs) {
    if (!log.creativeId) continue;
    const group = groups.get(log.creativeId) || [];
    group.push(log);
    groups.set(log.creativeId, group);
  }

  const pairs: Array<{
    prompt: string;
    chosen: string;
    rejected: string;
    chosen_score: number;
    rejected_score: number;
  }> = [];

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // 점수순 정렬
    const sorted = group.sort((a, b) => {
      const scoreA =
        a.evaluation!.humanOverride ?? a.evaluation!.averageScore;
      const scoreB =
        b.evaluation!.humanOverride ?? b.evaluation!.averageScore;
      return scoreB - scoreA;
    });

    // 최고 점수 vs 최저 점수 쌍 (점수 차이가 2 이상인 경우만)
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const bestScore =
      best.evaluation!.humanOverride ?? best.evaluation!.averageScore;
    const worstScore =
      worst.evaluation!.humanOverride ?? worst.evaluation!.averageScore;

    if (bestScore - worstScore >= 2) {
      pairs.push({
        prompt: best.inputPrompt,
        chosen: best.outputParsed || best.outputRaw || "",
        rejected: worst.outputParsed || worst.outputRaw || "",
        chosen_score: bestScore,
        rejected_score: worstScore,
      });
    }
  }

  const outPath = path.join(exportDir, "dpo_pairs.jsonl");
  await fs.writeFile(
    outPath,
    pairs.map((p) => JSON.stringify(p)).join("\n"),
    "utf-8"
  );
  console.log(`Exported ${pairs.length} DPO pairs to ${outPath}`);

  await fs.writeFile(
    path.join(exportDir, "metadata.json"),
    JSON.stringify(
      {
        step: stepArg,
        format: "dpo",
        totalLogs: evalLogs.length,
        groups: groups.size,
        pairs: pairs.length,
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );
}

main().catch(console.error);
