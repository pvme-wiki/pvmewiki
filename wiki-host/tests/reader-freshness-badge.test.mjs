/** The freshness badge in the guide toolbar, fed by the guide-history feed. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openReaderPage } from './support/browser.mjs';
import { REGISTRY } from './fixtures/registry.mjs';

const FEED_KEY = '/pvme-guides/vorago/hard-mode/';
const COMMIT = 'f'.repeat(40);
const HISTORY_PAGE = 'https://pvme.sanji3.dev/about/guide-history/';
const FEED_UNAVAILABLE = 'Could not load source history from pvme.sanji3.dev. Reload to try again.';

function utcDateDaysAgo(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
}

async function badgeFor(t, feed) {
    const page = await openReaderPage({
        title: 'PvME/Vorago/Hard mode',
        article: '<div class="pvme-exact-guide"></div>',
        registry: REGISTRY,
        feed,
    });
    t.after(page.close);
    return page.document.querySelector('#pvme-reader-tools .pvme-freshness');
}

test('a guide with a recent upstream change shows its age and links to the commit', async (t) => {
    const date = utcDateDaysAgo(3);
    const badge = await badgeFor(t, {
        schemaVersion: 1,
        guides: { [FEED_KEY]: { status: 'upstream-content-change', date, commit: COMMIT } },
    });
    assert.equal(badge.textContent, '3 days since source update');
    assert.equal(badge.className, 'pvme-freshness pvme-freshness-recent');
    assert.equal(badge.href, 'https://github.com/pvme/pvme-guides/commit/' + COMMIT);
    assert.equal(badge.dataset.sourceDate, date);
});

test('a guide the feed does not list shows "Source date unverified"', async (t) => {
    const badge = await badgeFor(t, { schemaVersion: 1, guides: {} });
    assert.equal(badge.textContent, 'Source date unverified');
    assert.equal(badge.title, 'No verified source-change date from pvme.sanji3.dev.');
    assert.equal(badge.href, HISTORY_PAGE);
});

test('when the feed cannot be loaded, the badge says so and suggests reloading', async (t) => {
    const badge = await badgeFor(t, null);
    assert.equal(badge.textContent, 'Source date unverified');
    assert.equal(badge.title, FEED_UNAVAILABLE);
});

test('a feed with an unknown schema version is treated as unavailable', async (t) => {
    const badge = await badgeFor(t, { schemaVersion: 2, guides: {} });
    assert.equal(badge.title, FEED_UNAVAILABLE);
});
