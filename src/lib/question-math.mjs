import { parseQuestionXml, xmlAttr, xmlChild, xmlChildren, xmlText } from "./question-xml.mjs";

export const MATHML_NS = "http://www.w3.org/1998/Math/MathML";
export const OMML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XMLNS = "http://www.w3.org/2000/xmlns/";
const TOKEN_TAGS = new Set(["mi", "mn", "mo", "mtext", "ms"]);
const CONTAINER_TAGS = new Set(["math", "mrow", "mfrac", "msqrt", "mroot", "msub", "msup", "msubsup", "munder", "mover", "munderover", "mtable", "mtr", "mtd", "mstyle", "mspace"]);
const ATTRS = {
  math: { display: /^(inline|block)$/ },
  mi: { mathvariant: /^(normal|bold|italic|bold-italic|double-struck|sans-serif|monospace|script|fraktur)$/ },
  mn: { mathvariant: /^(normal|bold|italic|bold-italic|double-struck|sans-serif|monospace|script|fraktur)$/ },
  mo: { stretchy: /^(true|false)$/, fence: /^(true|false)$/, separator: /^(true|false)$/, form: /^(prefix|infix|postfix)$/, accent: /^(true|false)$/ },
  mtext: { mathvariant: /^(normal|bold|italic|bold-italic|sans-serif|monospace)$/ },
  mfrac: { linethickness: /^(0|0px|thin|medium|thick)$/, bevelled: /^(true|false)$/ },
  mstyle: { mathvariant: /^(normal|bold|italic|bold-italic|double-struck|sans-serif|monospace|script|fraktur)$/, displaystyle: /^(true|false)$/, scriptlevel: /^[-+]?\d{1,2}$/ },
  mspace: { width: /^(?:0|[0-9]+(?:\.[0-9]+)?(?:em|ex|px))$/ },
  mover: { accent: /^(true|false)$/ },
  munder: { accentunder: /^(true|false)$/ },
};

/** @typedef {{t:string, a?:Record<string,string>, c?:(Formula|string)[]}} Formula */

function mathError() { throw new Error("Rumus tidak valid atau mengandung bentuk yang belum didukung."); }
function onlyKeys(value, keys) { return Object.keys(value).every((key) => keys.includes(key)); }

/** Validate and rebuild a small, non-executable MathML tree; never accept HTML, URLs or styles. @param {unknown} input @returns {Formula} */
export function sanitizeFormula(input) {
  let count = 0;
  let textCount = 0;
  /** @param {unknown} raw @param {number} depth @returns {Formula} */
  function walk(raw, depth) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || depth > 32 || ++count > 800) mathError();
    const obj = /** @type {Record<string, any>} */ (raw);
    if (!onlyKeys(obj, ["t", "a", "c"]) || typeof obj.t !== "string" || (!TOKEN_TAGS.has(obj.t) && !CONTAINER_TAGS.has(obj.t))) mathError();
    /** @type {Formula} */
    const out = { t: obj.t };
    if (obj.a !== undefined) {
      if (!obj.a || typeof obj.a !== "object" || Array.isArray(obj.a)) mathError();
      const allow = ATTRS[obj.t] || {};
      /** @type {Record<string,string>} */
      const clean = {};
      for (const [key, val] of Object.entries(obj.a)) {
        if (typeof val !== "string" || !allow[key] || !allow[key].test(val)) mathError();
        clean[key] = val;
      }
      if (Object.keys(clean).length) out.a = clean;
    }
    if (obj.c !== undefined && !Array.isArray(obj.c)) mathError();
    const inputChildren = obj.c || [];
    if (inputChildren.length > 100) mathError();
    /** @type {(Formula|string)[]} */
    const children = [];
    for (const child of inputChildren) {
      if (typeof child === "string") {
        if (!TOKEN_TAGS.has(obj.t) || !child.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(child)) mathError();
        textCount += Array.from(child).length;
        if (textCount > 4000) mathError();
        if (child) children.push(child);
      } else {
        if (TOKEN_TAGS.has(obj.t)) mathError();
        children.push(walk(child, depth + 1));
      }
    }
    if (TOKEN_TAGS.has(obj.t) && !children.some((x) => typeof x === "string" && x.length)) mathError();
    const num = children.length;
    if (["mfrac", "mroot", "msub", "msup", "munder", "mover"].includes(obj.t) && num !== 2) mathError();
    if (["msubsup", "munderover"].includes(obj.t) && num !== 3) mathError();
    if (["math", "msqrt", "mtable", "mtr", "mtd", "mstyle"].includes(obj.t) && num < 1) mathError();
    if (obj.t === "mspace" && num !== 0) mathError();
    if (obj.t === "mtable" && children.some((x) => typeof x === "string" || x.t !== "mtr")) mathError();
    if (obj.t === "mtr" && children.some((x) => typeof x === "string" || x.t !== "mtd")) mathError();
    if (children.length) out.c = children;
    return out;
  }
  const result = walk(input, 0);
  if (result.t !== "math" || !mathToText(result).trim()) mathError();
  return result;
}

