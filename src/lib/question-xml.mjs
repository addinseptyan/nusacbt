import { SaxesParser } from "saxes";

/** @typedef {{uri:string, local:string, attributes:Record<string, {uri:string, local:string, value:string}>, children:(XmlElement|string)[]}} XmlElement */

/** Parse XML without DTD/entities; keep namespaces, order and mixed text. */
export function parseQuestionXml(input, limits = {}) {
  const { maxChars = 6_000_000, maxNodes = 120_000, maxDepth = 96 } = limits;
  if (typeof input !== "string" || input.length === 0 || input.length > maxChars || !input.isWellFormed()) throw new Error("XML tidak valid atau terlalu besar.");
  const parser = new SaxesParser({ xmlns: true });
  /** @type {XmlElement[]} */
  const stack = [];
  /** @type {XmlElement | undefined} */
  let root;
  let nodes = 0;
  parser.on("doctype", () => { throw new Error("DTD tidak didukung."); });
  parser.on("opentag", (tag) => {
    nodes += 1;
    if (nodes > maxNodes || stack.length >= maxDepth) throw new Error("Struktur XML terlalu kompleks.");
    /** @type {Record<string, {uri:string, local:string, value:string}>} */
    const attributes = Object.create(null);
    for (const [name, attr] of Object.entries(tag.attributes)) attributes[name] = { uri: attr.uri, local: attr.local, value: attr.value };
    const element = { uri: tag.uri, local: tag.local, attributes, children: [] };
    if (stack.length) stack[stack.length - 1].children.push(element);
    else if (root) throw new Error("XML memiliki lebih dari satu root.");
    else root = element;
    stack.push(element);
  });
  const appendText = (value) => {
    if (!stack.length) {
      if (value.trim()) throw new Error("XML memiliki teks di luar root.");
      return;
    }
    const children = stack[stack.length - 1].children;
    const last = children[children.length - 1];
    if (typeof last === "string") children[children.length - 1] = last + value;
    else children.push(value);
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", () => { stack.pop(); });
  try { parser.write(input).close(); }
  catch (error) { throw new Error("Struktur XML tidak valid atau tidak didukung.", { cause: error }); }
  if (!root || stack.length) throw new Error("Struktur XML tidak lengkap.");
  return root;
}

/** @param {XmlElement} element */
export function xmlChildren(element, local, uri) {
  return element.children.filter((item) => typeof item !== "string" && item.local === local && (!uri || item.uri === uri));
}

/** @param {XmlElement} element */
export function xmlChild(element, local, uri) { return xmlChildren(element, local, uri)[0]; }

/** @param {XmlElement} element */
export function xmlAttr(element, local, uri) {
  return Object.values(element.attributes).find((attr) => attr.local === local && (uri === undefined || attr.uri === uri))?.value;
}

/** @param {XmlElement} element */
export function xmlText(element) {
  return element.children.map((item) => typeof item === "string" ? item : xmlText(item)).join("");
}
