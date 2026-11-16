/** What the freshness badge says about one record of the guide-history feed. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { requireModule } from './support/modules.mjs';

const { describeFreshness } = requireModule('reader/source-freshness.js');

const NOW = new Date('2026-11-16T15:30:00Z');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const COMMIT_URL = 'https://github.com/pvme/pvme-guides/commit/' + COMMIT;
const HISTORY_PAGE = 'https://pvme.sanji3.dev/about/guide-history/';
const CHANGED = 'upstream-content-change';

const UNVERIFIED = {
    level: 'unknown',
    label: 'Source date unverified',
    explanation: 'No verified source-change date from pvme.sanji3.dev.',
    href: HISTORY_PAGE,
    sourceDate: '',
};

/** The UTC calendar date `days` before NOW, as YYYY-MM-DD. */
function daysBeforeNow(days) {
    const date = new Date(NOW);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
}

function changedDaysAgo(days, extra = {}) {
    const record = { status: CHANGED, date: daysBeforeNow(days), commit: COMMIT, ...extra };
    return describeFreshness(record, NOW);
}

test.describe('age boundaries', () => {
    for (const [days, level, label] of [
        [0, 'recent', '0 days since source update'],
        [1, 'recent', '1 day since source update'],
        [30, 'recent', '30 days since source update'],
        [31, 'known', '31 days since source update'],
        [179, 'known', '179 days since source update'],
        [180, 'older', '180 days since source update'],
    ]) {
        test('a change ' + days + ' days ago is "' + level + '": "' + label + '"', () => {
            const freshness = changedDaysAgo(days);
            assert.equal(freshness.level, level);
            assert.equal(freshness.label, label);
        });
    }

    test('days are counted in whole UTC calendar days, not 24-hour periods', () => {
        const beforeMidnight = new Date('2026-11-16T23:59:59Z');
        const yesterday = { status: CHANGED, date: '2026-11-15' };
        const { label } = describeFreshness(yesterday, beforeMidnight);
        assert.equal(label, '1 day since source update');
    });
});

test.describe('a verified change', () => {
    test('explains that the date is source history, not game verification', () => {
        const freshness = changedDaysAgo(3);
        assert.equal(freshness.explanation, 'Last known PvME content change: ' + daysBeforeNow(3) +
            '. Source history, not game verification. Data from pvme.sanji3.dev.');
        assert.equal(freshness.sourceDate, daysBeforeNow(3));
    });

    test('links to the upstream commit when the record names one', () => {
        assert.equal(changedDaysAgo(3).href, COMMIT_URL);
    });

    test('links to the history page when the commit is missing', () => {
        assert.equal(changedDaysAgo(3, { commit: undefined }).href, HISTORY_PAGE);
    });

    test('links to the history page when the commit is not a 40-character hash', () => {
        assert.equal(changedDaysAgo(3, { commit: 'abc123' }).href, HISTORY_PAGE);
    });
});

test.describe('records that are not a verified change', () => {
    for (const [description, record] of [
        ['a missing record', undefined],
        ['a status other than upstream-content-change',
            { status: 'import-only', date: '2026-11-01' }],
        ['a missing date', { status: CHANGED }],
        ['a date not in YYYY-MM-DD form', { status: CHANGED, date: '2026-11-1' }],
        ['a calendar date that does not exist', { status: CHANGED, date: '2026-02-30' }],
        ['a date in the future', { status: CHANGED, date: '2026-11-17' }],
    ]) {
        test(description + ' is shown as "Source date unverified"', () => {
            assert.deepEqual(describeFreshness(record, NOW), UNVERIFIED);
        });
    }
});
