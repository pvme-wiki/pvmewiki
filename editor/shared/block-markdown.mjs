import MarkdownIt from "markdown-it";
import {
  shortcodeAsset,
  emojiCompletions,
  MARKDOWN_FORMAT,
} from "./markdown.mjs";
import { isSafeImageSource } from "./image-source.mjs";
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const literal = (value) =>
  String(value)
    .replace(/([\\`*_[\]{}<>#!|~])/g, "\\$1")
    .replace(/(^|\n)([ \t]*)([-+])(?=\s)/g, "$1$2\\$3")
    .replace(/(^|\n)([ \t]*\d+)\.(?=\s)/g, "$1$2\\.");
export const imageMarkdown = (src, alt = "") =>
  "![" +
  String(alt)
    .replace(/([\\[\]])/g, "\\$1")
    .replace(/\r?\n/g, " ") +
  "](<" +
  String(src).replace(/[<>\s]/g, (c) => encodeURIComponent(c)) +
  ">)";
export function safeLink(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    /[\u0000-\u0020\u007f\\]/.test(value)
  )
    return false;
  if (value.startsWith("#")) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const u = new URL(value);
    return (
      ["https:", "http:"].includes(u.protocol) &&
      !!u.hostname &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}
const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: true,
  maxNesting: 32,
});
md.validateLink = (value) => safeLink(value) || isSafeImageSource(value);
md.renderer.rules.link_open = (tokens, i, options, env, renderer) => {
  const token = tokens[i];
  if (!safeLink(token.attrGet("href"))) token.attrSet("href", "#");
  token.attrSet("rel", "noopener noreferrer");
  token.attrSet("target", "_blank");
  return renderer.renderToken(tokens, i, options);
};
md.renderer.rules.heading_open = (tokens, i, options, env, renderer) => {
  if (typeof env.headingPrefix === "string" && /^[a-z][a-z0-9:._-]{0,220}$/i.test(env.headingPrefix)) {
    const id = `${env.headingPrefix}-${++env.headingIndex}`;
    tokens[i].attrSet("id", id);
    env.headingIds?.add(id);
  }
  return renderer.renderToken(tokens, i, options);
};
md.renderer.rules.image = (tokens, i) => {
  const token = tokens[i],
    src = token.attrGet("src"),
    alt =
      token.children?.map((c) => c.content || "").join("") ||
      token.content ||
      "";
  return isSafeImageSource(src)
    ? '<img src="' +
        escape(src) +
        '" alt="' +
        escape(alt) +
        '" loading="lazy" referrerpolicy="no-referrer">'
    : escape(imageMarkdown(src || "", alt));
};
const discord = new Map(
  emojiCompletions.map((x) => [x.asset.id.match(/\[(\d+)\]/)?.[1], x.asset]),
);
md.inline.ruler.before("text", "pvme_icon", (state, silent) => {
  const s = state.src.slice(state.pos),
    short = s.match(/^:([a-zA-Z0-9_]+):/),
    long = s.match(/^<a?:([a-zA-Z0-9_]+):(\d+)>/),
    match = short || long;
  const asset = short
    ? shortcodeAsset(short[1])
    : long
      ? discord.get(long[2])
      : null;
  if (!match || !asset) return false;
  if (!silent) {
    const t = state.push("pvme_icon", "img", 0);
    t.meta = asset;
  }
  state.pos += match[0].length;
  return true;
});
md.inline.ruler.at("text", (state, silent) => {
  let end = state.pos;
  while (
    end < state.posMax &&
    !/[\n!#$%&*+\-:<=>@[\\\]^_`{}~]/.test(state.src[end])
  )
    end++;
  if (end === state.pos) return false;
  if (!silent) state.pending += state.src.slice(state.pos, end);
  state.pos = end;
  return true;
});
md.renderer.rules.pvme_icon = (tokens, i) => {
  const a = tokens[i].meta;
  return (
    '<img class="d-emoji" src="' +
    escape(a.src) +
    '" alt="' +
    escape(a.alt) +
    '" title="' +
    escape(a.title) +
    '" loading="lazy" referrerpolicy="no-referrer">'
  );
};
md.renderer.rules.strong_open = (ts, i) =>
  ts[i].markup === "__" ? "<u>" : "<strong>";
