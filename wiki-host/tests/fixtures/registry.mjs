/**
 * A hand-written navigation registry in the shape of
 * presentation/module/modules/navigation.json, small enough to read whole.
 *
 * PvME                              seed-era hub index
 *   PvME/Vorago                     boss landing page showing its Overview
 *     PvME/Vorago/Overview          guide
 *     PvME/Vorago/Normal mode       guide
 *     PvME/Vorago/Hard mode         guide
 *     PvME/Vorago/Archive           index with 12 children
 *   PvME/Lower-effort methods       index with 14 children
 *     .../AFK Blood Reavers         guide with no boss index above it
 */

const guide = (parents, slug, extra = {}) => ({
    parents,
    children: [],
    source: 'https://pvme.io/pvme-guides/' + slug + '/',
    retrieved: '2026-11-15',
    nativeLayout: true,
    ...extra,
});

const LOWER_EFFORT_CHILDREN = [
    'AFK Blood Reavers', 'AFK Arch Glacor', 'Croesus', 'Gate of Elidinis', 'Kerapac',
    'Nex', 'Raksha', 'Rasial', 'Sanctum', 'Solak', 'Telos', 'Vorkath', 'Zamorak', 'Zuk',
].map((name) => 'PvME/Lower-effort methods/' + name);

// Twelve is the most pages a directory opens with.
const ARCHIVE_CHILDREN =
    Array.from({ length: 12 }, (_, index) => 'PvME/Vorago/Archive/' + (2014 + index));

export const REGISTRY = {
    pages: {
        PvME: {
            parents: [],
            children: ['PvME/Vorago', 'PvME/Lower-effort methods'],
        },
        'PvME/Vorago': {
            parents: ['PvME'],
            children: ['PvME/Vorago/Overview', 'PvME/Vorago/Normal mode', 'PvME/Vorago/Hard mode',
                'PvME/Vorago/Archive'],
            kind: 'boss-index',
            overview: 'PvME/Vorago/Overview',
            nativeLayout: true,
        },
        'PvME/Vorago/Overview': guide(['PvME', 'PvME/Vorago'], 'vorago/overview'),
        'PvME/Vorago/Normal mode': guide(['PvME', 'PvME/Vorago'], 'vorago/normal-mode'),
        'PvME/Vorago/Hard mode': guide(['PvME', 'PvME/Vorago'], 'vorago/hard-mode', {
            date: '2026-03-28',
            historyUrl: 'https://github.com/pvme/pvme-guides/commit/' + 'c'.repeat(40),
            nativeTitle: 'Vorago Hard Mode',
        }),
        'PvME/Vorago/Archive': {
            parents: ['PvME', 'PvME/Vorago'],
            children: ARCHIVE_CHILDREN,
            nativeLayout: true,
        },
        'PvME/Lower-effort methods': {
            parents: ['PvME'],
            children: LOWER_EFFORT_CHILDREN,
            nativeLayout: true,
        },
        'PvME/Lower-effort methods/AFK Blood Reavers':
            guide(['PvME', 'PvME/Lower-effort methods'], 'afk/afk-blood-reavers'),
    },
    labels: { '535533833215098890': 'Surge' },
};
