'use strict';

// Source-bound enhancement of the current rendered revision. Never feeds the editor/export.
const assets = require('./amascut-assets.json');

function sequenceFragments(paragraph) {
    const doc = paragraph.ownerDocument;
    const walker = doc.createTreeWalker(paragraph, 4);
    const boundaries = [];
    while (walker.nextNode()) {
        const node = walker.currentNode;
        for (let i = 0; i < node.textContent.length; i++) {
            if (node.textContent[i] === '\u2192') boundaries.push({ node, offset: i });
        }
    }
    if (!boundaries.length) return [];
    const range = doc.createRange(); range.setStart(paragraph, 0);
    const fragments = [];
    for (const { node, offset } of boundaries) {
        range.setEnd(node, offset); fragments.push(range.cloneContents());
        range.setStart(node, offset + 1);
    }
    range.setEnd(paragraph, paragraph.childNodes.length); fragments.push(range.cloneContents());
    return fragments;
}

function enhanceAmascut(reader, title) {
    if (title !== assets.guide) return;
    const doc = reader.ownerDocument;
    // Exact source URLs only: community additions and unrelated external links stay unchanged.
    for (const anchor of reader.querySelectorAll('a[href]')) {
        const asset = assets.icons[anchor.getAttribute('href')];
        if (!asset) continue;
        const image = doc.createElement('img');
        image.src = asset.url; image.alt = ''; image.width = 32; image.height = 32;
        image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
        anchor.classList.add('pvme-ability-image');
        anchor.classList.remove('pvme-icon-fallback', 'pvme-visual-redundant-icon');
        anchor.dataset.pvmeLabel = asset.label;
        anchor.setAttribute('aria-label', anchor.dataset.pvmeLabel + ' (source image)');
        // The existing, always-visible accessible label survives image failures.
        anchor.prepend(image);
    }
    let inClimber = false;
    for (const node of Array.from(reader.children)) {
        if (/^H[23]$/.test(node.tagName)) inClimber = node.textContent.trim() === 'Climber Rotations';
        if (!inClimber || node.tagName !== 'P') continue;
        const style = node.querySelector('strong')?.textContent.trim();
        if (!/^(Necromancy|Melee)\b/.test(style || '')) continue;
        const fragments = sequenceFragments(node);
        if (!fragments.length) continue;
        const panel = doc.createElement('section'); panel.className = 'pvme-climber-panel';
        const heading = doc.createElement('h4');
        heading.textContent = style.match(/^(Necromancy|Melee)\b/)[1] + ' — climber sequence';
        const hint = doc.createElement('p'); hint.className = 'pvme-sequence-key';
        hint.textContent = 'Read numbered steps in order. + stays together in its source step; (tc), movement and click instructions are retained. Follow starting conditions in the current guide above.';
        const list = doc.createElement('ol'); list.className = 'pvme-climber-sequence'; list.setAttribute('role', 'list');
        fragments.forEach((fragment, index) => {
            const item = doc.createElement('li');
            if (fragment.querySelectorAll('.pvme-ability-image').length > 1 || fragment.textContent.includes('+') || fragment.textContent.length > 90) item.className = 'pvme-sequence-group';
            const number = doc.createElement('span'); number.className = 'pvme-sequence-number';
            number.textContent = String(index + 1); number.setAttribute('aria-hidden', 'true');
            const body = doc.createElement('div'); body.append(fragment);
            item.append(number, body); list.append(item);
        });
        const original = doc.createElement('details'), summary = doc.createElement('summary');
        summary.textContent = 'Continuous source wording'; original.append(summary, node.cloneNode(true));
        panel.append(heading, hint, list, original); node.replaceWith(panel);
    }
    const presetInsertions = new Map();
    for (const anchor of reader.querySelectorAll('a[href]')) {
        const preset = assets.presets[anchor.getAttribute('href')];
        if (!preset) continue;
        const figure = doc.createElement('figure'); figure.className = 'pvme-amascut-preset';
        const caption = doc.createElement('figcaption'); caption.textContent = preset.label;
        const image = doc.createElement('img'); image.src = preset.image;
        image.alt = preset.alt; image.width = 944; image.height = 512;
        image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
        const viewport = doc.createElement('div'); viewport.className = 'pvme-preset-image-viewport';
        viewport.tabIndex = 0; viewport.setAttribute('aria-label', preset.label + ' image; enlarge to inspect slots');
        viewport.append(image);
        const zoom = doc.createElement('button'); zoom.type = 'button'; zoom.textContent = 'Enlarge preset';
        zoom.setAttribute('aria-expanded', 'false');
        zoom.addEventListener('click', () => {
            const enlarged = viewport.classList.toggle('pvme-image-enlarged');
            zoom.setAttribute('aria-expanded', String(enlarged));
            zoom.textContent = enlarged ? 'Fit preset to page' : 'Enlarge preset';
        });
        const note = doc.createElement('p');
        const source = doc.createElement('a'); source.href = anchor.getAttribute('href');
        source.textContent = 'Open original preset and full item notes';
        note.append(source, doc.createTextNode('. Published PvME preset-maker image, checked ' + assets.checked + '. Enlarge and scroll to inspect; source requirements and alternatives still apply.'));
        const failure = doc.createElement('p'); failure.hidden = true;
        failure.textContent = 'Preset image could not load. Use the original preset link and its item notes.';
        image.addEventListener('error', () => { failure.hidden = false; }, { once: true });
        const loadout = doc.createElement('div'); loadout.className = 'pvme-amascut-loadout';
        const equipmentHeading = doc.createElement('h5'); equipmentHeading.textContent = 'Equipment shown in the source preset';
        const equipment = doc.createElement('ul'); equipment.className = 'pvme-amascut-equipment';
        for (const name of preset.equipment) { const item = doc.createElement('li'); item.textContent = name; equipment.append(item); }
        const other = doc.createElement('p'); other.textContent = 'Other pictured selections: ' + preset.other.join('; ') + '.';
        const inventory = doc.createElement('details'), inventoryLabel = doc.createElement('summary');
        inventoryLabel.textContent = 'Inventory — all 28 source positions';
        const inventoryList = doc.createElement('ol');
        for (const slot of preset.inventory) { const item = doc.createElement('li'); item.textContent = slot.item; inventoryList.append(item); }
        inventory.append(inventoryLabel, inventoryList);
        const notes = doc.createElement('details'), notesLabel = doc.createElement('summary'), notesBody = doc.createElement('div');
        notesLabel.textContent = 'Alternatives, upgrades and source notes'; notesBody.className = 'pvme-preset-full-notes';
        notesBody.textContent = preset.notes.split('\n').filter(line => line.trim() !== 'Open on Wiki').join('\n');
        notes.append(notesLabel, notesBody);
        loadout.append(equipmentHeading, equipment, other, inventory, notes);
        const comparison = doc.createElement('div'); comparison.className = 'pvme-preset-comparison';
        const illustration = doc.createElement('div'); illustration.append(zoom, viewport, failure);
        comparison.append(illustration, loadout);
        figure.append(caption, comparison, note);
        const paragraph = anchor.closest('p');
        if (paragraph) {
            (presetInsertions.get(paragraph) || paragraph).after(figure);
            presetInsertions.set(paragraph, figure);
        }
    }
    // cloneContents does not copy event listeners; bind to the final disposable view.
    for (const image of reader.querySelectorAll('.pvme-ability-image img')) {
        image.addEventListener('error', () => image.remove(), { once: true });
    }
}

module.exports = { enhanceAmascut, sequenceFragments };
