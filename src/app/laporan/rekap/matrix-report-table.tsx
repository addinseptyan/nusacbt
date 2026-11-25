"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Layers3, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { formatFinalGrade } from "@/lib/exam-final-grade.mjs";
import type { MatrixColumn, MatrixRow } from "@/lib/matrix-report.mjs";

const MAX_VISIBLE_MATRIX_TESTS = 2;

export function MatrixReportTable({
  columns,
  rows,
  page,
  pageSize,
}: {
  columns: MatrixColumn[];
  rows: MatrixRow[];
  page: number;
  pageSize: number;
}) {
  const [selectedRow, setSelectedRow] = useState<MatrixRow | null>(null);
  const visibleColumns = columns.slice(0, MAX_VISIBLE_MATRIX_TESTS);
  const hiddenCount = Math.max(0, columns.length - MAX_VISIBLE_MATRIX_TESTS);

  function renderCellContent(row: MatrixRow, column: MatrixColumn) {
    const value = row.cells[column.id];
    if (!value) return "—";
    if (value.kind === "conflict") {
      return (
        <Link
          className="font-semibold underline"
          href={`/data-tes/monitoring?tes=${column.id}`}
          onClick={(e) => e.stopPropagation()}
        >
          Periksa
        </Link>
      );
    }
    return (
      <>
        {value.score === null ? "—" : formatFinalGrade(value.score)}
        {value.kind === "makeup" && <span className="block text-[10px] font-normal">Susulan</span>}
      </>
    );
  }

  return (
    <>
      {hiddenCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/25 px-5 py-2.5 text-[11px] text-muted-foreground">
          <span>
            Tabel menampilkan maksimal <strong>{MAX_VISIBLE_MATRIX_TESTS} tes</strong> pertama ({hiddenCount} tes lainnya disembunyikan).
          </span>
          <span className="font-medium text-foreground">
            Klik baris siswa untuk membuka seluruh hasil tes ({columns.length} tes)
          </span>
        </div>
      )}
      <div className="overflow-x-auto" data-testid="matrix-table-container">
        <table className="w-full min-w-[680px] text-left text-xs lg:min-w-0 lg:table-fixed">
          <colgroup>
            <col className="w-[5%]" />
            <col className="w-[22%]" />
            <col className="w-[16%]" />
            <col className="w-[12%]" />
            {visibleColumns.length === 1 && <col className="w-[34%]" />}
            {visibleColumns.length === 2 && (
              <>
                <col className="w-[18%]" />
                <col className="w-[18%]" />
              </>
            )}
            <col className={visibleColumns.length === 0 ? "w-[45%]" : "w-[11%]"} />
          </colgroup>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="p-3">No</th>
              <th scope="col" className="p-3">Nama / NISN</th>
              <th scope="col" className="p-3">Grup / kelas</th>
              <th scope="col" className="p-3">Rata-rata</th>
              {visibleColumns.map((c) => (
                <th scope="col" key={c.id} className="p-3 break-words">
                  <span className="block truncate" title={c.name}>{c.name}</span>
                  <span className="mt-0.5 block truncate font-normal text-muted-foreground" title={c.period}>{c.period}</span>
                </th>
              ))}
              <th scope="col" className="p-3 text-right">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => (
              <tr
                key={r.key}
                data-testid="matrix-row"
                tabIndex={0}
                aria-label={`Lihat seluruh hasil tes ${r.name}`}
                onClick={() => setSelectedRow(r)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedRow(r);
                  }
                }}
                className="cursor-pointer border-t transition-colors hover:bg-muted/40 focus-visible:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <td className="p-3 align-top tabular-nums">{(page - 1) * pageSize + index + 1}</td>
                <td className="p-3 align-top break-words">
                  <strong>{r.name}</strong>
                  <span className="mt-1 block text-muted-foreground">{r.nisn}</span>
                </td>
                <td className="p-3 align-top break-words">
                  {r.className}
                  <span className="mt-1 block text-muted-foreground">{r.year ?? "Tahun belum dipetakan"}</span>
                </td>
                <td className="p-3 align-top font-bold tabular-nums">
                  {r.average === null ? "—" : formatFinalGrade(r.average)}
                  <span className="mt-1 block text-[10px] font-normal text-muted-foreground">
                    {r.scoredCount} tes{r.conflicts ? ` · ${r.conflicts} bentrok` : ""}
                  </span>
                </td>
                {visibleColumns.map((c) => {
                  const value = r.cells[c.id];
                  return (
                    <td
                      key={c.id}
                      className={`p-3 align-top break-words tabular-nums ${
                        value?.kind === "makeup"
                          ? "bg-blue-100 font-bold text-blue-900 dark:bg-blue-950 dark:text-blue-200"
                          : value?.kind === "conflict"
                            ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
                            : ""
                      }`}
                    >
                      {renderCellContent(r, c)}
                    </td>
                  );
                })}
                <td className="p-3 text-right align-top">
                  <span className="inline-flex items-center justify-end gap-1 font-semibold text-primary">
                    {hiddenCount > 0 ? `+${hiddenCount}` : "Lihat"}
                    <ChevronRight className="size-3.5" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer
        direction="right"
        open={Boolean(selectedRow)}
        onOpenChange={(open) => {
          if (!open) setSelectedRow(null);
        }}
      >
        <DrawerContent
          aria-label={selectedRow ? `Detail hasil tes ${selectedRow.name}` : "Detail hasil tes"}
          className="w-full sm:max-w-lg"
        >
          {selectedRow && (
            <>
              <DrawerHeader className="border-b pr-12 text-left">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Layers3 className="size-4" />
                  </span>
                  <div>
                    <DrawerTitle>{selectedRow.name}</DrawerTitle>
                    <DrawerDescription>
                      NISN {selectedRow.nisn} · {selectedRow.className} · {selectedRow.year ?? "Tahun belum dipetakan"}
                    </DrawerDescription>
                  </div>
                </div>
                <DrawerClose asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Tutup detail hasil"
                    className="absolute top-3 right-3"
                  >
                    <X className="size-4" />
                  </Button>
                </DrawerClose>
              </DrawerHeader>

              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                    <p className="text-[10px] font-semibold text-muted-foreground">Rata-rata</p>
                    <p className="mt-1 text-base font-bold tabular-nums">
                      {selectedRow.average === null ? "—" : formatFinalGrade(selectedRow.average)}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                    <p className="text-[10px] font-semibold text-muted-foreground">Tes dinilai</p>
                    <p className="mt-1 text-base font-bold tabular-nums">
                      {selectedRow.scoredCount} / {columns.length}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                    <p className="text-[10px] font-semibold text-muted-foreground">Bentrok</p>
                    <p className="mt-1 text-base font-bold tabular-nums">{selectedRow.conflicts}</p>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                      Daftar hasil seluruh tes ({columns.length})
                    </h3>
                    {hiddenCount > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        +{hiddenCount} tes tambahan
                      </Badge>
                    )}
                  </div>
                  <ul className="divide-y divide-border rounded-xl border bg-card" aria-label="Detail seluruh hasil tes siswa">
                    {columns.map((c, idx) => {
                      const value = selectedRow.cells[c.id];
                      const isHiddenFromTable = idx >= MAX_VISIBLE_MATRIX_TESTS;
                      return (
                        <li
                          key={c.id}
                          data-testid="drawer-test-item"
                          className={`flex items-center justify-between gap-3 px-3.5 py-3 text-xs ${
                            value?.kind === "makeup"
                              ? "bg-blue-50/70 dark:bg-blue-950/30"
                              : value?.kind === "conflict"
                                ? "bg-red-50/70 dark:bg-red-950/30"
                                : ""
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-foreground">{c.name}</span>
                              {isHiddenFromTable && (
                                <Badge variant="outline" className="text-[10px]">
                                  Tes #{idx + 1}
                                </Badge>
                              )}
                              {value?.kind === "makeup" && (
                                <Badge className="bg-blue-600 text-[10px] text-white hover:bg-blue-600">
                                  Susulan
                                </Badge>
                              )}
                              {value?.kind === "conflict" && (
                                <Badge variant="destructive" className="text-[10px]">
                                  Bentrok
                                </Badge>
                              )}
                            </div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{c.period}</p>
                          </div>
                          <div className="shrink-0 text-right font-bold tabular-nums">
                            {!value ? (
                              <span className="text-muted-foreground">—</span>
                            ) : value.kind === "conflict" ? (
                              <Link
                                className="text-xs font-semibold text-destructive underline"
                                href={`/data-tes/monitoring?tes=${c.id}`}
                              >
                                Periksa
                              </Link>
                            ) : (
                              <span>{value.score === null ? "—" : formatFinalGrade(value.score)}</span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>

              <DrawerFooter className="border-t">
                <DrawerClose asChild>
                  <Button type="button" variant="outline" className="w-full rounded-xl">
                    Tutup
                  </Button>
                </DrawerClose>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
