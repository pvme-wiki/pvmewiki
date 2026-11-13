import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderBlockMarkdown, blockMarkdownText, sourceBlockMarkdown, imageMarkdown } from '../shared/block-markdown.mjs';
import { validateDocument, renderDocument, MODEL_LIMITS } from '../shared/model.mjs';
import { isSafeImageSource, rasterImageInfo, rasterFileSource } from '../shared/image-source.mjs';
const baseline=JSON.parse(fs.readFileSync(new URL('../content/arch-glacor-basic.json',import.meta.url)));
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=';
const embedded='data:image/png;base64,'+png;
const text=value=>({type:'text',text:value});
const element=(tag,children=[],attrs={})=>({type:'element',tag,children,attrs});
const renderSource=node=>renderBlockMarkdown(sourceBlockMarkdown({node}));
const activeURL=/\b(?:src|href)="(?:javascript|vbscript|file|blob|data:text|data:image\/svg)/i;
test('whole-block Markdown never activates raw HTML, dangerous URLs or nested image/link attacks',()=>{
 const attacks=[
  '<script>alert(1)</script><img src=x onerror=alert(1)>',
  '[open](javascript:alert%281%29)',
  '[open](java&#x73;cript:alert%281%29)',
  '[open](data:text/html;base64,PHNjcmlwdD4=)',
  '![preset](data:image/svg+xml;base64,PHN2Zz4=)',
  '[![preset](https://images.example/a.png)](javascript:alert%281%29)',
  '[![preset](javascript:alert%281%29)](https://example.org)',
  '![x\" onerror=\"alert(1)](https://images.example/a.png)',
  '[open](https://name:password@example.org/a)',
  '![preset](//example.org/a.png)',
  '[open](<java\tscript:alert(1)>)',
  '![preset](data:image/png;base64,PHN2Zz4=)',
  '[![preset]('+embedded+')](data:text/html;base64,PHNjcmlwdD4=)',
 ];
 for(const source of attacks){
  const html=renderBlockMarkdown(source);
  assert.doesNotMatch(html,/<script\b|<iframe\b|<svg\b|<img\b[^>]*"\s+onerror\s*=/i,source.slice(0,90));
  assert.doesNotMatch(html,activeURL,source.slice(0,90));
  const doc=structuredClone(baseline);doc.blocks[0].markdown=source;
  assert.equal(validateDocument(doc,{baseline}).valid,true);
  assert.doesNotMatch(renderDocument(doc,{baseline}),activeURL);
 }
 const good=renderBlockMarkdown('[![Preset]('+embedded+')](https://example.org/preset)');
 assert.ok(good.includes('<img src="data:image/png;base64,'));assert.ok(good.includes('href="https://example.org/preset"'));
});
test('Markdown content cannot silently mutate canonical node identities, source or arbitrary attributes',()=>{
 const changes=[d=>d.source.attribution='Other author',d=>d.blocks[0].id='replacement',d=>d.blocks[0].sourcePath='/different',d=>d.blocks[0].node.attrs.onclick='alert(1)',d=>d.blocks[0].editable=!d.blocks[0].editable];
 for(const change of changes){const doc=structuredClone(baseline);doc.blocks[0].markdown='Revised wording';change(doc);assert.equal(validateDocument(doc,{baseline}).valid,false);}
 const doc=structuredClone(baseline);const populated=doc.blocks.find(b=>b.node.children.length);populated.markdown='Revised wording';populated.node.children=[];assert.equal(validateDocument(doc,{baseline}).valid,false);
});
test('document byte budget applies to combined block edits and Unicode text',()=>{
 const doc=structuredClone(baseline);doc.blocks[0].markdown='x'.repeat(MODEL_LIMITS.bytes);assert.equal(validateDocument(doc,{baseline}).valid,false);
 const split=structuredClone(baseline);split.blocks[0].markdown='x'.repeat(2_600_000);split.blocks[1].markdown='y'.repeat(2_600_000);assert.equal(validateDocument(split,{baseline}).valid,false);
 const unicode=structuredClone(baseline);unicode.blocks[0].markdown='日'.repeat(1_700_000);assert.ok(new TextEncoder().encode(JSON.stringify(unicode)).length>MODEL_LIMITS.bytes);assert.equal(validateDocument(unicode,{baseline}).valid,false);
});
test('malformed raster containers and forged MIME types never become embedded image sources',async()=>{
 const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
 const cases=[bytes.subarray(0,33),bytes.subarray(0,bytes.length-1),Uint8Array.from([71,73,70,56,57,97,1,0,1,0,0,0,0,0x3b]),Uint8Array.from([0xff,0xd8,0xff,0xd9]),new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')];
 for(const b of cases){assert.throws(()=>rasterImageInfo(b));assert.equal(isSafeImageSource('data:image/png;base64,'+btoa(String.fromCharCode(...b))),false);await assert.rejects(rasterFileSource({size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}));}
 assert.equal(isSafeImageSource('data:image/jpeg;base64,'+png),false);
 for(const src of ['https://x.example/a.png\n','https://x.example/a.png\\evil','https://user:pass@x.example/a.png','data:image/png;base64,'+png.replace(/=+$/,''),'data:image/png;base64,'+png+'AAAA'])assert.equal(isSafeImageSource(src),false);
});
test('source serializer preserves headings, literal pipes, list items and table captions when edited',()=>{
 assert.match(renderSource(element('h3',[text('Attack #1')])),/<h3>Attack #1<\/h3>/);
 const list=renderSource(element('ul',[text('\n'),element('li',[text('First')]),text('\n'),element('li',[text('Second')]),text('\n')]));
 assert.equal((list.match(/<li>/g)||[]).length,2);assert.match(list,/<li>First<\/li>/);assert.match(list,/<li>Second<\/li>/);
 const ordered=renderSource(element('ol',[element('li',[text('Third')]),element('li',[text('Fourth')])],{start:'3'}));assert.match(ordered,/<ol start="3">/);
 const table=renderSource(element('table',[element('caption',[text('Preset comparison')]),element('thead',[element('tr',[element('th',[text('Style | weapon')]),element('th',[text('Notes')])])]),element('tbody',[element('tr',[element('td',[text('Magic')]),element('td',[text('Keep the familiar setup')])])])]));
 assert.match(table,/Preset comparison/);assert.match(table,/<th>Style \| weapon<\/th>/);assert.match(table,/<td>Keep the familiar setup<\/td>/);
});
test('code blocks and inline backticks survive writing serialization and search text',()=>{
 const inline=renderSource(element('p',[element('code',[text('a`b')])]));assert.match(inline,/<code>a`b<\/code>/);
 const fenced=renderSource(element('pre',[text('one\n```\nthree')]));assert.match(fenced,/<pre><code>one\n```\nthree\n<\/code><\/pre>/);assert.equal((fenced.match(/<pre>/g)||[]).length,1);
 assert.match(blockMarkdownText('```\nability()\n```'),/ability\(\)/);
});
test('source writing serialization is read-only and escapes Markdown-like original prose',()=>{
 const block=baseline.blocks.find(b=>b.type==='paragraph');const original=JSON.stringify(block);sourceBlockMarkdown(block);assert.equal(JSON.stringify(block),original);
 const node=element('p',[text('Do not [open](javascript:evil) or <script> anything; use **literal** notation.')]);const html=renderSource(node);assert.doesNotMatch(html,/<a\b|<script\b|<strong\b/);assert.match(html,/\*\*literal\*\*/);
 for(const original of ['~~literal~~','1. literal number','- literal dash']) {
  const rendered=renderSource(element('p',[text(original)]));
  assert.doesNotMatch(rendered,/<s>|<ol>|<ul>/);assert.ok(rendered.includes(original));
 }
 const definition=renderSource(element('dl',[element('dt',[text('Term')]),element('dd',[text('Definition')]),element('dt',[text('Second')]),element('dd',[text('Meaning')])]));
 assert.doesNotMatch(definition,/TermDefinition|SecondMeaning/);assert.match(definition,/Term/);assert.match(definition,/Definition/);
 const linked=renderSource(element('p',[element('a',[text('Open')],{href:'https://example.org/a b>c'})]));assert.match(linked,/href="https:\/\/example\.org\/a%20b%3Ec"/);
 const image=imageMarkdown('https://images.example/preset.png','Preset [one]');assert.match(renderBlockMarkdown(image),/alt="Preset \[one\]"/);
});

test('editing adjacent Markdown preserves only the original validated iframe, video and audio embeds',()=>{
 const node=(id,tag,children=[],attrs={})=>({id,type:'element',tag,attrs,children});
 const words=(id,value)=>({id,type:'text',text:value});
 const original=structuredClone(baseline);
 original.blocks=[{id:'mixed-media-block',type:'preserved',editable:false,label:'Media',sourcePath:baseline.source.sourcePath,editableTextNodeIds:[],node:node('mixed-media-root','div',[
  node('mixed-before','p',[words('mixed-before-text','Before the example')]),
  node('mixed-iframe','iframe',[],{src:'https://www.youtube-nocookie.com/embed/abc123',width:'560',height:'315',title:'Combat example',id:'combat-example-anchor'}),
  node('mixed-video','video',[node('mixed-video-source','source',[],{src:'https://media.example.org/example.mp4',type:'video/mp4'})],{controls:'',poster:'https://images.example.org/poster.png'}),
  node('mixed-audio','audio',[],{src:'https://media.example.org/example.mp3',controls:''}),
  node('mixed-after','p',[words('mixed-after-text','After the example')]),
 ])}];
 assert.equal(validateDocument(original,{baseline:original}).valid,true);
 const originalHTML=renderDocument(original),writing=sourceBlockMarkdown(original.blocks[0]);
 const edited=structuredClone(original);edited.blocks[0].markdown=writing.replace('Before the example','Improved explanation before the example');
 assert.equal(validateDocument(edited,{baseline:original}).valid,true);
 const html=renderDocument(edited,{baseline:original});
 assert.match(html,/Improved explanation before the example/);assert.match(html,/After the example/);
 for(const tag of ['iframe','video','audio']){
  const regex=new RegExp('<'+tag+'\\b[^>]*>[\\s\\S]*?<\\/'+tag+'>');
  assert.ok(html.includes(originalHTML.match(regex)[0]),tag+' keeps its validated original markup');
  assert.equal((html.match(new RegExp('<'+tag+'\\b','g'))||[]).length,1);
 }
 assert.match(html,/sandbox="allow-scripts allow-same-origin allow-presentation"/);
 assert.match(html,/referrerpolicy="strict-origin-when-cross-origin"/);
 assert.equal((html.match(/id="combat-example-anchor"/g)||[]).length,1,'preserved iframe anchor is not duplicated');
 assert.doesNotMatch(renderBlockMarkdown(writing),/<iframe\b|<video\b|<audio\b/,'standalone Markdown cannot introduce embeds');
 const changed=structuredClone(original);changed.blocks[0].markdown='[Video](<https://www.youtube-nocookie.com/embed/new123>)\n\n[Changed label](<https://www.youtube-nocookie.com/embed/abc123>)';
 const removedHTML=renderDocument(changed,{baseline:original});assert.doesNotMatch(removedHTML,/<iframe\b/,'unknown URLs or changed labels remain ordinary links');assert.match(removedHTML,/<span id="combat-example-anchor"/,'removed media keeps its legacy anchor');
 const repeated=structuredClone(original);repeated.blocks[0].markdown='[Video](<https://www.youtube-nocookie.com/embed/abc123>)\n\n[Video](<https://www.youtube-nocookie.com/embed/abc123>)';
 const repeatedHTML=renderDocument(repeated,{baseline:original});assert.equal((repeatedHTML.match(/<iframe\b/g)||[]).length,1);assert.match(repeatedHTML,/<a href="https:\/\/www.youtube-nocookie.com\/embed\/abc123"/,'additional references remain links');
 const tampered=structuredClone(edited);tampered.blocks[0].node.children[1].attrs.src='https://www.youtube-nocookie.com/embed/new123';assert.equal(validateDocument(tampered,{baseline:original}).valid,false);
});

test('identical original embed references retain their own attributes in document order',()=>{
 const original=structuredClone(baseline),block=original.blocks.find(b=>b.type==='paragraph');
 block.editable=false;block.editableTextNodeIds=[];
 const iframe=(id,width)=>({id,type:'element',tag:'iframe',attrs:{src:'https://www.youtube.com/embed/duplicate',width,title:width+' pixel video'},children:[]});
 block.node.children=[iframe('duplicate-one','320'),iframe('duplicate-two','640')];
 const edited=structuredClone(original);edited.blocks.find(b=>b.id===block.id).markdown=sourceBlockMarkdown(block)+'\n\nAdditional context.';
 const rendered=renderDocument(edited,{baseline:original});
 assert.match(rendered,/<iframe\b[^>]*width="320"/);assert.match(rendered,/<iframe\b[^>]*width="640"/);
 assert.ok(rendered.indexOf('width="320"')<rendered.indexOf('width="640"'));
});

test('edited Markdown headings have deterministic block-scoped IDs and retain original deep-link aliases',()=>{
 const original=structuredClone(baseline),blocks=original.blocks.filter(b=>b.type==='heading').slice(0,2);
 assert.equal(blocks.length,2);
 blocks[0].node.attrs.id='legacy-preset-heading';blocks[1].node.attrs.id='legacy-rotation-heading';
 const edited=structuredClone(original),a=edited.blocks.find(b=>b.id===blocks[0].id),b=edited.blocks.find(b=>b.id===blocks[1].id);
 a.markdown='## Presets revised\n\n### Presets revised\n\n## Extra details';b.markdown='## Rotations revised\n\n### Extra details';
 const html=renderDocument(edited,{baseline:original});
 for(const [block,count]of [[a,3],[b,2]])for(let i=1;i<=count;i++)assert.ok(html.includes(`id="md-${block.id}-${i}"`));
 for(const id of ['legacy-preset-heading','legacy-rotation-heading'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,'heading and alias IDs are unique across the rendered guide');
 assert.equal(renderDocument(edited,{baseline:original}),html,'IDs are stable between renders');
 assert.deepEqual(edited.source,original.source);for(let i=0;i<original.blocks.length;i++)assert.deepEqual(edited.blocks[i].node,original.blocks[i].node);
 const noOp=renderDocument(original,{baseline:original});assert.ok(noOp.includes('id="legacy-preset-heading"'));assert.ok(!noOp.includes(`id="md-${a.id}-1"`),'unchanged source AST headings keep their original rendering');
 const collision=structuredClone(original),changed=collision.blocks.find(block=>block.id===blocks[0].id);changed.node.attrs.id=`md-${changed.id}-1`;
 const collisionBase=structuredClone(collision);changed.markdown='## Replacement heading';const collisionHTML=renderDocument(collision,{baseline:collisionBase});
 assert.equal(collisionHTML.split(`id="md-${changed.id}-1"`).length-1,1,'a matching legacy alias uses the real heading target instead of adding a duplicate span');
});

test('standalone Markdown heading prefixes cannot inject attributes and omit IDs when absent',()=>{
 assert.doesNotMatch(renderBlockMarkdown('## Heading'),/\bid=/);
 assert.match(renderBlockMarkdown('## One\n\n### Two',{headingPrefix:'md-valid:passage'}),/<h2 id="md-valid:passage-1">One<\/h2>\n<h3 id="md-valid:passage-2">Two<\/h3>/);
 const html=renderBlockMarkdown('## Heading',{headingPrefix:'bad" onclick="alert(1)'});assert.doesNotMatch(html,/\bid=|onclick=/);
});
