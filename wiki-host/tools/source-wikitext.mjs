import crypto from 'node:crypto';

export const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
export const sourceText=node=>node.text!==undefined?node.text:(node.children||[]).map(sourceText).join('');
export const normalText=value=>value.replace(/\s+/gu,' ').trim();
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const semanticTags=new Set(['h1','h2','h3','h4','h5','h6','p','div','span','ins','strong','em','u','code','kbd','del','s','b','i','br','hr','pre','ul','ol','li','blockquote','table','caption','thead','tbody','tfoot','tr','th','td','colgroup','col','sub','sup','small','details','summary']);
const voidTags=new Set(['br','hr','col']);

export function renderSourceGuide({nodes,sourceURL,sourceTitle,additions=[]}){
 const heading=nodes.find(n=>n.tag==='h1');
 const media=[],links=[],unwrappedTags=new Set(),mediaHosts=new Set();
 let currentMechanic='';const emittedAdditions=new Set();
 const absolute=url=>new URL(url,sourceURL).href;
 function rememberURL(url){const resolved=absolute(url);mediaHosts.add(new URL(resolved).hostname);return resolved;}
 function attrsString(attrs){return Object.entries(attrs).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>' '+k+'="'+escape(v)+'"').join('');}
 function render(n,inHeading=false){
  if(n.text!==undefined)return inHeading?escape(n.text):'<nowiki>'+escape(n.text)+'</nowiki>';
  if(!n.tag)return '';
  const a=n.attrs||{};
  const children=()=> (n.children||[]).map(c=>render(c,inHeading)).join('');
  if(n.tag==='script'||n.tag==='style')throw new Error('Non-guide executable/style node in '+sourceURL);
  if(n.tag==='img'){
   if(!a.src)throw new Error('Source image without src in '+sourceURL);
   const item={tag:'img',src:rememberURL(a.src),alt:a.alt??'',title:a.title??'',inHeading};media.push(item);
   const kind=(a.class||'').includes('emoji')?'icon':'media';
   if(inHeading)return '<img'+attrsString({src:item.src,alt:item.alt,title:item.title,class:kind==='icon'?'pvme-source-icon':'pvme-source-heading-image'})+'>';
   return '<pvme-image'+attrsString({src:item.src,alt:item.alt,title:item.title,kind})+' />';
  }
  if(n.tag==='video'){
   const sources=(n.children||[]).filter(c=>c.tag==='source');
   const src=a.src||sources[0]?.attrs?.src;
   if(!src)throw new Error('Source video without a source in '+sourceURL);
   const item={tag:'video',src:rememberURL(src),poster:a.poster?rememberURL(a.poster):null,controls:a.controls!==undefined,loop:a.loop!==undefined,muted:a.muted!==undefined,sources:sources.map(s=>({src:rememberURL(s.attrs.src),type:s.attrs.type||''}))};media.push(item);
   // Current PvME uses one source per video; refuse silent source loss.
   if(sources.length>1)throw new Error('Multiple source tracks require explicit mapping: '+sourceURL);
   return '<pvme-video'+attrsString({src:item.src,poster:item.poster,controls:item.controls?'1':'0',loop:item.loop?'1':'0',muted:item.muted?'1':'0',type:sources[0]?.attrs?.type||'video/mp4'})+' />';
  }
  if(n.tag==='iframe'){
   const src=rememberURL(a.src);media.push({tag:'iframe',src,title:a.title??'',allowfullscreen:a.allowfullscreen!==undefined});
   return '<pvme-embed'+attrsString({src,title:a.title??'',allowfullscreen:a.allowfullscreen!==undefined?'1':'0'})+' />';
  }
  if(n.tag==='a'){
   const href=a.href||'';links.push({href:href?absolute(href):'',text:sourceText(n),inHeading});
   if(!href)return '<span>'+children()+'</span>';
   if(inHeading)return '<a'+attrsString({href:absolute(href)})+'>'+children()+'</a>';
   const label=children();
   if(!label.trim())throw new Error('Empty source link needs explicit mapping: '+sourceURL);
   let result='['+absolute(href).replaceAll('[','%5B').replaceAll(']','%5D')+' '+label+']';
   for(const extra of additions){if(absolute(href)===extra.afterLink&&!emittedAdditions.has(extra.afterLink)){result+='<pvme-image'+attrsString({src:rememberURL(extra.src),alt:extra.alt||'',kind:'addition'})+' />';emittedAdditions.add(extra.afterLink);}}
   return result;
  }
  if(n.tag==='pre')return '<pre'+attrsString(a.id?{id:a.id}:{})+'>'+escape(sourceText(n))+'</pre>';
  if(!semanticTags.has(n.tag)){unwrappedTags.add(n.tag);return children();}
  const value=sourceText(n);let classes=[];
  if(n===heading)classes.push('pvme-source-title');
  if(n.tag==='p')classes.push('pvme-source-line');
  if(n.tag==='p'&&/^[\s\u200e\u200f]*[•⬩]/u.test(value))classes.push('pvme-source-detail');
  if(n.tag==='p'&&value.includes('→'))classes.push('pvme-source-sequence');
  if(n.tag==='p'&&/tri-colour|triple-strike/.test(currentMechanic)&&/Pathetic|Weak|Grovel|All strength withers|I will not suffer this|Your soul is WEAK/.test(value))classes.push('pvme-source-prayer');
  if(n.tag==='p'&&!value.replace(/[\s\u200b-\u200f]/gu,'')&&!(n.children||[]).some(c=>['img','video','iframe'].includes(c.tag)))classes.push('pvme-source-spacer');
  if((a.class||'').split(/\s+/).some(c=>['embed-description','embed-field-value'].includes(c)))classes.push('pvme-source-preserve-lines');
  if(n.tag==='table')classes.push('pvme-source-table');
  const outAttrs={};
  for(const k of ['id','colspan','rowspan','scope','start','reversed','value','type'])if(a[k]!==undefined)outAttrs[k]=a[k];
  if(classes.length)outAttrs.class=classes.join(' ');
  if(a.style){const parts=a.style.split(';').map(s=>s.trim()).filter(s=>/^(?:color|background-color|text-align|vertical-align|white-space)\s*:/i.test(s)&&!/(?:url|expression|var)\s*\(/i.test(s));if(parts.length)outAttrs.style=parts.join(';');}
  let content=children();
  return '<'+n.tag+attrsString(outAttrs)+'>'+content+(voidTags.has(n.tag)?'':'</'+n.tag+'>');
 }
 // The source H1 remains the native wiki page heading, including its icons/links.
 const headingHTML=heading?(heading.children||[]).map(n=>render(n,true)).join(''):escape(sourceTitle||'');
 // The same heading is stored in editable wikitext. The native wiki title is
 // a presentation copy, so its traversal must not duplicate source inventory.
 media.length=0;links.length=0;
 let body='__NOTOC__\n<div class="pvme-exact-guide">\n';let section=false,mechanic=false;
 for(const n of nodes){
  if(n.tag==='h2'){
   if(mechanic){body+='\n</div>';mechanic=false;}
   if(section)body+='\n</div>';
   body+='\n<div class="pvme-source-section"'+(/gear|preset|equipment|familiar|relic|recommended setup/i.test(sourceText(n))?' data-gear="true"':'')+'>\n';section=true;currentMechanic='';
  }
  if(n.tag==='h3'){
   if(mechanic)body+='\n</div>';
   body+='\n<div class="pvme-source-mechanic">\n';mechanic=true;currentMechanic=n.attrs?.id||'';
  }
  body+=render(n)+'\n';
 }
 if(mechanic)body+='\n</div>';if(section)body+='\n</div>';body+='\n</div>\n';
 body+='\n<div class="pvme-source-attribution">['+sourceURL+' PvME source] · PvME contributors · [https://creativecommons.org/licenses/by-nc-sa/4.0/ CC BY-NC-SA 4.0]. AI-assisted formatting; source wording retained.\n</div>';
 body=body.trimEnd();
 const headingText=heading?sourceText(heading):sourceTitle||'';
 const bodyText=normalText(nodes.map(sourceText).join(''));
 return {wikitext:body,heading:headingText,headingHTML,bodyText,bodyTextSha256:sha256(bodyText),sourceTextSha256:sha256(normalText(nodes.map(sourceText).join(''))),media,links,unwrappedTags:[...unwrappedTags],mediaHosts:[...mediaHosts],wikitextSha256:sha256(body)};
}
