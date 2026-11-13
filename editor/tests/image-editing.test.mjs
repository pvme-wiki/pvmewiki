import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getEditableImageNodes, getEditableEmojiNodes, updateImageNode, validateDocument, renderDocument } from '../shared/model.mjs';
import { isSafeImageSource, imageSourceError, rasterImageInfo, rasterFileSource, MAX_IMAGE_BYTES } from '../shared/image-source.mjs';
import { sectionImageChoices, imageReplacementHTML, imageSourceSummary } from '../src/image-picker.mjs';
const baseline = JSON.parse(fs.readFileSync(new URL('../content/arch-glacor-basic.json', import.meta.url)));
const block = baseline.blocks.find(b => getEditableImageNodes(b).length);
const image = getEditableImageNodes(block)[0];
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=';
const embedded = `data:image/png;base64,${png}`;
const find = (doc,id) => { let found; const walk=n=>{if(n.id===id)found=n;n.children?.forEach(walk);};doc.blocks.forEach(b=>walk(b.node));return found; };
test('existing image replacement changes only src and alt and is valid in save/publication model',()=>{
 const next=updateImageNode(baseline,block.id,image.id,{src:'https://images.example/preset.png',alt:'Updated equipment preset'});
 assert.equal(validateDocument(next,{baseline}).valid,true);
 assert.equal(find(next,image.id).attrs.src,'https://images.example/preset.png');
 assert.equal(find(baseline,image.id).attrs.src,image.src);
 assert.match(renderDocument(next,{baseline}),/src="https:\/\/images.example\/preset.png"/);
 for(const key of ['id','type','tag','children'])assert.deepEqual(find(next,image.id)[key],find(baseline,image.id)[key]);
 const beforeAttrs=find(baseline,image.id).attrs,afterAttrs=find(next,image.id).attrs;
 for(const key of Object.keys(beforeAttrs).filter(k=>!['src','alt'].includes(k)))assert.equal(afterAttrs[key],beforeAttrs[key]);
});
test('image replacements cannot change handlers, layout, node identity, emoji classification or provenance',()=>{
 for(const mutate of [n=>n.attrs.onclick='alert(1)',n=>n.attrs.width='999',n=>n.attrs.class='d-emoji',n=>n.id='new-image',n=>n.attrs.title='changed',n=>n.children.push({id:'new-text',type:'text',text:'injected'})]){
  const next=updateImageNode(baseline,block.id,image.id,{src:'https://images.example/preset.png',alt:'Preset'});mutate(find(next,image.id));assert.equal(validateDocument(next,{baseline}).valid,false);
 }
 const iconBlock=baseline.blocks.find(b=>getEditableEmojiNodes(b).length),icon=getEditableEmojiNodes(iconBlock)[0];
 assert.throws(()=>updateImageNode(baseline,iconBlock.id,icon.id,{src:'https://images.example/preset.png',alt:'Not an arbitrary icon'}));
 const next=updateImageNode(baseline,block.id,image.id,{src:'/assets/preset.png',alt:'Preset'});next.source.attribution='Someone else';assert.equal(validateDocument(next,{baseline}).valid,false);
});
test('unsafe image protocols, credential URLs, mislabeled embedded content and oversize data are rejected',()=>{
 for(const src of ['javascript:alert(1)','data:image/svg+xml;base64,PHN2Zz4=','data:text/html;base64,PGgxPg==','data:image/png;base64,PHN2Zz4=','data:image/gif;base64,'+png,'http://images.example/preset.png','//images.example/preset.png','https://user:pass@images.example/a.png','https://images.example/a.png#fragment','/\\evil.example/a.png',' https://images.example/a.png',`data:image/png;base64,${'A'.repeat(Math.ceil(MAX_IMAGE_BYTES/3)*4+4)}`]){
  assert.equal(isSafeImageSource(src),false,src.slice(0,100));assert.ok(imageSourceError(src));
  assert.throws(()=>updateImageNode(baseline,block.id,image.id,{src,alt:'Preset'}));
 }
 for(const src of ['https://images.example/preset.png','/assets/preset.png',embedded])assert.equal(isSafeImageSource(src),true);
});
test('local raster file validation is shared with document validation and survives exact rendering',async()=>{
 const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));assert.deepEqual(rasterImageInfo(bytes),{mime:'image/png',width:1,height:1,bytes:bytes.length});
 assert.equal(await rasterFileSource({size:bytes.length,arrayBuffer:async()=>bytes.buffer}),embedded);
 const next=updateImageNode(baseline,block.id,image.id,{src:embedded,alt:'Uploaded preset'});assert.equal(validateDocument(next,{baseline}).valid,true);assert.ok(renderDocument(next).includes(embedded));
 const bomb=bytes.slice();bomb[16]=0x7f;assert.throws(()=>rasterImageInfo(bomb),/pixels|megapixels/);
 await assert.rejects(rasterFileSource({size:MAX_IMAGE_BYTES+1,arrayBuffer:async()=>bytes.buffer}),/1 MB/);
 await assert.rejects(rasterFileSource({size:4,arrayBuffer:async()=>new TextEncoder().encode('<svg').buffer}),/PNG/);
});
test('image chooser distinguishes normal images from ability icons and escapes user text',()=>{
 const choices=sectionImageChoices([block]);assert.match(choices,/data-action="choose-image"/);assert.ok(choices.includes(image.id));assert.match(sectionImageChoices([block],'no-such-preset-image'),/0 images/);
 const html=imageReplacementHTML({src:'https://images.example/a.png?x="bad"',alt:'<script>bad</script>'});assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/image-replacement-file/);assert.match(html,/Changes become public after review and publication/);
 assert.equal(imageSourceSummary(embedded),'Uploaded PNG image');assert.ok(!imageReplacementHTML({src:embedded,alt:'Preset'}).includes(`value="${embedded}"`));
});

test('supported raster formats validate real image containers with matching MIME and dimensions',()=>{
 const fixtures={"JPEG": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK7DkP/9k=", "WEBP": "UklGRjAAAABXRUJQVlA4ICQAAABQAQCdASoCAAMAAUAmJQBOgCgAAP7y635HYQ3YcuuLmyG8AAA=", "GIF": "R0lGODdhAgADAIEAADxQZAAAAAAAAAAAACwAAAAAAgADAAAIBgABCBwYEAA7"};
 for(const [kind,encoded]of Object.entries(fixtures)){const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const mime='image/'+kind.toLowerCase();assert.equal(isSafeImageSource('data:'+mime+';base64,'+encoded),true);const info=rasterImageInfo(bytes);assert.equal(info.width,2);assert.equal(info.height,3);assert.equal(info.mime,mime);const truncated=bytes.slice(0,-1);assert.throws(()=>rasterImageInfo(truncated));}
});
