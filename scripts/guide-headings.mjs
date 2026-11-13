import MarkdownIt from "markdown-it";
import { escapeHtml } from "../editor/shared/model.mjs";

const { unescapeAll } = new MarkdownIt().utils;
const entities =
  /&(?:#[xX][0-9a-fA-F]{1,7}|#[0-9]{1,8}|[A-Za-z][A-Za-z0-9]{0,31});/g;
const tags =
  /<!--[\s\S]*?-->|<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+(?:[^"'<>]|"[^"]*"|'[^']*')*)?\s*\/?>/g;
const inert = new Set(["script", "style", "template", "textarea"]);
const labelLimit = 160;
const decode = (text) =>
  text.replace(entities, (entity) => unescapeAll(entity));

function attributes(tag) {
  const values = new Map();
  for (const match of tag.matchAll(
    /\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/g,
  )) {
    const name = match[1].toLowerCase();
    if (!values.has(name))
      values.set(name, decode(match[2] ?? match[3] ?? match[4] ?? ""));
  }
  return values;
}
function readableLabel(text) {
  const plain = decode(text)
    .replace(/[\u200b-\u200f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const points = Array.from(plain);
  return points.length > labelLimit
    ? points.slice(0, labelLimit - 1).join("") + "…"
    : plain;
}

/** Inspect already-rendered guide HTML. This never parses or mutates source ASTs. */
function renderedHeadings(body) {
  const headings = [],
    ids = new Set(),
    ignored = [];
  let heading = null,
    cursor = 0;
  const finish = () => {
    if (!heading) return;
    const label = readableLabel(heading.text),
      id = heading.id;
    if (
      label &&
      id &&
      id.length <= 2048 &&
      !/[\u0000-\u001f\u007f]/.test(id) &&
      id.isWellFormed() &&
      !ids.has(id)
    ) {
      headings.push({ level: heading.level, id, label });
      ids.add(id);
    }
    heading = null;
  };
  for (const match of body.matchAll(tags)) {
    if (heading && !ignored.length)
      heading.text += body.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const token = match[0];
    if (token.startsWith("<!--")) continue;
    const tag = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(token);
    const closing = tag[1] === "/",
      name = tag[2].toLowerCase();
    if (ignored.length) {
      if (closing && name === ignored.at(-1)) ignored.pop();
      else if (!closing && ignored.at(-1) === "template" && inert.has(name))
        ignored.push(name);
      continue;
    }
    if (!closing && inert.has(name)) {
      ignored.push(name);
      continue;
    }
    if (/^h[1-6]$/.test(name)) {
      if (closing) {
        if (heading?.level === Number(name[1])) finish();
      } else {
        finish();
        heading = {
          level: Number(name[1]),
          id: attributes(token).get("id"),
          text: "",
        };
      }
    } else if (heading && !closing && name === "img") {
      const alt = attributes(token).get("alt");
      // Keep a decoded attribute from being entity-decoded a second time.
      if (alt) heading.text += " " + escapeHtml(alt) + " ";
    } else if (heading && !closing && name === "br") heading.text += " ";
  }
  if (heading && !ignored.length) heading.text += body.slice(cursor);
  finish();
  return headings;
}

/**
 * Refresh only the existing reader contents navigation. The caller supplies the
 * rendered published body before discovery enhances the navigation disclosure.
 * Legacy anchor spans stay in the source body, but only real headings get links.
 */
export function refreshGuideContents(pageHtml, renderedBody) {
  if (typeof pageHtml !== "string" || typeof renderedBody !== "string")
    throw new TypeError("Reader page and rendered body must be strings.");
  const navs = /(<nav\b(?:[^"'<>]|"[^"]*"|'[^']*')*>)[\s\S]*?(<\/nav\s*>)/gi;
  let links;
  return pageHtml.replace(navs, (navigation, open, close) => {
    if (attributes(open).get("aria-label") !== "On this page")
      return navigation;
    links ??= renderedHeadings(renderedBody)
      .map(
        ({ level, id, label }) =>
          '<a class="toc-h' +
          level +
          '" href="#' +
          escapeHtml(encodeURIComponent(id)) +
          '">' +
          escapeHtml(label) +
          "</a>",
      )
      .join("");
    return open + links + close;
  });
}
