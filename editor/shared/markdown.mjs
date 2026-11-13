import { EMOJI_SHORTCUTS } from "./emoji-shortcuts.mjs";
import MarkdownIt from "markdown-it";
import { EMOJI_ASSETS } from "./emoji-catalog.mjs";
export const MARKDOWN_FORMAT = "pvme-markdown-v1";
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9_]/g, "");
const byName = new Map(),
  byDiscord = new Map();
for (const asset of EMOJI_ASSETS) {
  const key = normalize(asset.alt);
  if (!byName.has(key)) byName.set(key, asset);
  const id = asset.id.match(/\[(\d+)\]/)?.[1];
  if (id) byDiscord.set(id, asset);
}
for (const [name, discordId, aliases] of EMOJI_SHORTCUTS) {
  const asset = byDiscord.get(discordId);
  if (!asset) continue;
  for (const shortcut of [name, ...aliases])
    byName.set(normalize(shortcut), asset);
}
// Dragon breath is named dbreath (alias db) in pvme-settings/emojis_v2.json.
for (const alias of ["dragonbreath", "dragon_breath", "db"])
  if (byName.has("dbreath")) byName.set(alias, byName.get("dbreath"));
export function shortcodeAsset(name) {
  return byName.get(normalize(name)) || null;
}
export const emojiCompletions = [...byName].map(([name, asset]) => ({
  name,
  asset,
}));
const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: true,
});
// Links, media and structure are still owned by the constrained guide AST.
// Markdown text can never create a new URL, HTML node or arbitrary image.
md.disable(["link", "image", "autolink"]);
md.inline.ruler.before("text", "pvme_emoji", (state, silent) => {
  const source = state.src.slice(state.pos);
  const shortcut = source.match(/^:([a-zA-Z0-9_]+):/);
  const discord = source.match(/^<a?:([a-zA-Z0-9_]+):(\d+)>/);
  const match = shortcut || discord;
  const asset = shortcut
    ? shortcodeAsset(shortcut[1])
    : discord
      ? byDiscord.get(discord[2])
      : null;
  if (!match || !asset) return false;
  if (!silent) {
    const token = state.push("pvme_emoji", "img", 0);
    token.meta = asset;
    token.content = match[0];
  }
  state.pos += match[0].length;
  return true;
});
// A colon begins an emoji token, even when it is adjacent to rotation text.
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
md.renderer.rules.pvme_emoji = (tokens, i) => {
  const asset = tokens[i].meta;
  return `<img class="d-emoji" src="${escape(asset.src)}" alt="${escape(asset.alt)}" title="${escape(asset.title)}" loading="lazy" referrerpolicy="no-referrer">`;
};
const defaultStrongOpen = md.renderer.rules.strong_open,
  defaultStrongClose = md.renderer.rules.strong_close;
md.renderer.rules.strong_open = (tokens, i, options, env, renderer) =>
  tokens[i].markup === "__"
    ? "<u>"
    : defaultStrongOpen
      ? defaultStrongOpen(tokens, i, options, env, renderer)
      : "<strong>";
md.renderer.rules.strong_close = (tokens, i, options, env, renderer) =>
  tokens[i].markup === "__"
    ? "</u>"
    : defaultStrongClose
      ? defaultStrongClose(tokens, i, options, env, renderer)
      : "</strong>";
export function renderInlineMarkdown(source) {
  return md.renderInline(source);
}
export function inlineMarkdownTokens(source) {
  return md.parseInline(source, {})[0]?.children || [];
}

export function inlineMarkdownText(source) {
  return inlineMarkdownTokens(source)
    .map((token) =>
      token.type === "pvme_emoji"
        ? token.meta.alt
        : ["text", "code_inline"].includes(token.type)
          ? token.content
          : ["softbreak", "hardbreak"].includes(token.type)
            ? "\n"
            : "",
    )
    .join("");
}
