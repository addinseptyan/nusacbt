import { Extension, Node } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";

import { formulaDomSpec, mathToText, sanitizeFormula } from "@/lib/question-math.mjs";

const Direction = Extension.create({
  name: "questionDirection",
  addGlobalAttributes() {
    return [{
      types: ["paragraph"],
      attributes: {
        dir: {
          default: "auto",
          parseHTML: (element: HTMLElement) => {
            const direction = element.getAttribute("dir")?.toLowerCase();
            return direction === "rtl" || direction === "ltr" ? direction : "auto";
          },
          renderHTML: (attributes: Record<string, unknown>) => ({ dir: attributes.dir === "rtl" || attributes.dir === "ltr" ? attributes.dir : "auto" }),
        },
      },
    }];
  },
});

const MathFormula = Node.create({
  name: "mathFormula",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { formula: { default: null, rendered: false } };
  },
  parseHTML() {
    return [{
      tag: "span[data-question-formula]",
      getAttrs(element) {
        if (!(element instanceof HTMLElement)) return false;
        try { return { formula: sanitizeFormula(JSON.parse(element.dataset.questionFormula || "")) }; }
        catch { return false; }
      },
    }];
  },
  renderHTML({ node }) {
    try {
      const formula = sanitizeFormula(node.attrs.formula);
      return ["span", {
        class: "question-formula", "data-question-formula": JSON.stringify(formula),
        contenteditable: "false", role: "math", "aria-label": mathToText(formula),
      }, formulaDomSpec(formula)];
    } catch {
      return ["span", { class: "question-formula", contenteditable: "false" }, "[Rumus tidak valid]"];
    }
  },
});

export function questionEditorExtensions() {
  return [
    StarterKit.configure({ blockquote: false, code: false, codeBlock: false, heading: false, horizontalRule: false, strike: false, link: false }),
    Table.configure({ resizable: false, renderWrapper: true }), TableRow, TableHeader, TableCell,
    TextAlign.configure({ types: ["paragraph"], alignments: ["left", "center", "right"] }),
    Direction, Subscript, Superscript, MathFormula,
  ];
}
