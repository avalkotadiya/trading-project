import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "prisma", "schema.prisma");
const generatedSchemaPath = join(root, "lib", "generated", "prisma", "schema.prisma");
const generatedClientPath = join(root, "lib", "generated", "prisma", "index.js");

function isGeneratedClientCurrent() {
  if (!existsSync(generatedClientPath) || !existsSync(generatedSchemaPath)) {
    return false;
  }

  const schemaUpdatedAt = statSync(schemaPath).mtimeMs;
  const clientUpdatedAt = Math.min(
    statSync(generatedClientPath).mtimeMs,
    statSync(generatedSchemaPath).mtimeMs
  );

  return (
    clientUpdatedAt >= schemaUpdatedAt
  );
}

if (isGeneratedClientCurrent()) {
  console.log("Prisma Client is already current; skipping generate.");
  process.exit(0);
}

const result = spawnSync("npx", ["prisma", "generate"], {
  cwd: root,
  shell: process.platform === "win32",
  stdio: "inherit"
});

process.exit(result.status ?? 1);
