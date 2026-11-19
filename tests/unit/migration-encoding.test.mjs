import assert from "node:assert/strict";
import { test } from "node:test";

import { requireUtf8Database } from "../../scripts/migration-encoding.mjs";

test("pemeriksaan migrasi menerima UTF8 dan hanya membaca encoding", async () => {
  const queries = [];
  const client = { query: async (sql) => { queries.push(sql); return { rows: [{ encoding: "UTF8" }] }; } };
  await requireUtf8Database(client);
  assert.deepEqual(queries, ["SELECT current_setting('server_encoding') AS encoding"]);
});

test("pemeriksaan migrasi menolak encoding lain atau hasil kosong tanpa mengubah database", async () => {
  for (const rows of [[{ encoding: "SQL_ASCII" }], [{ encoding: "LATIN1" }], []]) {
    const queries = [];
    const client = { query: async (sql) => { queries.push(sql); return { rows }; } };
    await assert.rejects(requireUtf8Database(client), /Database harus menggunakan encoding UTF8/);
    assert.deepEqual(queries, ["SELECT current_setting('server_encoding') AS encoding"]);
  }
  const dbError = new Error("connection lost");
  await assert.rejects(requireUtf8Database({ query: async () => { throw dbError; } }), (error) => error === dbError);
});