/** @param {Formula} tree @returns {string} */
export function mathToText(tree) {
  const parts = (tree.c || []).map((child) => typeof child === "string" ? child : mathToText(child));
  if (tree.t === "mfrac") return `(${parts[0]})/(${parts[1]})`;
  if (tree.t === "msqrt") return `√(${parts.join("")})`;
  if (tree.t === "mroot") return `root[${parts[1]}](${parts[0]})`;
  if (tree.t === "msup") return `${parts[0]}^(${parts[1]})`;
  if (tree.t === "msub") return `${parts[0]}_(${parts[1]})`;
  if (tree.t === "msubsup") return `${parts[0]}_(${parts[1]})^(${parts[2]})`;
  if (tree.t === "mspace") return " ";
  return parts.join("");
}

/** MathML copied as text from Word, not arbitrary HTML. @param {string} input @returns {Formula} */
export function parseMathML(input) {
  if (typeof input !== "string" || input.length > 30000) mathError();
  const root = parseQuestionXml(input.trim(), { maxChars: 30000, maxNodes: 800, maxDepth: 32 });
  /** @param {import('./question-xml.mjs').XmlElement} el @returns {Formula} */
  function convert(el) {
    if (el.uri !== MATHML_NS && el.uri !== "") mathError();
    // Word can emit the MathML 3 legacy mfenced element, which MathML Core
    // browsers no longer render directly. Expand it to explicit fence tokens.
    if (el.local === "mfenced") {
      const attrs = {};
      for (const attr of Object.values(el.attributes)) {
        if (attr.uri === XMLNS || attr.local === "xmlns") continue;
        if (attr.uri || !["open", "close", "separators"].includes(attr.local)) mathError();
        attrs[attr.local] = attr.value;
      }
      const open = attrs.open ?? "(";
      const close = attrs.close ?? ")";
      const separators = Array.from((attrs.separators ?? ",").replace(/\s/gu, ""));
      if (Array.from(open).length > 2 || Array.from(close).length > 2 || separators.length > 20) mathError();
      /** @type {Formula[]} */
      const parts = [];
      if (open) parts.push({ t: "mo", a: { fence: "true" }, c: [open] });
      let count = 0;
      for (const child of el.children) {
        if (typeof child === "string") { if (child.trim()) mathError(); continue; }
        if (count > 0 && separators.length) parts.push({ t: "mo", a: { separator: "true" }, c: [separators[Math.min(count - 1, separators.length - 1)]] });
        parts.push(convert(child));
        count++;
      }
      if (close) parts.push({ t: "mo", a: { fence: "true" }, c: [close] });
      return { t: "mrow", c: parts };
    }
    // A semantics wrapper may carry a textual source annotation; only its
    // single presentation child is visible. Reject non-metadata extra children.
    if (el.local === "semantics") {
      if (Object.values(el.attributes).some((attr) => attr.uri !== XMLNS && attr.local !== "xmlns")) mathError();
      const elements = [];
      for (const item of el.children) {
        if (typeof item === "string") { if (item.trim()) mathError(); }
        else elements.push(item);
      }
      if (!elements.length || elements[0].local === "annotation" || elements[0].local === "annotation-xml") mathError();
      for (const annotation of elements.slice(1)) {
        if (annotation.local !== "annotation" || (annotation.uri !== MATHML_NS && annotation.uri !== "") || annotation.children.some((item) => typeof item !== "string")) mathError();
        if (Object.values(annotation.attributes).some((attr) => attr.uri !== XMLNS && attr.local !== "xmlns" && (attr.uri || attr.local !== "encoding"))) mathError();
      }
      return convert(elements[0]);
    }
    /** @type {Formula} */
    const result = { t: el.local };
    /** @type {Record<string,string>} */
    const a = {};
    for (const attr of Object.values(el.attributes)) {
      if (attr.uri === XMLNS || attr.local === "xmlns") continue;
      if (attr.uri && attr.uri !== MATHML_NS) mathError();
      a[attr.local] = attr.value;
    }
    if (Object.keys(a).length) result.a = a;
    const children = [];
    for (const child of el.children) {
      if (typeof child === "string") {
        if (TOKEN_TAGS.has(el.local)) children.push(child);
        else if (child.trim()) mathError();
      } else children.push(convert(child));
    }
    if (children.length) result.c = children;
    return result;
  }
  return sanitizeFormula(convert(root));
}

