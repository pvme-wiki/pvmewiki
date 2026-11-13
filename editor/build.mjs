import { thirdPartyNotices } from '../scripts/third-party-notices.mjs';
import { build } from 'esbuild';
import { mkdir, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertDocument } from './shared/model.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(root, 'dist');
const catalog = JSON.parse(await readFile(path.join(root, 'content/catalog.json'), 'utf8'));
if (!Array.isArray(catalog) || !catalog.length) throw new Error('The editable guide catalog is empty.');
const ids = new Set();
for (const guide of catalog) {
  if (!/^[a-z0-9-]+$/.test(guide.id) || guide.file !== `${guide.id}.json` || ids.has(guide.id)) throw new Error('Invalid or duplicate guide file.');
  ids.add(guide.id);
  const document = JSON.parse(await readFile(path.join(root, 'content', guide.file), 'utf8'));
  if (document.id !== guide.id) throw new Error(`Guide identity mismatch: ${guide.id}`);
  assertDocument(document, { baseline: document });
}
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of ['index.html', 'src', 'shared', 'assets']) await cp(path.join(root, name), path.join(target, name), { recursive: true });
await mkdir(path.join(target, 'content'));
for (const file of ['catalog.json', ...catalog.map(guide => guide.file)]) await cp(path.join(root, 'content', file), path.join(target, 'content', file));
console.log(`Built ${catalog.length} complete editable guides in editor/dist. Hosted service is required at /edit/.`);

// Bundle browser-only dependencies; the server keeps importing the validated model directly.
await build({entryPoints:[path.join(root,'src/app.mjs'),path.join(root,'src/workbench.mjs')],outdir:path.join(target,'src'),outExtension:{'.js':'.mjs'},bundle:true,format:'esm',splitting:true,platform:'browser',target:['es2022'],minify:true,legalComments:'linked',metafile:false});
const draftHtml=(await readFile(path.join(root,'index.html'),'utf8')).replace('src="./src/app.mjs"','src="./src/workbench.mjs"').replace('<title>PvME · Guide editor</title>','<title>PvME · Editor review draft</title>');
if (process.env.VERCEL_ENV !== 'production') await writeFile(path.join(target,'draft.html'),draftHtml);

await writeFile(path.join(target,'assets/THIRD-PARTY-NOTICES.txt'),thirdPartyNotices(path.dirname(root)));
