"use client";

import { useMemo, useState } from "react";
import { SearchableCombobox, type ComboboxOption } from "@/components/searchable-combobox";

export function MatrixTestFilter({
  tests,
  initialTestId,
  unknownTest,
}: {
  tests: Array<{ id: string; name: string; period: string; tags: string[] }>;
  initialTestId: string | null;
  unknownTest: boolean;
}) {
  const [value, setValue] = useState(initialTestId ?? "");

  const options = useMemo<ComboboxOption[]>(() => {
    const items: ComboboxOption[] = tests.map((t) => ({
      value: t.id,
      label: t.name,
      subtitle: t.period,
      tags: t.tags,
      keywords: t.id,
    }));
    if (unknownTest && initialTestId) {
      items.unshift({ value: initialTestId, label: "Tes tidak ditemukan" });
    }
    return items;
  }, [initialTestId, tests, unknownTest]);

  return (
    <div>
      <label htmlFor="matrix-test" className="mb-1 block text-xs font-semibold">
        Tes
      </label>
      <SearchableCombobox
        id="matrix-test"
        name="tes"
        options={options}
        value={value}
        onChange={setValue}
        placeholder="Semua tes"
        searchPlaceholder="Cari nama tes, tag, atau periode (multi kata)..."
        emptyOptionLabel="Semua tes"
        ariaLabel="Tes"
      />
    </div>
  );
}
