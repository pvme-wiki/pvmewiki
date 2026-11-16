/**
 * Questions about entries of main-guides/corpus-plan.json shared by the tools
 * that read the plan.
 */

/** pvme.io path prefix of guide articles; the plan also holds about pages. */
const GUIDE_PATH_PREFIX = '/pvme-guides/';

/**
 * @param {{source: string}} page a plan page, or any record with its pvme.io source URL
 * @returns {boolean} whether the page is a guide article rather than site information
 * @throws {TypeError} when `source` is not an absolute URL
 */
export function isPvmeGuide(page) {
    return new URL(page.source).pathname.startsWith(GUIDE_PATH_PREFIX);
}
