/**
 * Installs parse5, the HTML parser the capture and audit scripts use, without
 * npm: each pinned tarball is downloaded from the npm registry, checked against
 * its published SHA-512 integrity and unpacked with the system `tar`.
 *
 * Writes: .dependencies/ in this directory (git-ignored): the tarballs and
 *     node_modules/<name>/.
 * Network: GET of the two tarballs from https://registry.npmjs.org.
 * Throws on an HTTP error or an integrity mismatch, before unpacking.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '.dependencies');
const PACKAGES = [
    {
        name: 'parse5',
        version: '8.1.1',
        integrity: 'sha512-EcR/6WDcU7b2N3vQSxKALCk9lXGtUMQxXio008OEMBE0kavu/' +
            '7JLfBEeFPzi43nMqVDSbEn3QCK+BMCc9zO//w==',
    },
    {
        name: 'entities',
        version: '9.0.0',
        integrity: 'sha512-oJFNDJg3kTPwAD1cNn2+WmUq4wFoo09npc3Ydf1D7ED4smRiWrsKnaLxykrT' +
            'WgyGEcusc87P5dxlAleol9kpkg==',
    },
];

async function install({ name, version, integrity }) {
    const url = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Dependency HTTP ${response.status}: ${url}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if ('sha512-' + crypto.createHash('sha512').update(bytes).digest('base64') !== integrity) {
        throw new Error('Dependency integrity mismatch: ' + name);
    }
    const archive = path.join(OUT, name + '.tgz');
    const destination = path.join(OUT, 'node_modules', name);
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(archive, bytes);
    execFileSync('tar', ['-xzf', archive, '-C', destination, '--strip-components=1']);
    console.log(`Installed ${name}@${version} from official npm registry (integrity checked).`);
}

fs.mkdirSync(OUT, { recursive: true });
for (const dependency of PACKAGES) {
    await install(dependency);
}