/** DOMOutputSpec for a validated MathML tree. Namespaces are explicit. @param {Formula} tree @returns {any} */
export function formulaDomSpec(tree) {
  const safe = sanitizeFormula(tree);
  function toSpec(node) {
    return [`${MATHML_NS} ${node.t}`, node.a || {}, ...(node.c || []).map((child) => typeof child === "string" ? child : toSpec(child))];
  }
  return toSpec(safe);
}

/** Turn supported Word OMML structures into MathML; fail closed for unknown mathematical structures. @param {import('./question-xml.mjs').XmlElement} root @returns {Formula} */
export function convertOmml(root) {
  const isMath = (node, local) => node.uri === OMML_NS && node.local === local;
  const child = (node, local) => xmlChild(node, local, OMML_NS);
  const value = (node) => node ? xmlAttr(node, "val", OMML_NS) : undefined;
  // A structural element must not hide additional mathematics that we do not convert.
  function checkShape(node, allowed, required = [], repeat = []) {
    const seen = new Map();
    for (const item of node.children) {
      if (typeof item === "string") { if (item.trim()) mathError(); continue; }
      if (item.uri !== OMML_NS || !allowed.includes(item.local)) mathError();
      const count = (seen.get(item.local) || 0) + 1;
      if (count > 1 && !repeat.includes(item.local)) mathError();
      seen.set(item.local, count);
    }
    if (required.some((name) => !seen.has(name))) mathError();
  }
  function noHiddenMath(node) {
    for (const item of node.children) {
      if (typeof item === "string") { if (item.trim()) mathError(); continue; }
      if (item.uri === OMML_NS) mathError();
      noHiddenMath(item);
    }
  }
  function checkProperties(node, allowed) {
    if (!node) return;
    checkShape(node, allowed);
    for (const item of node.children) {
      if (typeof item === "string") continue;
      if (item.local === "ctrlPr") {
        let count = 0;
        for (const prop of item.children) {
          if (typeof prop === "string") { if (prop.trim()) mathError(); continue; }
          if (prop.uri !== WORD_NS || prop.local !== "rPr" || ++count > 1) mathError();
          noHiddenMath(prop);
        }
      } else if (item.children.some((part) => typeof part !== "string" || part.trim())) mathError();
    }
  }
  /** @param {string} t @param {(Formula|string)[]} c @param {Record<string,string> | undefined} a @returns {Formula} */
  const elem = (t, c, a) => ({ t, ...(a && Object.keys(a).length ? { a } : {}), ...(c.length ? { c } : {}) });
  /** @param {import('./question-xml.mjs').XmlElement} node */
  function contents(node) {
    /** @type {Formula[]} */
    const out = [];
    for (const part of node.children) {
      if (typeof part === "string") { if (part.trim()) mathError(); continue; }
      out.push(...convertPart(part));
    }
    return out;
  }
  /** @param {import('./question-xml.mjs').XmlElement | undefined} node */
  function row(node) { if (!node) mathError(); return elem("mrow", contents(node), undefined); }
  /** @param {string} text */
  function textParts(text) {
    /** @type {Formula[]} */
    const result = [];
    // Keep Arabic letters and combining marks together so browser shaping and
    // vocalization survive; recognise Arabic-Indic digits as numbers too.
    const groups = text.match(/\p{Nd}+(?:[.,٫]\p{Nd}+)?|\s+|(?:(?=\p{L})\p{Script=Arabic}|\p{M})+|\p{L}\p{M}*|\p{M}+|[^\s]/gu) || [];
    for (const s of groups) {
      const tag = /^\p{Nd}/u.test(s) ? "mn" : /^\s+$/u.test(s) ? "mtext" : /^[\p{L}\p{M}]+$/u.test(s) ? "mi" : "mo";
      result.push(elem(tag, [s], undefined));
    }
    return result;
  }
  /** @param {import('./question-xml.mjs').XmlElement} node @returns {Formula[]} */
  function convertPart(node) {
    if (node.uri === WORD_NS && ["rPr", "proofErr", "bookmarkStart", "bookmarkEnd"].includes(node.local)) return [];
    if (node.uri !== OMML_NS) mathError();
    if (["oMath", "e", "num", "den", "sup", "sub", "deg", "fName"].includes(node.local)) return contents(node);
    if (isMath(node, "r")) {
      const runPr = child(node, "rPr");
      checkProperties(runPr, ["sty", "nor", "scr"]);
      const style = value(runPr && child(runPr, "sty"));
      const script = value(runPr && child(runPr, "scr"));
      if ((style && !["p", "b", "i", "bi"].includes(style)) || (script && script !== "roman")) mathError();
      const normalNode = runPr && child(runPr, "nor");
      const normalValue = normalNode && (value(normalNode) ?? "1");
      if (normalValue && !["0", "1", "true", "false", "on", "off"].includes(normalValue)) mathError();
      const variant = ["1", "true", "on"].includes(normalValue || "") ? "normal" : style === "p" ? "normal" : style === "b" ? "bold" : style === "i" ? "italic" : style === "bi" ? "bold-italic" : undefined;
      /** @type {Formula[]} */
      const out = [];
      let mathProperties = 0;
      let wordProperties = 0;
      for (const item of node.children) {
        if (typeof item === "string") { if (item.trim()) mathError(); continue; }
        if (isMath(item, "t")) {
          if (item.children.some((part) => typeof part !== "string")) mathError();
          out.push(...textParts(xmlText(item)));
        } else if (isMath(item, "rPr")) {
          if (++mathProperties > 1) mathError();
        } else if (item.uri === WORD_NS && item.local === "rPr") {
          if (++wordProperties > 1) mathError();
          noHiddenMath(item);
        } else mathError();
      }
      return variant && out.length ? [elem("mstyle", out, { mathvariant: variant })] : out;
    }
    if (isMath(node, "f")) {
      checkShape(node, ["fPr", "num", "den"], ["num", "den"]);
      const pr = child(node, "fPr");
      checkProperties(pr, ["type", "ctrlPr"]);
      const kind = value(pr && child(pr, "type"));
      if (kind && kind !== "bar" && kind !== "noBar") mathError();
      return [elem("mfrac", [row(child(node, "num")), row(child(node, "den"))], kind === "noBar" ? { linethickness: "0" } : undefined)];
    }
    if (isMath(node, "rad")) {
      checkShape(node, ["radPr", "deg", "e"], ["e"]);
      const pr = child(node, "radPr");
      checkProperties(pr, ["degHide", "ctrlPr"]);
      const hiddenNode = pr && child(pr, "degHide");
      const hidden = hiddenNode && (value(hiddenNode) ?? "1");
      if (hidden && !["0", "1", "true", "false", "on", "off"].includes(hidden)) mathError();
      const degree = child(node, "deg");
      const expr = row(child(node, "e"));
      if (["1", "true", "on"].includes(hidden || "") || !degree) return [elem("msqrt", [expr], undefined)];
      if (!xmlText(degree).trim()) mathError();
      return [elem("mroot", [expr, row(degree)], undefined)];
    }
    if (["sSup", "sSub", "sSubSup"].includes(node.local)) {
      const required = ["e", ...(node.local !== "sSup" ? ["sub"] : []), ...(node.local !== "sSub" ? ["sup"] : [])];
      const prName = `${node.local}Pr`;
      checkShape(node, [prName, ...required], required);
      checkProperties(child(node, prName), ["ctrlPr"]);
      const children = [row(child(node, "e"))];
      if (node.local !== "sSup") children.push(row(child(node, "sub")));
      if (node.local !== "sSub") children.push(row(child(node, "sup")));
      return [elem(node.local === "sSup" ? "msup" : node.local === "sSub" ? "msub" : "msubsup", children, undefined)];
    }
    if (isMath(node, "func")) {
      checkShape(node, ["funcPr", "fName", "e"], ["fName", "e"]);
      checkProperties(child(node, "funcPr"), ["ctrlPr"]);
      return [row(child(node, "fName")), row(child(node, "e"))];
    }
    if (isMath(node, "d")) {
      checkShape(node, ["dPr", "e"], ["e"], ["e"]);
      const pr = child(node, "dPr");
      checkProperties(pr, ["begChr", "endChr", "sepChr", "ctrlPr"]);
      const begin = value(pr && child(pr, "begChr")) ?? "(";
      const end = value(pr && child(pr, "endChr")) ?? ")";
      const separator = value(pr && child(pr, "sepChr")) ?? "|";
      if ([begin, end, separator].some((x) => Array.from(x).length > 2)) mathError();
      const args = xmlChildren(node, "e", OMML_NS);
      if (!args.length) mathError();
      const c = [];
      if (begin) c.push(elem("mo", [begin], { fence: "true" }));
      args.forEach((arg, i) => { if (i && separator) c.push(elem("mo", [separator], { separator: "true" })); c.push(row(arg)); });
      if (end) c.push(elem("mo", [end], { fence: "true" }));
      return [elem("mrow", c, undefined)];
    }
    mathError();
  }
  if (!isMath(root, "oMath") && !isMath(root, "oMathPara")) mathError();
  if (isMath(root, "oMathPara")) {
    checkShape(root, ["oMathParaPr", "oMath"], ["oMath"], ["oMath"]);
    checkProperties(child(root, "oMathParaPr"), ["jc"]);
  }
  const body = isMath(root, "oMathPara") ? xmlChildren(root, "oMath", OMML_NS).flatMap(contents) : contents(root);
  return sanitizeFormula(elem("math", body, isMath(root, "oMathPara") ? { display: "block" } : undefined));
}
