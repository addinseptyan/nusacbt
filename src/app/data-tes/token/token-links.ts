import type { Zone } from "@/app/data-tes/token/token-display";

export type DateFilter = { mode: "today" | "date" | "all"; date: string | null };

function filterParams(zone: Zone, filter: DateFilter) {
  const query = new URLSearchParams();
  if (filter.mode === "all") query.set("tanggal", "all");
  if (filter.mode === "date" && filter.date) query.set("tanggal", filter.date);
  if (zone !== "WIB") query.set("zona", zone);
  return query;
}
function url(path: string, query: URLSearchParams) {
  const suffix = query.toString();
  return `${path}${suffix ? `?${suffix}` : ""}`;
}

export function tokenUrl(zone: Zone, filter: DateFilter, page = 1) {
  const query = filterParams(zone, filter);
  if (page > 1) query.set("halaman", String(page));
  return url("/data-tes/token", query);
}

// Hanya parameter yang divalidasi dan disusun ulang; bukan URL kembali bebas.
export function tokenHistoryUrl(zone: Zone, filter: DateFilter, fromPage = 1, historyPage = 1) {
  const query = filterParams(zone, filter);
  if (fromPage > 1) query.set("asal", String(fromPage));
  if (historyPage > 1) query.set("halaman", String(historyPage));
  return url("/data-tes/token/riwayat", query);
}
