import {
  MARKDOWN_FORMAT,
  inlineMarkdownTokens,
} from "../editor/shared/markdown.mjs";
import {
  blockMarkdownTokens,
  safeLink,
} from "../editor/shared/block-markdown.mjs";
import { isSafeImageSource } from "../editor/shared/image-source.mjs";
import { assertDocument, escapeHtml } from "../editor/shared/model.mjs";
const literal = (value) => `<nowiki>${escapeHtml(value)}</nowiki>`;
const wikiUrl = (value) =>
  String(value).replace(/[\[\]{}|<>"']/g, (character) =>
    encodeURIComponent(character),
  );
// Conservative draft conversion: preserve literal text and source attribution.
// MediaWiki templates and asset import rights still require target-side review.
function nodeWiki(node) {
  if (node.type === "text") {
    if (node.format !== MARKDOWN_FORMAT)
      return `<nowiki>${escapeHtml(node.text)}</nowiki>`;
    return inlineMarkdownTokens(node.text)
      .map((token) => {
        if (token.type === "text")
          return `<nowiki>${escapeHtml(token.content)}</nowiki>`;
        if (token.type === "code_inline")
          return `<code><nowiki>${escapeHtml(token.content)}</nowiki></code>`;
        if (token.type === "pvme_emoji")
          return `[${token.meta.src} ${escapeHtml(token.meta.alt)}]`;
        if (["softbreak", "hardbreak"].includes(token.type)) return "<br>\n";
        const tag = token.markup === "__" ? "u" : token.tag;
        if (["strong", "em", "u", "s"].includes(tag))
          return token.nesting === 1 ? `<${tag}>` : `</${tag}>`;
        return `<nowiki>${escapeHtml(token.content)}</nowiki>`;
      })
      .join("");
  }
  const body = node.children.map(nodeWiki).join("");
  const tag = node.tag;
  if (/^h[1-6]$/.test(tag)) {
    const marks = "=".repeat(Math.max(2, Number(tag[1])));
    return `\n\n${marks} ${body} ${marks}\n`;
  }
  if (tag === "a") return `[${node.attrs.href || ""} ${body}]`;
  if (tag === "img")
    return `[${node.attrs.src} ${escapeHtml(node.attrs.alt || "Source image")}]`;
  if (tag === "iframe") return `[${node.attrs.src} Embedded video]`;
  if (tag === "br") return "<br>\n";
  if (tag === "hr") return "\n----\n";
  if (["strong", "b"].includes(tag)) return `'''${body}'''`;
  if (["em", "i"].includes(tag)) return `''${body}''`;
  if (["p", "div", "section", "article", "details"].includes(tag))
    return `\n\n${body}\n`;
  if (tag === "summary") return `\n'''${body}'''\n`;
  if (
    [
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "pre",
      "code",
      "sup",
      "sub",
      "blockquote",
    ].includes(tag)
  )
    return `<${tag}>${body}</${tag}>`;
  return body;
}
function markdownWiki(source) {
  const links = [];
  const tokensWiki = (tokens) =>
    tokens
      .map((token) => {
        if (token.type === "inline") return tokensWiki(token.children || []);
        if (token.type === "text") return literal(token.content);
        if (token.type === "pvme_icon")
          return `[${wikiUrl(token.meta.src)} ${literal(token.meta.alt)}]`;
        if (token.type === "code_inline")
          return `<code>${literal(token.content)}</code>`;
        if (token.type === "code_block" || token.type === "fence")
          return `\n<pre>${literal(token.content)}</pre>\n`;
        if (token.type === "softbreak" || token.type === "hardbreak")
          return "<br>\n";
        if (token.type === "image") {
          const src = token.attrGet("src"),
            alt = token.content || "Image";
          if (!isSafeImageSource(src)) return literal(`[Image: ${alt}]`);
          if (src.startsWith("data:"))
            return literal(
              `[Uploaded image: ${alt}. Upload the image to the target wiki before importing.]`,
            );
          return `[${wikiUrl(src)} ${literal(alt)}]`;
        }
        if (token.type === "link_open") {
          const href = token.attrGet("href"),
            safe = safeLink(href);
          links.push(safe);
          return safe ? `[${wikiUrl(href)} ` : "";
        }
        if (token.type === "link_close") return links.pop() ? "]" : "";
        if (token.type === "heading_open")
          return (
            "\n\n" + "=".repeat(Math.max(2, Number(token.tag.slice(1)))) + " "
          );
        if (token.type === "heading_close")
          return (
            " " + "=".repeat(Math.max(2, Number(token.tag.slice(1)))) + "\n"
          );
        if (token.type === "paragraph_open") return "\n\n";
        if (token.type === "paragraph_close") return "\n";
        if (token.type === "hr") return "\n----\n";
        const tag =
          token.markup === "__" &&
          ["strong_open", "strong_close"].includes(token.type)
            ? "u"
            : token.tag;
        if (
          [
            "ul",
            "ol",
            "li",
            "table",
            "thead",
            "tbody",
            "tr",
            "th",
            "td",
            "blockquote",
            "strong",
            "em",
            "u",
            "s",
          ].includes(tag)
        ) {
          const start =
            tag === "ol" && /^\d{1,5}$/.test(token.attrGet("start") || "")
              ? ` start="${token.attrGet("start")}"`
              : "";
          return token.nesting === 1
            ? `<${tag}${start}>`
            : token.nesting === -1
              ? `</${tag}>`
              : "";
        }
        // Future extension tokens remain an honest literal, never raw wiki HTML.
        return literal(token.content || "");
      })
      .join("");
  return tokensWiki(blockMarkdownTokens(source));
}
export function mediaWikiDraft(document) {
  assertDocument(document);
  return (
    `<!-- MediaWiki draft: review templates, tables, links and media before import. -->\n= <nowiki>${escapeHtml(document.title)}</nowiki> =\n` +
    document.blocks
      .map((b) =>
        Object.hasOwn(b, "markdown")
          ? markdownWiki(b.markdown)
          : nodeWiki(b.node) + (b.tail ? nodeWiki(b.tail) : ""),
      )
      .join("") +
    `\n\n== Source and licence ==\nAdapted from [${document.source.url} PvME contributors], [${document.source.licenseUrl} ${document.source.license}]. Source captured ${document.source.retrieved}. This draft includes reviewed changes in this independent edition. Media rights are separate.\n`
  );
}
