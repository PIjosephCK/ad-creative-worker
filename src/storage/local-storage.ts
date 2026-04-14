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
