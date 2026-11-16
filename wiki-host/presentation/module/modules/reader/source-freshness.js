'use strict';

/**
 * The badge that says how long ago the upstream PvME guide last changed.
 *
 * Dates come from a JSON feed published by the PvME reader site. The badge
 * reports source history only; it makes no claim that a guide is still
 * accurate in game.
 *
 * @typedef {Object} HistoryRecord one guide in the feed
 * @property {string} status 'upstream-content-change' when `date` is a real content edit
 * @property {string} date YYYY-MM-DD
 * @property {string} [commit] 40-character pvme-guides commit hash
 *
 * @typedef {Object} HistoryFeed
 * @property {1} schemaVersion
 * @property {Object<string, HistoryRecord>} guides keyed by pvme.io URL path
 *
 * @typedef {Object} Freshness what the badge shows
 * @property {'recent'|'known'|'older'|'unknown'} level
 * @property {string} label
 * @property {string} explanation
 * @property {string} href
 * @property {string} sourceDate YYYY-MM-DD, or '' when unverified
 */

const { el } = require('./dom.js');

const FEED_URL = 'https://pvme.sanji3.dev/data/guide-history.json';
const HISTORY_PAGE_URL = 'https://pvme.sanji3.dev/about/guide-history/';
const COMMIT_URL = 'https://github.com/pvme/pvme-guides/commit/';
const CACHE_KEY = 'pvme-guide-history-v1';
const CACHE_LIFETIME_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;
const REFRESH_INTERVAL_MS = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RECENT_WITHIN_DAYS = 30;
const OLDER_FROM_DAYS = 180;

const UNVERIFIED = {
    level: 'unknown',
    label: 'Source date unverified',
    explanation: 'No verified source-change date from pvme.sanji3.dev.',
    href: HISTORY_PAGE_URL,
    sourceDate: '',
};
const FEED_UNAVAILABLE = Object.assign({}, UNVERIFIED, {
    explanation: 'Could not load source history from pvme.sanji3.dev. Reload to try again.',
});

function isHistoryFeed(data) {
    return data?.schemaVersion === 1 && Boolean(data.guides) && typeof data.guides === 'object';
}

function readCachedFeed() {
    try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
        const age = Date.now() - cached.fetchedAt;
        if (age >= 0 && age < CACHE_LIFETIME_MS && isHistoryFeed(cached.data)) {
            return cached.data;
        }
    } catch (_) {
        // No cache, an unreadable cache, or storage disabled: fetch instead.
    }
    return null;
}

function cacheFeed(data) {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data }));
    } catch (_) {
        // The cache only saves a request; the badge works without it.
    }
}

async function fetchFeed() {
    const cached = readCachedFeed();
    if (cached) {
        return cached;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(FEED_URL, {
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error('Source history unavailable');
        }
        const data = await response.json();
        if (!isHistoryFeed(data)) {
            throw new Error('Invalid source history');
        }
        cacheFeed(data);
        return data;
    } finally {
        clearTimeout(timeout);
    }
}

function startOfUtcDay(isoDate) {
    return Date.parse(isoDate + 'T00:00:00Z');
}

/**
 * @param {HistoryRecord|undefined} record
 * @param {Date} now
 * @return {Freshness}
 */
function describeFreshness(record, now) {
    const date = record?.date;
    if (record?.status !== 'upstream-content-change' ||
        typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return UNVERIFIED;
    }
    const changedOn = startOfUtcDay(date);
    const isRealDate = Number.isFinite(changedOn) &&
        new Date(changedOn).toISOString().slice(0, 10) === date;
    const days = (startOfUtcDay(now.toISOString().slice(0, 10)) - changedOn) / MS_PER_DAY;
    if (!isRealDate || days < 0) {
        return UNVERIFIED;
    }

    let level = 'known';
    if (days <= RECENT_WITHIN_DAYS) {
        level = 'recent';
    } else if (days >= OLDER_FROM_DAYS) {
        level = 'older';
    }
    const hasCommit = /^[a-f\d]{40}$/i.test(record.commit || '');
    return {
        level,
        label: days + (days === 1 ? ' day' : ' days') + ' since source update',
        explanation: 'Last known PvME content change: ' + date +
            '. Source history, not game verification. Data from pvme.sanji3.dev.',
        href: hasCommit ? COMMIT_URL + record.commit : HISTORY_PAGE_URL,
        sourceDate: date,
    };
}

/**
 * @param {string} guideSourceUrl the guide's pvme.io URL
 * @return {HTMLAnchorElement} the badge; it fills itself in once the feed loads
 */
function createFreshnessBadge(guideSourceUrl) {
    const badge = el('a', 'pvme-freshness pvme-freshness-unknown', 'Checking source date…');
    badge.href = HISTORY_PAGE_URL;
    badge.setAttribute('aria-label', 'Source update history');

    /** @param {Freshness} freshness */
    const show = (freshness) => {
        badge.className = 'pvme-freshness pvme-freshness-' + freshness.level;
        badge.textContent = freshness.label;
        badge.title = freshness.explanation;
        badge.setAttribute('aria-label', freshness.label + '. ' + freshness.explanation);
        badge.href = freshness.href;
        badge.dataset.sourceDate = freshness.sourceDate;
    };

    fetchFeed().then((feed) => {
        const record = feed.guides[new URL(guideSourceUrl).pathname];
        show(describeFreshness(record, new Date()));
        // The day count changes at midnight UTC while the page stays open.
        const timer = setInterval(() => {
            if (!document.hidden) {
                show(describeFreshness(record, new Date()));
            }
        }, REFRESH_INTERVAL_MS);
        window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    }).catch(() => show(FEED_UNAVAILABLE));

    return badge;
}

module.exports = { createFreshnessBadge, describeFreshness };
