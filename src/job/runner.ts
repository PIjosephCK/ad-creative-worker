import { prisma } from "../db/prisma.js";
import type { JobCallbacks } from "../pipeline/types.js";

/**
 * Job을 생성하고 비동기 실행한다.
 * BullMQ 없이 단순 DB 기반 job tracking.
 */
export async function executeJob(
  type: string,
  inputData: Record<string, unknown>,
  fn: (callbacks: JobCallbacks) => Promise<unknown>
): Promise<string> {
  const job = await prisma.job.create({
    data: {
      type,
      status: "running",
      inputData: JSON.stringify(inputData),
      startedAt: new Date(),
    },
  });

  // 비동기 실행 (즉시 jobId 반환)
  (async () => {
    const callbacks: JobCallbacks = {
      onStatus: async (message) => {
        await prisma.job.update({
          where: { id: job.id },
          data: { statusMessage: message },
        });
      },
      onProgress: async (step, total) => {
        await prisma.job.update({
          where: { id: job.id },
          data: { progress: step, totalSteps: total },
        });
      },
    };

    try {
      const result = await fn(callbacks);
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "completed",
          outputData: JSON.stringify(result),
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "failed",
          error: msg,
          completedAt: new Date(),
        },
      });
    }
  })();

  return job.id;
}

/**
 * Job 상태 조회
 */
export async function getJobStatus(jobId: string) {
  return prisma.job.findUnique({ where: { id: jobId } });
}
