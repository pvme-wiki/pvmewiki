import {
  getEditableEmojiNodes,
  textContent,
  escapeHtml as e,
} from "../shared/model.mjs";
export function sectionIconChoices(blocks, query = "") {
  const entries = blocks.flatMap((block) =>
    getEditableEmojiNodes(block).map((node, ordinal) => ({
      node,
      block,
      ordinal,
    })),
  );
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = entries.filter(({ node, block }) =>
    terms.every((term) =>
      `${node.asset.alt} ${textContent(block)}`.toLowerCase().includes(term),
    ),
  );
  return `<p role="status">${matches.length} ${matches.length === 1 ? "icon" : "icons"} in this section${matches.length > 60 ? "; showing the first 60" : ""}.</p><div class="section-icon-choices">${matches
    .slice(0, 60)
    .map(
      ({ node, block, ordinal }) =>
        `<button type="button" data-action="choose-emoji" data-block="${e(block.id)}" data-emoji-node="${e(node.id)}"><img src="${e(node.asset.src)}" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer"><span><strong>${e(node.asset.alt)}</strong><small>${e(textContent(block).trim().slice(0, 120) || "Original media")} · icon ${ordinal + 1}</small></span></button>`,
    )
    .join("")}</div>`;
}
