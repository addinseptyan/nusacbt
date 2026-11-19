"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Columns2, Italic, List, ListOrdered, Redo2, Rows3, Subscript, Superscript, Table2, Trash2, Underline, Undo2 } from "lucide-react";

import { questionEditorExtensions } from "@/lib/question-editor-extensions";
import { parseMathML } from "@/lib/question-math.mjs";
import { legacyToRich, richToPlain, sanitizeRichDocument } from "@/lib/question-rich.mjs";

const buttonClass = "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-xs font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-35";

export function QuestionRichEditor({ id, label, field, initialDocument, initialText, disabled }: { id: string; label: string; field: string; initialDocument: unknown; initialText: string; disabled: boolean }) {
  const [warning, setWarning] = useState("");
  const [initial] = useState(() => {
    try { return { doc: initialDocument == null ? legacyToRich(initialText) : sanitizeRichDocument(initialDocument), invalid: false }; }
    catch { return { doc: legacyToRich(initialText), invalid: true }; }
  });
  const [richValue, setRichValue] = useState(() => initial.invalid ? "{}" : JSON.stringify(initial.doc));
  const [plainValue, setPlainValue] = useState(() => richToPlain(initial.doc));
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: questionEditorExtensions(),
    content: initial.doc,
    editable: !disabled && !initial.invalid,
    editorProps: {
      attributes: { id, "aria-label": label, "aria-multiline": "true", role: "textbox", class: "question-rich-content question-editor-area" },
      handlePaste(view, event) {
        const clip = event.clipboardData;
        if (!clip) return false;
        const plain = clip.getData("text/plain").trim();
        const html = clip.getData("text/html");
        if (/^(?:<\?xml[^>]*>\s*)?<(?:[\w.-]+:)?math(?:\s|>)/i.test(plain)) {
          event.preventDefault();
          try {
            const formula = parseMathML(plain);
            const type = view.state.schema.nodes.mathFormula;
            if (!type) throw new Error("Formula node is unavailable.");
            view.dispatch(view.state.tr.replaceSelectionWith(type.create({ formula })).scrollIntoView());
            setWarning("");
          } catch { setWarning("Rumus yang ditempel tidak didukung. Periksa bentuknya atau gunakan gambar; tidak ada isi yang ditempel."); }
          return true;
        }
        // Word may provide OMML or a local preview image when copying a selection that mixes text and equations.
        // Do not silently flatten an equation/image. Copy a single equation as MathML, and text/table separately.
        if (/<(?:[\w.-]+:)?(?:omath|omathpara|math|oleobject|shape|img|image|svg|iframe|object|embed|video|audio|source|link|script)\b/i.test(html) || clip.files.length) {
          event.preventDefault();
          setWarning("Tempelan berisi rumus, gambar, atau objek yang belum dapat dibaca langsung. Salin rumus satu per satu sebagai MathML; unggah gambar lewat pilihan file. Tidak ada isi yang ditempel.");
          return true;
        }
        // ProseMirror joins the first pasted paragraph to an empty destination
        // paragraph and otherwise loses its direction attribute. Preserve an
        // explicit Word/HTML direction only when the destination is empty.
        const { $from, empty } = view.state.selection;
        if (html && empty && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0) {
          const first = new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
          if (first instanceof HTMLElement && first.tagName === "P") {
            const direction = (first.getAttribute("dir") || first.style.direction).toLowerCase();
            if (direction === "rtl" || direction === "ltr") {
              view.dispatch(view.state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, dir: direction }));
            }
          }
        }
        setWarning("");
        return false;
      },
    },
    onUpdate({ editor: updated }) {
      // setEditable() can emit an update during initialization; do not replace
      // the invalid sentinel with a lossy plaintext fallback in that case.
      if (initial.invalid) return;
      const doc = updated.getJSON();
      setRichValue(JSON.stringify(doc));
      try { setPlainValue(richToPlain(sanitizeRichDocument(doc))); }
      catch { setPlainValue(""); }
    },
  });
  useEffect(() => { editor?.setEditable(!disabled && !initial.invalid, false); }, [disabled, editor, initial.invalid]);
  const inTable = editor?.isActive("table") ?? false;
  function control(name: string, icon: React.ReactNode, run: () => void, active = false, unavailable = false) {
    return <button type="button" aria-label={`${name} — ${label}`} title={name} disabled={!editor || disabled || initial.invalid || unavailable} aria-pressed={active} className={`${buttonClass} ${active ? "bg-primary/15 text-primary" : "text-foreground"}`} onMouseDown={(event) => event.preventDefault()} onClick={run}>{icon}</button>;
  }

  return <div className="min-w-0 rounded-xl border border-input bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
    <input type="hidden" name={field} value={plainValue} readOnly />
    <input type="hidden" name={`${field}_rich`} value={richValue} readOnly />
    <div role="toolbar" aria-label={`Pemformatan ${label}`} className="flex flex-wrap items-center gap-0.5 border-b border-border p-1.5">
      {control("Tebal", <Bold size={15} />, () => { editor?.chain().focus().toggleBold().run(); }, editor?.isActive("bold"))}
      {control("Miring", <Italic size={15} />, () => { editor?.chain().focus().toggleItalic().run(); }, editor?.isActive("italic"))}
      {control("Garis bawah", <Underline size={15} />, () => { editor?.chain().focus().toggleUnderline().run(); }, editor?.isActive("underline"))}
      {control("Subskrip", <Subscript size={15} />, () => { editor?.chain().focus().toggleSubscript().run(); }, editor?.isActive("subscript"))}
      {control("Superskrip", <Superscript size={15} />, () => { editor?.chain().focus().toggleSuperscript().run(); }, editor?.isActive("superscript"))}
      <span className="mx-1 h-5 w-px bg-border" />
      {control("Daftar berpoin", <List size={15} />, () => { editor?.chain().focus().toggleBulletList().run(); }, editor?.isActive("bulletList"))}
      {control("Daftar bernomor", <ListOrdered size={15} />, () => { editor?.chain().focus().toggleOrderedList().run(); }, editor?.isActive("orderedList"))}
      {control("Rata kiri", <AlignLeft size={15} />, () => { editor?.chain().focus().setTextAlign("left").run(); }, editor?.isActive({ textAlign: "left" }))}
      {control("Rata tengah", <AlignCenter size={15} />, () => { editor?.chain().focus().setTextAlign("center").run(); }, editor?.isActive({ textAlign: "center" }))}
      {control("Rata kanan", <AlignRight size={15} />, () => { editor?.chain().focus().setTextAlign("right").run(); }, editor?.isActive({ textAlign: "right" }))}
      {control("Arah kiri ke kanan", <span>LTR</span>, () => { editor?.chain().focus().updateAttributes("paragraph", { dir: "ltr" }).run(); }, editor?.isActive("paragraph", { dir: "ltr" }))}
      {control("Arah kanan ke kiri", <span>RTL</span>, () => { editor?.chain().focus().updateAttributes("paragraph", { dir: "rtl" }).run(); }, editor?.isActive("paragraph", { dir: "rtl" }))}
      <span className="mx-1 h-5 w-px bg-border" />
      {control("Tambah tabel", <Table2 size={15} />, () => { editor?.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run(); }, false, inTable)}
      {control("Tambah baris tabel", <span className="flex items-center gap-0.5"><Rows3 size={14} />+</span>, () => { editor?.chain().focus().addRowAfter().run(); }, false, !inTable)}
      {control("Hapus baris tabel", <span className="flex items-center gap-0.5"><Rows3 size={14} />−</span>, () => { editor?.chain().focus().deleteRow().run(); }, false, !inTable)}
      {control("Tambah kolom tabel", <span className="flex items-center gap-0.5"><Columns2 size={14} />+</span>, () => { editor?.chain().focus().addColumnAfter().run(); }, false, !inTable)}
      {control("Hapus kolom tabel", <span className="flex items-center gap-0.5"><Columns2 size={14} />−</span>, () => { editor?.chain().focus().deleteColumn().run(); }, false, !inTable)}
      {control("Hapus tabel", <Trash2 size={15} />, () => { editor?.chain().focus().deleteTable().run(); }, false, !inTable)}
      {control("Urungkan", <Undo2 size={15} />, () => { editor?.chain().focus().undo().run(); })}
      {control("Ulangi", <Redo2 size={15} />, () => { editor?.chain().focus().redo().run(); })}
    </div>
    <EditorContent editor={editor} />
    {initial.invalid && <p role="alert" className="border-t border-border px-3 py-2 text-xs leading-5 text-destructive">Format tersimpan tidak dapat dibaca. Penyuntingan dan penyimpanan soal ini diblokir agar konten asli tidak tertimpa; hubungi administrator untuk memeriksa data.</p>}
    {warning && <p role="alert" className="border-t border-border px-3 py-2 text-xs leading-5 text-destructive">{warning}</p>}
  </div>;
}
