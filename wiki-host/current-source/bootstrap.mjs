import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '.dependencies');
const packages = [
    ['parse5', '8.1.1', 'sha512-EcR/6WDcU7b2N3vQSxKALCk9lXGtUMQxXio008OEMBE0kavu/7JLfBEeFPzi43nMqVDSbEn3QCK+BMCc9zO//w=='],
    ['entities', '9.0.0', 'sha512-oJFNDJg3kTPwAD1cNn2+WmUq4wFoo09npc3Ydf1D7ED4smRiWrsKnaLxykrTWgyGEcusc87P5dxlAleol9kpkg==']
];
fs.mkdirSync(out, { recursive: true });
for (const [name, version, integrity] of packages) {
    const url = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Dependency HTTP ${response.status}: ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if ('sha512-' + crypto.createHash('sha512').update(bytes).digest('base64') !== integrity) throw new Error('Dependency integrity mismatch: ' + name);
    const archive = path.join(out, name + '.tgz');
    const destination = path.join(out, 'node_modules', name);
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(archive, bytes);
    execFileSync('tar', ['-xzf', archive, '-C', destination, '--strip-components=1']);
    console.log(`Installed ${name}@${version} from official npm registry (integrity checked).`);
}
