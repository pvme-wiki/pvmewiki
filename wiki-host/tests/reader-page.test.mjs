/** Looking pages up in the navigation registry. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { requireModule } from './support/modules.mjs';
import { REGISTRY } from './fixtures/registry.mjs';

const { findPage, siblingGuides } = requireModule('reader/page.js');

test.describe('findPage', () => {
    test('a page that is not in the registry is not a reader page', () => {
        assert.equal(findPage(REGISTRY, 'Main Page'), null);
    });

    test('a guide displays its own content', () => {
        const page = findPage(REGISTRY, 'PvME/Vorago/Hard mode');
        assert.equal(page.title, 'PvME/Vorago/Hard mode');
        assert.equal(page.guideTitle, 'PvME/Vorago/Hard mode');
        assert.equal(page.guide, REGISTRY.pages['PvME/Vorago/Hard mode']);
        assert.equal(page.isLanding, false);
    });

    test('a boss landing page displays its overview guide', () => {
        const page = findPage(REGISTRY, 'PvME/Vorago');
        assert.equal(page.entry, REGISTRY.pages['PvME/Vorago']);
        assert.equal(page.guideTitle, 'PvME/Vorago/Overview');
        assert.equal(page.guide, REGISTRY.pages['PvME/Vorago/Overview']);
        assert.equal(page.isLanding, true);
    });

    test('a landing page whose overview is missing from the registry ' +
        'falls back to its own entry', () => {
        const landing = { parents: [], children: [], overview: 'PvME/Telos/Gone' };
        const registry = { pages: { 'PvME/Telos': landing } };
        const page = findPage(registry, 'PvME/Telos');
        assert.equal(page.guideTitle, 'PvME/Telos/Gone');
        assert.equal(page.guide, landing);
    });
});

test.describe('siblingGuides', () => {
    const siblingsOf = (title) => siblingGuides(REGISTRY, findPage(REGISTRY, title));

    test('a guide under a boss lists the boss\'s other guides, without itself', () => {
        assert.deepEqual(
            siblingsOf('PvME/Vorago/Hard mode'),
            ['PvME/Vorago/Overview', 'PvME/Vorago/Normal mode']
        );
    });

    test('children of the boss that are not guides are not listed', () => {
        assert.ok(!siblingsOf('PvME/Vorago/Hard mode').includes('PvME/Vorago/Archive'));
    });

    test('a page without a source is not a guide and has no siblings', () => {
        assert.deepEqual(siblingsOf('PvME/Vorago'), []);
        assert.deepEqual(siblingsOf('PvME'), []);
    });

    test('a guide with no boss index among its ancestors has no siblings', () => {
        assert.deepEqual(siblingsOf('PvME/Lower-effort methods/AFK Blood Reavers'), []);
    });

    test('the nearest boss index among the ancestors is the one used', () => {
        const guide = (parents, slug) =>
            ({ parents, children: [], source: 'https://pvme.io/' + slug });
        const registry = {
            pages: {
                Outer: { parents: [], children: ['Outer/A', 'Outer/Inner'], kind: 'boss-index' },
                'Outer/Inner': {
                    parents: ['Outer'],
                    children: ['Outer/Inner/B', 'Outer/Inner/C'],
                    kind: 'boss-index',
                },
                'Outer/A': guide(['Outer'], 'a/'),
                'Outer/Inner/B': guide(['Outer', 'Outer/Inner'], 'b/'),
                'Outer/Inner/C': guide(['Outer', 'Outer/Inner'], 'c/'),
            },
        };
        const page = findPage(registry, 'Outer/Inner/B');
        assert.deepEqual(siblingGuides(registry, page), ['Outer/Inner/C']);
    });
});
