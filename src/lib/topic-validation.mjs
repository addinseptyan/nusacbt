/**
 * @param {unknown} value
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
export function validateTopicName(value) {
  const invalid = { ok: false, error: "Nama wajib diisi, maksimal 100 karakter, tanpa karakter kontrol." };
  if (typeof value !== "string" || value.length > 1024 || !value.isWellFormed() || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return invalid;
  const name = value.trim();
  if (!name || Array.from(name).length > 100) return invalid;
  return { ok: true, value: name };
}

/**
 * Validasi daftar tag (maksimal 10 tag unik per entitas, masing-masing 1-30 karakter)
 * dan mengurutkan hasilnya secara alfabetis.
 * Menerima array string atau string dipisah koma.
 * @param {unknown} value
 * @param {string} [entityLabel]
 * @returns {{ok: true, value: string[], signature: string} | {ok: false, error: string}}
 */
export function validateTagList(value, entityLabel = "mata pelajaran / topik") {
  let rawItems = [];
  if (value === null || value === undefined || value === "") {
    rawItems = [];
  } else if (Array.isArray(value)) {
    rawItems = value;
  } else if (typeof value === "string") {
    if (value.length > 2048 || !value.isWellFormed() || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
      return { ok: false, error: "Tag mengandung karakter yang tidak valid atau terlalu panjang." };
    }
    rawItems = value.split(",");
  } else {
    return { ok: false, error: "Format tag tidak valid." };
  }

  /** @type {string[]} */
  const tags = [];
  const seen = new Set();
  for (const item of rawItems) {
    if (typeof item !== "string" || !item.isWellFormed() || /[\u0000-\u001f\u007f-\u009f]/.test(item)) {
      return { ok: false, error: "Setiap tag harus berupa teks tanpa karakter kontrol." };
    }
    const cleaned = item.trim().replace(/\s+/g, " ");
    if (!cleaned) continue;
    if (Array.from(cleaned).length > 30) {
      return { ok: false, error: "Setiap tag maksimal 30 karakter." };
    }
    const lower = cleaned.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      tags.push(cleaned);
    }
    if (tags.length > 10) {
      return { ok: false, error: `Maksimal 10 tag untuk setiap ${entityLabel}.` };
    }
  }

  tags.sort((a, b) => a.localeCompare(b, "id", { sensitivity: "base" }) || a.localeCompare(b));
  const signature = tags.length === 0 ? "" : tags.map((tag) => tag.toLowerCase()).sort().join("\x1f");
  return { ok: true, value: tags, signature };
}

/**
 * Validasi daftar tag mata pelajaran (diurutkan alfabetis).
 * @param {unknown} value
 * @returns {{ok: true, value: string[], signature: string} | {ok: false, error: string}}
 */
export function validateTopicTags(value) {
  return validateTagList(value, "mata pelajaran / topik");
}

/**
 * Pencarian multi-kata tidak terurut: seluruh kata kunci (dipisah spasi) harus muncul
 * di salah satu bagian teks kandidat (mis. "kelas x matematika" cocok dengan "Matematika" + tag "Kelas X").
 * @param {string} search
 * @param {Array<string | null | undefined>} parts
 * @returns {boolean}
 */
export function matchesMultiKeyword(search, parts) {
  const tokens = search.trim().toLocaleLowerCase("id-ID").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = parts
    .filter((part) => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLocaleLowerCase("id-ID");
  return tokens.every((token) => hay.includes(token));
}

/**
 * Format tampilan nama topik beserta tag bila tersedia.
 * @param {{ name: string, tags?: string[] | null }} topic
 * @returns {string}
 */
export function formatTopicLabel(topic) {
  if (Array.isArray(topic.tags) && topic.tags.length > 0) {
    return `${topic.name} (${topic.tags.join(", ")})`;
  }
  return topic.name;
}

/**
 * xmin adalah versi baris PostgreSQL, digunakan untuk mendeteksi formulir usang.
 * @param {unknown} value
 * @returns {string | null}
 */
export function validTopicRevision(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,9}$/.test(value)) return null;
  return BigInt(value) <= BigInt("4294967295") ? value : null;
}
