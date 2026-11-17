import "server-only";
import { Pool } from "pg";

import { postgresConfig } from "@/lib/postgres-config.mjs";

const globalForPostgres = globalThis as typeof globalThis & { nusacbtPool?: Pool };

export function getPostgresPool() {
  if (!globalForPostgres.nusacbtPool) {
    const pool = new Pool({ ...postgresConfig(), max: 5, idleTimeoutMillis: 30_000 });
    pool.on("error", () => console.error("Koneksi PostgreSQL yang tidak aktif terputus."));
    globalForPostgres.nusacbtPool = pool;
  }
  return globalForPostgres.nusacbtPool;
}
