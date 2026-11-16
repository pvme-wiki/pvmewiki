/**
 * Read-only calls to the production wiki's API. Requests are POSTs because
 * parse requests carry whole guides; no caller uses an action that edits.
 */
export const WIKI_API = 'https://pvmewiki.sanji3.dev/api.php';
export const WIKI_INDEX = 'https://pvmewiki.sanji3.dev/index.php';

export const TITLES_PER_QUERY = 20;
const TIMEOUT_MS = 90000;

/**
 * @param {Object<string, string>} params API parameters, without `format`
 * @return {Promise<Object>} the decoded JSON body
 * @throws {Error} "Wiki API HTTP <status>" or the API's own error message
 */
export async function callWikiApi(params) {
    const response = await fetch(WIKI_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...params, format: 'json', formatversion: '2' }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error('Wiki API HTTP ' + response.status);
    }
    const data = await response.json();
    if (data.error) {
        throw new Error(data.error.info);
    }
    return data;
}

/**
 * The latest revision of each title, with its wikitext.
 *
 * @param {string[]} titles at most TITLES_PER_QUERY
 * @return {Promise<Object[]>} API page records: `{title, missing}` or
 *     `{title, revisions: [{revid, timestamp, user, comment, slots: {main: {content}}}]}`
 */
export async function latestRevisions(titles) {
    const data = await callWikiApi({
        action: 'query',
        prop: 'revisions',
        rvprop: 'ids|timestamp|user|comment|content',
        rvslots: 'main',
        titles: titles.join('|'),
    });
    return data.query.pages;
}

/** The permanent link to one saved revision. */
export function permalink(title, revisionId) {
    return WIKI_INDEX + '?title=' + encodeURIComponent(title) + '&oldid=' + revisionId;
}
