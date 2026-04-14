import fs from "fs/promises";
import path from "path";

const OUTPUT_DIR = () => process.env.OUTPUT_DIR || "./output";
const BASE_URL = () => process.env.BASE_URL || "http://localhost:3000";

/**
 * 이미지를 로컬 파일시스템에 저장하고 접근 가능한 URL을 반환한다.
 */
export async function saveImage(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<{ url: string; path: string }> {
  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(OUTPUT_DIR(), "images", `${timestamp}_${safeName}`);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);

  const relativePath = path.relative(OUTPUT_DIR(), filePath).replace(/\\/g, "/");
  const url = `${BASE_URL()}/output/${relativePath}`;

  return { url, path: filePath };
}

/**
 * 이미지 삭제
 */
export async function deleteImage(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // 이미 삭제된 경우 무시
  }
}

/**
 * 디렉토리의 이미지 목록 조회
 */
export async function listImages(
  subdir: string = "images"
): Promise<Array<{ name: string; url: string; path: string }>> {
  const dir = path.join(OUTPUT_DIR(), subdir);
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .map((f) => ({
        name: f,
        url: `${BASE_URL()}/output/${subdir}/${f}`,
        path: path.join(dir, f),
      }));
  } catch {
    return [];
  }
}

/**
 * 스토리지 용량 조회
 */
export async function getStorageStats(): Promise<{
  totalFiles: number;
  totalSizeBytes: number;
  totalSizeMB: number;
  subdirs: Record<string, { files: number; sizeBytes: number }>;
}> {
  const baseDir = OUTPUT_DIR();
  const subdirs: Record<string, { files: number; sizeBytes: number }> = {};
  let totalFiles = 0;
  let totalSizeBytes = 0;

  try {
    const dirs = await fs.readdir(baseDir);
    for (const dir of dirs) {
      const dirPath = path.join(baseDir, dir);
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) continue;

      let files = 0;
      let sizeBytes = 0;
      try {
        const entries = await fs.readdir(dirPath);
        for (const entry of entries) {
          try {
            const entryStat = await fs.stat(path.join(dirPath, entry));
            if (entryStat.isFile()) {
              files++;
              sizeBytes += entryStat.size;
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }

      subdirs[dir] = { files, sizeBytes };
      totalFiles += files;
      totalSizeBytes += sizeBytes;
    }
  } catch { /* empty dir */ }

  return {
    totalFiles,
    totalSizeBytes,
    totalSizeMB: Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100,
    subdirs,
  };
}

/**
 * 특정 이미지 삭제 (파일명 기반)
 */
export async function deleteImageByName(
  subdir: string,
  fileName: string
): Promise<boolean> {
  const filePath = path.join(OUTPUT_DIR(), subdir, fileName);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 서브디렉토리의 모든 이미지 삭제
 */
export async function clearSubdir(subdir: string): Promise<number> {
  const dir = path.join(OUTPUT_DIR(), subdir);
  let deleted = 0;
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      try {
        await fs.unlink(path.join(dir, f));
        deleted++;
      } catch { /* skip */ }
    }
  } catch { /* dir doesn't exist */ }
  return deleted;
}

/**
 * 업로드된 첨부 이미지를 임시 저장하고 경로를 반환
 */
export async function saveUploadedImage(
  buffer: Buffer,
  originalName: string
): Promise<string> {
  const timestamp = Date.now();
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(OUTPUT_DIR(), "uploads", `${timestamp}_${safeName}`);

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);

  return filePath;
}
