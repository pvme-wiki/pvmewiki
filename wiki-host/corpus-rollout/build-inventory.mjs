import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Read-only inputs. All outputs stay beside this script; no imports or publication.
const out = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(out, '../..');
const upstream = path.resolve(process.argv[2] || path.join(site, '../..'));
const git = (...args) => execFileSync('git', args, { cwd: upstream, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const revision = git('rev-parse', 'HEAD').trim();
const baselineFile = path.join(site, 'wiki-host/corpus/manifest.json');
const baseline = read(baselineFile);
const prior = read(path.join(upstream, 'wiki-port/inventory.json'));
const assembled = read(path.join(upstream, 'wiki-port/assembled-packets.json'));
const visualFile = path.join(site, 'wiki-host/visual-guides/manifest.json');
const visual = fs.existsSync(visualFile) ? read(visualFile) : { pages: [] };
const key = value => value.toLowerCase();
const count = (items, field) => Object.fromEntries([...new Set(items.map(x => x[field]))].sort().map(v => [v, items.filter(x => x[field] === v).length]));
const canonicalTitle = value => value?.replace(/^User:Mo rs\/PvME(?=\/|$)/, 'PvME') || null;
const clean = value => value.replace(/<a?:[^:>]+:\d+>/g, '').replace(/[_*]/g, '').replace(/\s+/g, ' ').trim();
const priorByPath = new Map(prior.entries.map(x => [key(x.sourcePath), x]));
const packetsByPath = new Map();
for (const packet of assembled.packets) {
    if (!packet.sourcePath) continue;
    const k = key(packet.sourcePath);
    if (!packetsByPath.has(k)) packetsByPath.set(k, []);
    packetsByPath.get(k).push(packet);
}

// Explicit historical identity, NOT a fuzzy match or assertion of equal content.
const aliases = [{
    from: 'rs3-full-boss-guides/ghrazi-blood-knights/gbk-100-ranged-melee.txt',
    to: 'rs3-full-boss-guides/ghrazi-blood-knights/gbk-duo-100-ranged-melee.txt',
    evidence: [
        { commit: 'dee3a600cef8acffb1bee9202bd875d7ba523d34', change: 'R100 gbk-100-ranged-melee.txt -> gbk-solo-100-ranged-melee.txt' },
        { commit: '26a6c18f4c9eec7b0366c83f36fc239bbb15d656', change: 'R098 gbk-solo-100-ranged-melee.txt -> gbk-duo-100-ranged-melee.txt' }
    ],
    note: 'The current solo path is a separate file. Do not alias the historical page to both solo and duo.'
}];
const canonicalSource = source => aliases.find(a => key(a.from) === key(source))?.to || source;
const sourceForPage = page => {
    const source = page.provenance?.source?.sourcePath;
    return source ? source.replace(/^\/pvme-guides\//, '').replace(/\/$/, '') + '.txt' : null;
};
const pagesBySource = new Map();
for (const page of baseline.pages) {
    const original = sourceForPage(page);
    if (!original) continue;
    const k = key(canonicalSource(original));
    if (!pagesBySource.has(k)) pagesBySource.set(k, []);
    pagesBySource.get(k).push(page);
}

function classification(sourcePath) {
    const top = sourcePath.split('/')[0];
    if (sourcePath === 'LICENSE') return { type: 'license', audience: 'maintainer', reason: 'Repository licence' };
    if (sourcePath === 'README.md' || sourcePath.endsWith('.md')) return { type: 'documentation', audience: 'maintainer', reason: 'Repository documentation' };
    if (sourcePath.startsWith('.') || sourcePath.endsWith('.sh')) return { type: 'config', audience: 'maintainer', reason: 'Repository tooling, settings or automation' };
    if (sourcePath.endsWith('.json')) return { type: 'data', audience: 'community', reason: 'Machine-readable bingo data, not a prose guide' };
    if (sourcePath === 'afk/PVME-Alt1-Setup.txt') return { type: 'config', audience: 'player', reason: 'Exported Alt1 alert JSON; existing manifest calls this a guide' };
    if (top === 'navigation') return { type: 'index', audience: 'player', reason: 'Source navigation/community reference', subtype: sourcePath.startsWith('navigation/directory/') ? 'directory' : 'community-reference' };
    if (top === 'commands') return { type: 'command', audience: 'player', reason: 'Player-facing reference/command content; includes extensionless files' };
    if (top === 'archive') return { type: 'archived-guide', audience: 'player', reason: 'Archived content; keep archive status visible' };
    if (top === 'testing') return { type: 'draft-guide', audience: 'editor', reason: 'Upstream testing directory; not a reviewed main guide' };
    return { type: 'guide', audience: top === 'editor-resources' ? 'editor' : top === 'get-involved' ? 'community' : 'player', reason: top === 'editor-resources' ? 'Editor tutorial/reference' : top === 'get-involved' ? 'Community participation instructions' : 'Player guide' };
}

const tree = git('ls-tree', '-r', '-l', '-z', 'HEAD').split('\0').filter(Boolean).map(line => {
    const match = line.match(/^(\d+) (\w+) ([a-f0-9]+)\s+(\d+)\t([\s\S]+)$/);
    if (!match) throw new Error('Unsupported Git tree entry: ' + line);
    return { sourcePath: match[5], sourceBlob: match[3], blobBytes: Number(match[4]) };
});
const upstreamPaths = new Set(tree.map(x => key(x.sourcePath)));
const usedTitles = new Set(baseline.pages.map(x => key(x.title.replaceAll('_', ' '))));
const titleReservations = new Map();
const files = tree.map(entry => {
    const { sourcePath } = entry;
    const type = classification(sourcePath);
    const inventory = priorByPath.get(key(sourcePath));
    const packetRefs = packetsByPath.get(key(sourcePath)) || [];
    const represented = pagesBySource.get(key(sourcePath)) || [];
    const absolute = path.join(upstream, sourcePath);
    const text = fs.readFileSync(absolute, 'utf8');
    const heading = text.match(/^#\s+(.+)$/m)?.[1] || text.match(/"title"\s*:\s*"([^"\n]+)"/)?.[1];
    const title = clean(heading || inventory?.title || path.basename(sourcePath, path.extname(sourcePath)).replaceAll('-', ' '));
    const preferredPacket = packetRefs.find(p => p.kind === inventory?.kind) || packetRefs[0];
    const content = ['guide', 'archived-guide', 'draft-guide', 'command', 'index'].includes(type.type) || type.audience === 'player';
    let targetTitle = represented[0]?.title || (content ? canonicalTitle(preferredPacket?.target) || 'PvME/' + sourcePath.replace(/\.txt$/, '') : null);
    let titleMapping = represented.length ? 'existing-corpus-title' : preferredPacket && content ? 'prior-packet-target-proposal' : content ? 'source-path-proposal' : 'not-a-wiki-page';
    if (!represented.length && targetTitle && usedTitles.has(key(targetTitle.replaceAll('_', ' ')))) {
        targetTitle = 'PvME/Source/' + sourcePath.replace(/\.txt$/, '');
        titleMapping = 'source-path-proposal-avoids-existing-title-collision';
    }
    if (targetTitle) {
        const targetKey = key(targetTitle.replaceAll('_', ' '));
        if (titleReservations.has(targetKey)) throw new Error('Duplicate source target: ' + targetTitle + ' for ' + sourcePath + ' and ' + titleReservations.get(targetKey));
        titleReservations.set(targetKey, sourcePath);
    }
    return {
        ...entry, ...type, title, originalInventoryKind: inventory?.kind || null,
        workingTreeSha256: digest(absolute), sourceRevision: revision,
        sourceUrl: 'https://github.com/pvme/pvme-guides/blob/' + revision + '/' + sourcePath,
        inPreviousTxtInventory: Boolean(inventory), extensionless: !path.extname(sourcePath),
        targetTitle, titleMapping,
        coverage: represented.length ? 'represented-in-baseline' : content ? 'missing-from-baseline' : 'non-page-file',
        baselinePageIds: represented.map(p => p.id),
        baselinePageTitles: represented.map(p => p.title),
        snapshotPathAliases: aliases.filter(a => key(a.to) === key(sourcePath)),
        priorPackets: packetRefs.map(p => ({ target: p.target, kind: p.kind, file: p.file, state: p.state, destination: p.destination || null })),
        rolloutStatus: content ? 'not-editorially-reviewed' : 'not-applicable'
    };
});

const byPath = new Map(files.map(f => [key(f.sourcePath), f]));
const sitePages = baseline.pages.map(page => {
    const snapshotSourcePath = sourceForPage(page);
    const resolved = snapshotSourcePath ? canonicalSource(snapshotSourcePath) : null;
    const source = resolved ? byPath.get(key(resolved)) : null;
    return {
        id: page.id, title: page.title, manifestKind: page.kind,
        type: source?.type || page.kind, audience: source?.audience || 'player',
        file: 'wiki-host/corpus/' + page.file, sha256: page.sha256,
        snapshotSourcePath, upstreamSourcePath: source?.sourcePath || null,
        mapping: !snapshotSourcePath ? 'derived-navigation' : snapshotSourcePath === source?.sourcePath ? 'exact-path' : source ? 'historical-rename' : 'unresolved',
        sourceSnapshotCommit: baseline.sourceCommit,
        publicationEvidence: 'local-baseline-manifest; live revision not queried',
        rolloutStatus: 'not-editorially-reviewed'
    };
});
const authoredPages = visual.pages.map(page => ({
    title: page.title, file: 'wiki-host/visual-guides/' + page.file,
    type: page.namespace === 10 ? 'wiki-template' : 'authored-guide',
    publicationEvidence: 'local-authored-manifest; live revision not queried',
    note: 'Supplement/overlay, not another upstream source file; do not add to upstream coverage totals.'
}));
const unresolved = sitePages.filter(p => p.mapping === 'unresolved');
const duplicateTitles = Object.entries(sitePages.reduce((a, p) => ((a[key(p.title)] ||= []).push(p.id), a), {})).filter(([, ids]) => ids.length > 1);
const missing = files.filter(f => f.coverage === 'missing-from-baseline');
const summary = {
    upstreamTrackedFiles: files.length,
    upstreamTxtFiles: files.filter(f => f.sourcePath.endsWith('.txt')).length,
    previousTxtInventoryEntries: prior.entries.length,
    previousPacketsWithSourcePath: assembled.packets.filter(p => p.sourcePath).length,
    previousDistinctSourcePathsInPackets: new Set(assembled.packets.filter(p => p.sourcePath).map(p => key(p.sourcePath))).size,
    previousTotalPackets: assembled.packets.length,
    upstreamByType: count(files, 'type'), upstreamByCoverage: count(files, 'coverage'),
    baselinePages: sitePages.length, baselineByManifestKind: count(baseline.pages, 'kind'),
    baselineGuidePathMappings: count(sitePages.filter(p => p.manifestKind === 'guide'), 'mapping'),
    missingByType: count(missing, 'type'),
    missingActiveGuides: missing.filter(f => f.type === 'guide').map(f => f.sourcePath),
    missedExtensionlessContent: files.filter(f => f.extensionless && f.coverage === 'missing-from-baseline').map(f => f.sourcePath),
    authoredSupplementPages: authoredPages.length,
    unresolvedBaselineMappings: unresolved.length,
    duplicateBaselineTitles: duplicateTitles,
    distinctProposedSourceTitles: titleReservations.size
};
const manifest = {
    schemaVersion: 1, upstreamRepository: 'https://github.com/pvme/pvme-guides', upstreamRevision: revision,
    baselineSnapshotCommit: baseline.sourceCommit,
    inputs: [
        { path: 'wiki-host/corpus/manifest.json', sha256: digest(baselineFile) },
        { path: 'upstream/wiki-port/inventory.json', sha256: digest(path.join(upstream, 'wiki-port/inventory.json')) },
        { path: 'upstream/wiki-port/assembled-packets.json', sha256: digest(path.join(upstream, 'wiki-port/assembled-packets.json')) }
    ],
    cautions: [
        'PUBLICATION INVARIANT: presentation is additive only. Preserve every source word, its order, all gear/presets, rotations, notes, captions, warnings, links and media. No editorial rewrite is authorized.',
        'Every row remains unverified against the current official website. Imported/represented status NEVER establishes current website parity.',
        'Baseline representation means a source identity is imported, not that latest upstream text or editorial standards are verified.',
        'A packet is a prepared artifact, not evidence that a page was deployed.',
        'Existing corpus kind=guide includes an Alt1 config export, editor tutorials and community instructions.',
        'Archived, draft and command content remains distinct; do not count it as current boss guides.',
        'Renamed source identity is mapped explicitly; hashes/commits are not interchangeable.',
        'Source files and site pages are separate entities. Derived indexes are not duplicate source guides.',
        'No live wiki/API/browser inspected. Preserve existing community revisions when publishing.'
    ],
    aliases, summary, upstreamFiles: files, sitePages, authoredPages
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const columns = ['sourcePath', 'type', 'audience', 'title', 'coverage', 'targetTitle', 'titleMapping', 'inPreviousTxtInventory', 'sourceBlob', 'sourceRevision', 'rolloutStatus'];
fs.writeFileSync(path.join(out, 'source-coverage.csv'), [columns.join(','), ...files.map(f => columns.map(c => quote(f[c])).join(','))].join('\n') + '\n');
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
