import { createElement, type ReactNode } from "react";
import { mathToText, sanitizeFormula } from "@/lib/question-math.mjs";
import { sanitizeRichDocument } from "@/lib/question-rich.mjs";

type Formula = ReturnType<typeof sanitizeFormula>;
type RichNode = ReturnType<typeof sanitizeRichDocument>;

function renderMath(node: Formula, key: string): ReactNode {
  const children = (node.c || []).map((child, index) => typeof child === "string" ? child : renderMath(child, `${key}-${index}`));
  return createElement(node.t, { ...node.a, key }, ...children);
}

function renderRich(node: RichNode, key: string): ReactNode {
  if (node.type === "text") {
    let result: ReactNode = node.text;
    for (const mark of node.marks || []) {
      const tag = { bold: "strong", italic: "em", underline: "u", subscript: "sub", superscript: "sup" }[mark.type];
      if (tag) result = createElement(tag, null, result);
    }
    return <span key={key}>{result}</span>;
  }
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type === "mathFormula") {
    const formula = sanitizeFormula(node.attrs?.formula);
    return <span key={key} className="question-formula" role="math" aria-label={mathToText(formula)}>{renderMath(formula, `${key}-math`)}</span>;
  }
  const children = (node.content || []).map((child, index) => renderRich(child, `${key}-${index}`));
  if (node.type === "doc") return <div key={key}>{children}</div>;
  if (node.type === "paragraph") return <p key={key} dir={node.attrs?.dir} style={{ textAlign: node.attrs?.textAlign || undefined }}>{children.length ? children : <br />}</p>;
  if (node.type === "bulletList") return <ul key={key}>{children}</ul>;
  if (node.type === "orderedList") return <ol key={key} start={node.attrs?.start}>{children}</ol>;
  if (node.type === "listItem") return <li key={key}>{children}</li>;
  if (node.type === "table") return <div key={key} className="tableWrapper"><table><tbody>{children}</tbody></table></div>;
  if (node.type === "tableRow") return <tr key={key}>{children}</tr>;
  if (node.type === "tableCell") return <td key={key} colSpan={node.attrs?.colspan || 1} rowSpan={node.attrs?.rowspan || 1} style={{ textAlign: node.attrs?.align || undefined }}>{children}</td>;
  if (node.type === "tableHeader") return <th key={key} colSpan={node.attrs?.colspan || 1} rowSpan={node.attrs?.rowspan || 1} style={{ textAlign: node.attrs?.align || undefined }}>{children}</th>;
  return null;
}

export function QuestionRichDisplay({ document, fallback }: { document: unknown; fallback: string }) {
  if (document == null) return fallback ? <div dir="auto" className="whitespace-pre-wrap break-words">{fallback}</div> : null;
  let clean: RichNode | null = null;
  try { clean = sanitizeRichDocument(document); } catch { /* fail closed */ }
  if (!clean) return <p role="alert" className="text-destructive">Isi berformat tidak dapat ditampilkan dengan aman. Periksa data soal.</p>;
  return <div className="question-rich-content">{renderRich(clean, "root")}</div>;
}
