/**
 * Runs `handle` over `items` with at most `workerCount` calls in flight.
 * Items are started in order; each worker takes the next one when it finishes.
 *
 * @template T
 * @param {T[]} items
 * @param {number} workerCount
 * @param {function(T): Promise<void>} handle a rejection stops that worker and
 *     rejects the returned promise
 * @return {Promise<void>}
 */
export async function forEachConcurrently(items, workerCount, handle) {
    let next = 0;
    async function worker() {
        while (next < items.length) {
            await handle(items[next++]);
        }
    }
    await Promise.all(Array.from({ length: workerCount }, worker));
}
