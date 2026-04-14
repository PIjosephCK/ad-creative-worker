import fs from "fs/promises";
import path from "path";
import { prisma } from "../db/prisma.js";

/**
 * 학습 데이터 내보내기 CLI
 *
 * Usage:
 *   npx tsx src/data/export-training-data.ts --step plan --format qwen-lora
 *   npx tsx src/data/export-training-data.ts --step character --format image-caption
 */

const args = process.argv.slice(2);
const stepArg = args.find((a) => a.startsWith("--step"))
  ? args[args.indexOf("--step") + 1]
  : "plan";
const formatArg = args.find((a) => a.startsWith("--format"))
  ? args[args.indexOf("--format") + 1]
  : "qwen-lora";

async function main() {
  const logs = await prisma.trainingLog.findMany({
    where: { step: stepArg, success: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${logs.length} training logs for step="${stepArg}"`);

  const exportDir = path.join(
    process.env.OUTPUT_DIR || "./output",
    "exports",
    `${stepArg}_${formatArg}_${Date.now()}`
  );
  await fs.mkdir(exportDir, { recursive: true });

  if (formatArg === "qwen-lora") {
    // Qwen LoRA 학습용: messages 포맷 JSONL
    const lines = logs.map((log) => {
      return JSON.stringify({
        messages: [
          { role: "user", content: log.inputPrompt },
          { role: "assistant", content: log.outputParsed || log.outputRaw || "" },
        ],
      });
    });

    const outPath = path.join(exportDir, "train.jsonl");
    await fs.writeFile(outPath, lines.join("\n"), "utf-8");
    console.log(`Exported ${lines.length} examples to ${outPath}`);
  } else if (formatArg === "image-caption") {
    // 이미지 LoRA 학습용: 이미지 + 캡션 메타데이터
    const imagesDir = path.join(exportDir, "images");
    await fs.mkdir(imagesDir, { recursive: true });

    const metadata: Array<{ file: string; caption: string }> = [];

    for (const log of logs) {
      if (!log.outputRaw) continue;

      // outputRaw는 이미지 파일명 또는 경로
      const srcPath = log.outputRaw;
      const destName = `${log.id}.png`;
      const destPath = path.join(imagesDir, destName);

      try {
        // ComfyUI output에서 복사 시도
        const possiblePaths = [
          srcPath,
          path.join(process.env.COMFYUI_OUTPUT_DIR || "/opt/comfyui/output", srcPath),
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
          metadata.push({ file: destName, caption: log.inputPrompt });
        }
      } catch {
        console.warn(`Could not copy image for log ${log.id}`);
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
  } else {
    console.error(`Unknown format: ${formatArg}. Use "qwen-lora" or "image-caption".`);
    process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
