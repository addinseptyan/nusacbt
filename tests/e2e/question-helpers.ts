import { createHash, randomBytes } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import pg from "pg";

import { postgresConfig } from "../../src/lib/postgres-config.mjs";

export const LETTERS = ["A", "B", "C", "D", "E"] as const;
export const SLOTS = ["prompt", ...LETTERS] as const;
export const suffix = () => randomBytes(5).toString("hex");

export function testDatabase() {
  if (process.env.PGDATABASE !== "nusacbt_test") throw new Error("Tes soal hanya boleh memakai PGDATABASE=nusacbt_test.");
  return new pg.Client(postgresConfig());
}

export async function createTopic(client: pg.Client, name: string) {
  return (await client.query<{ id: string }>("INSERT INTO question_topics(name) VALUES($1) RETURNING id::text AS id", [name])).rows[0].id;
}

export async function createQuestion(client: pg.Client, topicId: string, prompt: string, image?: Buffer) {
  return (await client.query<{ id: string; revision: string }>(
    `INSERT INTO question_bank(topic_id,prompt_text,option_a_text,option_b_text,option_c_text,option_d_text,option_e_text,correct_option,prompt_image,prompt_image_mime)
     VALUES($1,$2,'Alpha','Beta','Gamma','Delta','Epsilon','C',$3,$4) RETURNING id::text AS id,xmin::text AS revision`,
    [topicId, prompt, image ?? null, image ? "image/png" : null],
  )).rows[0];
}

export async function cleanupTopics(client: pg.Client, topicIds: string[]) {
  if (!topicIds.length) return;
  await client.query("DELETE FROM question_bank WHERE topic_id=ANY($1::bigint[])", [topicIds]);
  await client.query("DELETE FROM question_import_batches WHERE topic_id=ANY($1::bigint[])", [topicIds]);
  await client.query("DELETE FROM question_topics WHERE id=ANY($1::bigint[])", [topicIds]);
}

export function questionRow(page: Page, id: string) {
  return page.getByRole("list", { name: "Daftar soal" }).getByRole("listitem").filter({ has: page.getByText(`Soal #${id}`, { exact: true }) });
}

export async function editor(page: Page, id?: string): Promise<Locator> {
  if (id) await questionRow(page, id).getByRole("button", { name: `Ubah soal ${id}`, exact: true }).click();
  else await page.getByRole("button", { name: "Tambah soal", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: id ? "Ubah soal" : "Tambah soal", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function deletion(page: Page, id: string): Promise<Locator> {
  await questionRow(page, id).getByRole("button", { name: `Hapus soal ${id}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Hapus soal?", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function selectComboboxOption(scope: Locator | Page, label: string, optionText: string) {
  const trigger = scope.getByLabel(label);
  const listId = await trigger.getAttribute("aria-controls");
  await trigger.click();
  const root = "page" in scope ? scope.page() : scope;
  const listbox = listId ? root.locator(`[id="${listId}"]`) : root.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const escaped = optionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await listbox
    .getByRole("option")
    .filter({ has: root.locator("span.break-words", { hasText: new RegExp(`^${escaped}$`) }) })
    .first()
    .click();
}

export async function fillDraft(dialog: Locator, topic: string, prompt: string, choices = ["Satu", "Dua", "Tiga", "Empat", "Lima"], correct = "D") {
  await selectComboboxOption(dialog, "Topik / mata pelajaran", topic);
  await dialog.getByRole("textbox", { name: "Isi soal", exact: true }).fill(prompt);
  for (const [index, letter] of LETTERS.entries()) await dialog.getByLabel(`Pilihan ${letter}`, { exact: true }).fill(choices[index]);
  await dialog.getByLabel(`Jawaban ${correct} benar`).check();
}

export async function sessionDigest(page: Page) {
  const cookie = (await page.context().cookies()).find((item) => item.name === "nusacbt_admin_session");
  if (!cookie) throw new Error("Cookie sesi tes tidak ditemukan.");
  return createHash("sha256").update(cookie.value).digest("hex");
}
