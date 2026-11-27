import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import nextEnv from "@next/env";

const appDir = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.NUSACBT_DATA_DIR?.trim() || appDir);

process.env.NUSACBT_INTERNAL_PROJECT_ROOT = appDir;
process.env.NODE_ENV = process.env.NODE_ENV || "production";

if (existsSync(join(dataDir, ".env.local")) || existsSync(join(dataDir, ".env"))) {
  nextEnv.loadEnvConfig(dataDir, false);
} else {
  nextEnv.loadEnvConfig(appDir, false);
}

process.chdir(appDir);

const serverUrl = pathToFileURL(join(appDir, "server.js")).href;
await import(serverUrl);
