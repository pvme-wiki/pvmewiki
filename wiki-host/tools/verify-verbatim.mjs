/**
 * Regenerates every local receipt for the verbatim guarantee and prints them as
 * one table: what was compared at each link of the chain, how many, how many
 * were identical, and the deliberate deviations. Needs no network.
 *
 * Usage: node wiki-host/tools/verify-verbatim.mjs     (after `npm ci` in wiki-host/)
 *
 * Reads: current-source/, main-guides/, preset-previews/manifest.json and
 *     presentation/module/modules/; runs tools/verify-corpus.mjs,
 *     `node --test tests/verbatim-reader.test.mjs` and, when `php` is on the PATH,
 *     tests/runtime-main-guide-publication.php; reads the newest
 *     docs/receipts/live-verbatim-*.json for the live rows, which it does not
 *     re-measure (tools/measure-live-verbatim.mjs does that).
 * Writes: docs/receipts/verbatim-local.json. It holds no timestamps, so an
 *     unchanged repository reproduces it byte for byte.
 * Exits with code 1 when any local link shows a difference.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HOST_DIR, readJson, writeJson } from './lib/files.mjs';
import { checkCapture, checkCompile, checkExport, loadCorpus } from './lib/verbatim-checks.mjs';

const RECEIPTS_DIR = path.join(HOST_DIR, 'docs/receipts');
const REPORT_FILE = path.join(RECEIPTS_DIR, 'verbatim-local.json');

/**
 * Runs a command from wiki-host/ and reports whether it exited with 0.
 * @returns {{passed: boolean, output: string}}
 */
function run(command, args) {
    try {
        const output = execFileSync(command, args, {
            cwd: HOST_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { passed: true, output };
    } catch (error) {
        return { passed: false, output: (error.stdout || '') + (error.stderr || error.message) };
    }
}

/** A count from the summary that `node --test --test-reporter=tap` prints last. */
function testCount(output, label) {
    return Number(output.match(new RegExp('# ' + label + ' (\\d+)'))?.[1]);
}

function seedCorpusReceipt() {
    const { passed, output } = run(process.execPath, ['tools/verify-corpus.mjs']);
    const summary = passed ? JSON.parse(output.trim().split('\n').at(-1)) : null;
    return { passed, summary, error: passed ? null : output.slice(0, 2000) };
}

function readerReceipt() {
    const { passed, output } = run(process.execPath, ['--test', '--test-reporter=tap',
        'tests/verbatim-reader.test.mjs']);
    return { passed, tests: testCount(output, 'tests'), failed: testCount(output, 'fail') };
}

function publicationReceipt() {
    if (!run('php', ['--version']).passed) {
        return { passed: null, cases: 0, note: 'php not found; not run' };
    }
    const { passed, output } = run('php', ['tests/runtime-main-guide-publication.php']);
    const cases = Number(output.match(/(\d+) cases passed/)?.[1] ?? 0);
    return { passed, cases, output: output.trim() };
}

/** The newest dated live measurement, or null when none has been made. */
function latestLiveReport() {
    const files = fs.existsSync(RECEIPTS_DIR)
        ? fs.readdirSync(RECEIPTS_DIR).filter((name) => /^live-verbatim-.*\.json$/.test(name))
        : [];
    const newest = files.sort().at(-1);
    if (!newest) {
        return null;
    }
    return { file: 'docs/receipts/' + newest, ...readJson(path.join(RECEIPTS_DIR, newest)) };
}

/** One printed row per link of the chain. */
function rows(receipts, live) {
    const { capture, compile, exported, seedCorpus, reader, publication } = receipts;
    const deviations = compile.deviations;
    const result = [
        ['1 pvme.io capture', 'local', 'saved bytes against recorded hashes and offsets',
            capture.checked, capture.consistent,
            'cannot be re-proven against pvme.io without a new capture'],
        ['2 capture to wiki page', 'local', 'text, media and links, in order, exactly',
            compile.checked, compile.identical,
            deviations.renderCopies.length + ' hand-checked render copies; ' +
            deviations.inactiveLinks.count + ' links without address kept as words; ' +
            deviations.additions.count + ' preset pictures added; attribution line'],
    ];
    if (live) {
        const saved = live.savedRevisions;
        const rendered = live.renderedPages;
        result.push(
            ['3 packaged to live wiki', 'live ' + live.measured.slice(0, 10),
                'saved revision against packaged file', saved.checked, saved.identical,
                saved.changed + ' changed on the wiki, ' + saved.missing + ' missing'],
            ['4 saved to rendered', 'live ' + live.measured.slice(0, 10),
                'rendered words, media, links against the revision', rendered.checked,
                rendered.identical, 'open finding: ' + rendered.nonBreakingSpaces.count +
                ' spaces made non-breaking by the parser in ' +
                rendered.nonBreakingSpaces.guides + ' guides; ' + rendered.unexplained.length +
                ' unexplained'],
        );
    } else {
        result.push(['3 and 4 live wiki', 'live', 'not measured yet', 0, 0,
            'run tools/measure-live-verbatim.mjs']);
    }
    result.push(
        ['5 reader script', 'npm test', 'article before and after the reader, in jsdom',
            reader.tests, reader.tests - reader.failed,
            'tests cover all 329 captured guides and 3 seed index pages' + (live
                ? '; live: ' + live.reader.guidesUnchanged + ' of ' + live.reader.guides +
                ' rendered guides unchanged'
                : '')],
        ['6 Copy to wiki export', 'local', 'every guide passage once, in order',
            exported.checked, exported.identical, exported.spans + ' passages compared'],
        ['7 redeploys keep edits', 'php test', 'publication decision cases',
            publication.cases, publication.passed ? publication.cases : 0,
            publication.note ?? ''],
        ['8 seed corpus', 'local', 'frozen pages against pinned hashes',
            seedCorpus.summary?.pages ?? 0, seedCorpus.passed ? seedCorpus.summary.pages : 0,
            'code blocks compared to snapshot; prose not compared'],
    );
    return result;
}

function printTable(table) {
    const header = ['link', 'kind', 'compared', 'checked', 'identical', 'notes'];
    const widths = header.map((name, column) => Math.max(name.length,
        ...table.map((row) => String(row[column]).length)));
    const line = (cells) => cells.map((cell, column) => String(cell).padEnd(widths[column]))
        .join('  ').trimEnd();
    console.log(line(header));
    console.log(line(widths.map((width) => '-'.repeat(width))));
    table.forEach((row) => console.log(line(row)));
}

function main() {
    const corpus = loadCorpus();
    const receipts = {
        capture: checkCapture(corpus),
        compile: checkCompile(corpus),
        exported: checkExport(corpus),
        seedCorpus: seedCorpusReceipt(),
        reader: readerReceipt(),
        publication: publicationReceipt(),
    };
    const live = latestLiveReport();
    printTable(rows(receipts, live));
    fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
    writeJson(REPORT_FILE, {
        command: 'node wiki-host/tools/verify-verbatim.mjs',
        textComparison: 'exact: no whitespace, case, punctuation or Unicode normalisation',
        ...receipts,
        liveReport: live?.file ?? null,
    });
    console.log('\nWrote ' + path.relative(HOST_DIR, REPORT_FILE));
    const failed = receipts.capture.problems.length ||
        receipts.compile.identical !== receipts.compile.checked ||
        receipts.exported.differences.length || !receipts.seedCorpus.passed ||
        !receipts.reader.passed || receipts.publication.passed === false;
    if (failed) {
        process.exitCode = 1;
    }
}

main();
