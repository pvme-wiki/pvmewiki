export interface TextNode { id: string; type: 'text'; text: string }
export interface ElementNode {
  id: string;
  type: 'element';
  /** Finite allowlist enforced at runtime. No scripts, styles, forms, or arbitrary HTML. */
  tag: string;
  /** Finite, tag-specific allowlist enforced at runtime. */
  attrs: Record<string, string>;
  children: GuideNode[];
}
export type GuideNode = TextNode | ElementNode;
export interface GuideBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'media' | 'preserved';
  editable: boolean;
  /** Immutable identities; empty text remains editable after the user clears it. */
  editableTextNodeIds: string[];
  label: string;
  sourcePath: string;
  reason?: string;
  node: GuideNode;
  /** Original inter-element whitespace, always read-only. */
  tail?: TextNode;
}
export interface GuideStats {
  blocks: number; editableBlocks: number; preservedBlocks: number;
  nodes: number; elementNodes: number; textNodes: number;
  icons: number; media: number; links: number;
}
export interface GuideSource {
  articleId: string; url: string; route: string; sourcePath: string; title: string;
  retrieved: string; attribution: string; license: string | null;
  licenseUrl: string | null; sourceLicenseUrl: string | null;
  contentMode: string | null; modifications: string | null;
  rawSha256: string; importedHtmlSha256: string; normalizedSourceHtmlSha256: string;
  sourceTextSha256: string | null; webTextSha256: string | null;
  snapshotFile: string; importVersion: 1; importNote: string;
  unresolvedReferences: unknown[]; webAdaptation: Record<string, unknown>; stats: GuideStats;
}
export interface GuideDocument {
  schemaVersion: 1;
  id: string;
  title: string;
  source: GuideSource;
  blocks: GuideBlock[];
}
export interface CatalogEntry {
  id: string; title: string; category: string; file: string; summary: string; stats: GuideStats;
}
export interface RenderOptions {
  /** Wrappers are inert; the caller controls native editing/accessibility attributes. */
  textNodeAttributes?: boolean;
  /** Presentation-only /archive link rewrite. Omit for source-faithful rendering. */
  readerBaseUrl?: string;
  baseline?: GuideDocument;
}
export const SCHEMA_VERSION: 1;
export const MODEL_LIMITS: Readonly<{bytes:number;blocks:number;nodes:number;depth:number;text:number}>;
export function escapeHtml(value: unknown): string;
export function isSafeUrl(value: unknown, options?: {media?:boolean;iframe?:boolean}): boolean;
export function validateDocument(document: unknown, options?: {baseline?:GuideDocument}): {valid:boolean;errors:string[]};
export function assertDocument(document: unknown, options?: {baseline?:GuideDocument}): GuideDocument;
export function textContent(nodeOrBlock: GuideNode | GuideBlock): string;
export function getEditableTextNodes(block: GuideBlock): Array<{id:string;text:string}>;
export function updateTextNode(document: GuideDocument, blockId: string, nodeId: string, text: string): GuideDocument;
export function renderDocument(document: GuideDocument, options?: RenderOptions): string;
export function renderBlock(block: GuideBlock, options?: RenderOptions): string;
export function renderAttribution(document: GuideDocument): string;

export interface EmojiAsset { readonly id:string; readonly src:string; readonly alt:string; readonly title:string; }
export const EMOJI_ASSETS: readonly EmojiAsset[];
export function emojiAsset(node: GuideNode): EmojiAsset | null;
export function getEditableEmojiNodes(block: GuideBlock): Array<{id:string;asset:EmojiAsset}>;
export function updateEmojiNode(document: GuideDocument, blockId:string, nodeId:string, assetId:string): GuideDocument;