md.renderer.rules.strong_close = (ts, i) =>
  ts[i].markup === "__" ? "</u>" : "</strong>";
/** Only references supplied by the validated original block can retain a media embed. */
export function sourceMediaReference(node) {
  if (!["iframe", "video", "audio"].includes(node?.tag)) return null;
  const url =
    node.attrs?.src ||
    node.children?.find((child) => child.tag === "source")?.attrs?.src;
  return typeof url === "string" && safeLink(url)
    ? { label: node.tag === "iframe" ? "Video" : node.tag, url }
    : null;
}
md.core.ruler.after("inline", "pvme_source_media", (state) => {
  const media = state.env?.sourceMedia;
  if (!Array.isArray(media) || !media.length) return;
  const byReference = new Map();
  for (const entry of media) {
    if (
      !entry ||
      typeof entry.label !== "string" ||
      !safeLink(entry.url) ||
      typeof entry.render !== "function"
    )
      continue;
    const key = entry.label + "\0" + md.normalizeLink(entry.url);
    if (!byReference.has(key)) byReference.set(key, []);
    byReference.get(key).push(entry.render);
  }
  for (const token of state.tokens) {
    if (token.type !== "inline" || !token.children) continue;
    const children = token.children,
      next = [];
    for (let i = 0; i < children.length; i++) {
      const open = children[i],
        label = children[i + 1],
        close = children[i + 2];
      if (
        open.type === "link_open" &&
        label?.type === "text" &&
        close?.type === "link_close"
      ) {
        const candidates = byReference.get(
          label.content + "\0" + open.attrGet("href"),
        );
        if (candidates?.length) {
          const replacement = new state.Token("pvme_source_media", "", 0);
          replacement.meta = { render: candidates.shift() };
          next.push(replacement);
          i += 2;
          continue;
        }
      }
      next.push(open);
    }
    token.children = next;
  }
});
md.renderer.rules.pvme_source_media = (tokens, i) => tokens[i].meta.render();
export function renderBlockMarkdown(source, { sourceMedia, headingPrefix, headingIds } = {}) {
  return md.render(source, { sourceMedia, headingPrefix, headingIds, headingIndex: 0 });
}
export function blockMarkdownText(source) {
  const text = [];
  for (const token of md.parse(source, {})) {
    if (token.type === "inline") {
      for (const child of token.children || []) {
        if (["text", "code_inline", "image"].includes(child.type))
          text.push(child.content);
        else if (child.type === "pvme_icon") text.push(child.meta.alt);
        else if (["softbreak", "hardbreak"].includes(child.type))
          text.push("\n");
      }
    } else if (["code_block", "fence"].includes(token.type))
      text.push(token.content);
  }
  return text
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .trim();
}
export function markdownReviewText(source) {
  return String(source)
    .replace(
      /!\[((?:\\.|[^\]\\])*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g,
      (_m, alt, a, b) =>
        "[Image: " +
        alt +
        " — " +
        ((a || b).startsWith("data:") ? "uploaded raster" : a || b) +
        "]",
    )
    .replace(
      /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g,
      "[uploaded image]",
    );
}
function originalText(node) {
  return node.type === "text"
    ? node.text
    : (node.children || []).map(originalText).join("");
}
function serialize(node) {
  if (node.type === "text")
    return node.format === MARKDOWN_FORMAT ? node.text : literal(node.text);
  const children = () => node.children.map(serialize).join(""),
    tag = node.tag;
  if (tag === "img") {
    if ((node.attrs.class || "").split(/\s+/).includes("d-emoji")) {
      const a = emojiCompletions.find(
        (x) => x.asset.src === node.attrs.src && x.asset.alt === node.attrs.alt,
      )?.asset;
      if (a) {
        const alias = emojiCompletions.find((x) => x.asset.id === a.id)?.name;
        return alias
          ? ":" + alias + ":"
          : "<:" +
              a.alt.replace(/[^a-zA-Z0-9_]/g, "_") +
              ":" +
              a.id.match(/\[(\d+)\]/)?.[1] +
              ">";
      }
    }
    return imageMarkdown(node.attrs.src, node.attrs.alt);
  }
  if (tag === "a")
    return (
      "[" +
      children() +
      "](<" +
      node.attrs.href.replace(/[<>\s]/g, (c) => encodeURIComponent(c)) +
      ">)"
    );
  if (/^h[1-6]$/.test(tag))
    return "#".repeat(Number(tag[1])) + " " + children().trim() + "\n\n";
  if (["strong", "b", "em", "i", "u", "s", "del"].includes(tag)) {
    const m = ["strong", "b"].includes(tag)
      ? "**"
      : ["em", "i"].includes(tag)
        ? "*"
        : tag === "u"
          ? "__"
          : "~~";
    return m + children() + m;
  }
  if (tag === "br") return "\n";
  if (tag === "hr") return "\n---\n";
  if (tag === "code") {
    const value = originalText(node),
      longest = Math.max(
        0,
        ...[...value.matchAll(/`+/g)].map((m) => m[0].length),
      ),
      delimiter = "`".repeat(longest + 1),
      pad = /^`|`$|^ | $/.test(value) ? " " : "";
    return delimiter + pad + value + pad + delimiter;
  }
  if (tag === "pre") {
    const value = originalText(node),
      fence = "`".repeat(
        Math.max(3, ...[...value.matchAll(/`+/g)].map((m) => m[0].length + 1)),
      );
    return "\n" + fence + "\n" + value + "\n" + fence + "\n";
  }
  if (["iframe", "video", "audio"].includes(tag)) {
    const reference = sourceMediaReference(node);
    return reference
      ? "[" +
          reference.label +
          "](<" +
          reference.url.replace(/[<>\s]/g, (c) => encodeURIComponent(c)) +
          ">)"
      : "";
  }
  if (tag === "ul" || tag === "ol")
    return (
      "\n" +
      node.children
        .filter((n) => n.tag === "li")
        .map(
          (n, i) =>
            (tag === "ul"
              ? "- "
              : String(Number(node.attrs.start || 1) + i) + ". ") +
            serialize(n).trim().replace(/\n/g, "\n  "),
        )
        .join("\n") +
      "\n\n"
    );
  if (tag === "table") {
    const rows = [];
    const visit = (n) => {
      if (n.tag === "tr")
        rows.push(
          n.children
            .filter((c) => ["td", "th"].includes(c.tag))
            .map((c) => serialize(c).trim().replace(/\n/g, " ")),
        );
      else n.children?.forEach(visit);
    };
    visit(node);
    if (!rows.length) return children();
    const caption = node.children
      .filter((n) => n.tag === "caption")
      .map(serialize)
      .join("");
    const width = Math.max(...rows.map((r) => r.length)),
      line = (r) =>
        "| " +
        Array.from({ length: width }, (_, i) => r[i] || "").join(" | ") +
        " |";
    return (
      (caption ? caption + "\n\n" : "") +
      "\n" +
      line(rows[0]) +
      "\n" +
      line(Array(width).fill("---")) +
      "\n" +
      rows.slice(1).map(line).join("\n") +
      "\n\n"
    );
  }
  if (
    [
      "p",
      "div",
      "section",
      "article",
      "details",
      "blockquote",
      "figure",
      "dl",
    ].includes(tag)
  )
    return (
      (tag === "blockquote"
        ? children()
            .split("\n")
            .map((l) => "> " + l)
            .join("\n")
        : children()) + "\n\n"
    );
  if (tag === "dt") return "**" + children() + "**\n\n";
  if (tag === "dd") return children() + "\n\n";
  if (tag === "summary") return "**" + children() + "**\n\n";
  return children();
}
/** A deterministic writing representation; the original AST is retained until an edit is made. */
export function sourceBlockMarkdown(block) {
  return serialize(block.node).replace(/\n+$/, "");
}

/** The same constrained parser drives review and conservative draft exports. */
export function blockMarkdownTokens(source) {
  return md.parse(source, {});
}
