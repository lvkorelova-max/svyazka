import { PrismaClient } from "@prisma/client";
import { runStage8Retention } from "../attribution/stage8-retention";

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(JSON.stringify(await runStage8Retention(prisma, "preview")));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error("Stage 8 retention preview failed");
  process.exitCode = 1;
});
