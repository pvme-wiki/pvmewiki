import { forEachConcurrently } from './concurrency.mjs';

const WORKERS = 6;
const TIMEOUT_MS = 30000;

/**
 * @typedef {Object} ImageCheck
 * @property {boolean} passed the URL answered 2xx with an image/* content type
 * @property {number} [status]
 * @property {string|null} [type] the Content-Type header
 * @property {string} [checked] ISO time of the check
 * @property {string} [error] the network error when there was no response
 */

/**
 * Sends one HEAD request per URL not already in `checks` and records the result
 * there. Earlier results are kept, so a rerun only checks new URLs.
 *
 * @param {string[]} urls
 * @param {Object<string, ImageCheck>} checks updated in place
 * @return {Promise<void>}
 */
export async function checkImageUrls(urls, checks) {
    await forEachConcurrently(urls, WORKERS, async (url) => {
        if (checks[url]) {
            return;
        }
        try {
            const response = await fetch(url, {
                method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            const type = response.headers.get('content-type');
            checks[url] = {
                status: response.status,
                type,
                passed: response.ok && !!type?.startsWith('image/'),
                checked: new Date().toISOString(),
            };
        } catch (error) {
            checks[url] = { passed: false, error: error.message };
        }
    });
}
