import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../copy-button-ports');
const needed=JSON.parse(fs.readFileSync(path.join(dir,process.env.PVME_MIRROR_INPUT||'preset-mirror-needed.json')));
const reportFile=path.join(dir,process.env.PVME_MIRROR_REPORT||'preset-mirrors.json');
const report=fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile)):[];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function dimensions(bytes){
 if(bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return {naturalWidth:bytes.readUInt32BE(16),naturalHeight:bytes.readUInt32BE(20)};
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'){
  const kind=bytes.subarray(12,16).toString();
  if(kind==='VP8X')return {naturalWidth:bytes.readUIntLE(24,3)+1,naturalHeight:bytes.readUIntLE(27,3)+1};
  if(kind==='VP8L'){const packed=bytes.readUInt32LE(21);return {naturalWidth:(packed&0x3fff)+1,naturalHeight:((packed>>>14)&0x3fff)+1};}
  if(kind==='VP8 ')return {naturalWidth:bytes.readUInt16LE(26)&0x3fff,naturalHeight:bytes.readUInt16LE(28)&0x3fff};
 }
 return {};
}
fs.mkdirSync(path.join(dir,'original-presets'),{recursive:true});
for(const asset of needed){
 if(report.some(r=>r.original===asset.url&&r.matches))continue;
 const response=await fetch(asset.url,{signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error('Source image HTTP '+response.status+' '+asset.url);
 const bytes=Buffer.from(await response.arrayBuffer()),sha256=hash(bytes);
 const type=response.headers.get('content-type')||'';
 if(!type.startsWith('image/'))throw new Error('Expected source image: '+type);
 const extension=type.includes('webp')?'webp':type.includes('png')?'png':type.includes('jpeg')?'jpg':null;
 if(!extension)throw new Error('Unsupported original image type '+type);
 fs.writeFileSync(path.join(dir,'original-presets',sha256+'.'+extension),bytes);
 const form=new FormData();form.set('reqtype','fileupload');form.set('fileToUpload',new Blob([bytes],{type}),sha256+'.'+extension);
 const upload=await fetch('https://catbox.moe/user/api.php',{method:'POST',body:form,signal:AbortSignal.timeout(120000)});
 const hosted=(await upload.text()).trim();
 if(!upload.ok||!/^https:\/\/files\.catbox\.moe\/[a-z0-9]+\.(?:webp|png|jpg)$/.test(hosted))throw new Error('Hosting failed '+upload.status+' '+hosted.slice(0,200));
 const check=await fetch(hosted,{signal:AbortSignal.timeout(60000)});
 if(!check.ok)throw new Error('Hosted image HTTP '+check.status);
 const destinationSha256=hash(Buffer.from(await check.arrayBuffer()));
 const row={original:asset.url,hosted,alt:asset.alt,role:asset.role,bytes:bytes.length,type,...dimensions(bytes),sha256,destinationSha256,matches:sha256===destinationSha256,checkedAt:new Date().toISOString()};
 report.push(row);fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
 if(report.length%10===0||report.length===needed.length)console.log(JSON.stringify({completed:report.length,total:needed.length,hosted,matches:row.matches}));
 if(!row.matches)throw new Error('Original bytes changed during hosting');
 if(process.env.PVME_MIRROR_ONE==='1')break;
}
