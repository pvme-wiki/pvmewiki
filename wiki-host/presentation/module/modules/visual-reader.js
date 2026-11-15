'use strict';
const { enhanceAmascut } = require('./amascut-visuals.js');

function isDuplicateLabel(label, previousText) {
    const normalize = text => text.replace(/[\u200b-\u200f]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    return Boolean(label.trim()) && normalize(label) === normalize(previousText);
}

// A disposable reader view outside #mw-content-text. Native edit HTML is untouched.
function createVisualReader(article, title, presets, actionBars = {}) {
    const doc = article.ownerDocument;
    const reader = article.cloneNode(true);
    reader.classList.remove('mw-parser-output');
    reader.classList.add('pvme-visual-content');
    reader.id = 'pvme-visual-reader';
    reader.setAttribute('role', 'article');
    reader.setAttribute('aria-label', 'Visual guide reader');
    for (const icon of reader.querySelectorAll('a.pvme-icon-fallback')) {
        let previous = icon.previousSibling;
        while (previous?.nodeType === 3 && !previous.textContent.trim()) previous = previous.previousSibling;
        if (previous && isDuplicateLabel(icon.dataset.pvmeLabel || '', previous.textContent)) icon.classList.add('pvme-visual-redundant-icon');
    }
    const anchors = new Map();
    for (const node of reader.querySelectorAll('[id]')) {
        const original = node.id; node.id = 'pvme-visual-' + original; anchors.set(original, node.id);
    }
    // Keep every source line and qualification; source bullets determine grouping.
    for (const block of reader.querySelectorAll('div[style*="pre-line"]')) {
        if (block.querySelector('div,p,table,ul,ol') || !/[\u2b25\u2022]/.test(block.textContent)) continue;
        if (Array.from(block.children).some(node => node.textContent.includes('\n'))) continue;
        const lines = [[]];
        for (const node of block.childNodes) {
            if (node.nodeType !== 3) { lines.at(-1).push(node.cloneNode(true)); continue; }
            node.textContent.split('\n').forEach((text, index) => {
                if (index) lines.push([]);
                lines.at(-1).push(doc.createTextNode(text));
            });
        }
        const grid = doc.createElement('div'); grid.className = 'pvme-visual-list'; grid.setAttribute('role', 'list');
        let card;
        for (const line of lines) {
            const text = line.map(node => node.textContent).join('');
            if (!card || /^[\s\u200b-\u200f]*\u2b25/.test(text)) {
                card = doc.createElement('div'); card.className = 'pvme-visual-card'; card.setAttribute('role', 'listitem'); grid.append(card);
            }
            const row = doc.createElement('div'); row.className = /^[\s\u200b-\u200f]*\u2022/.test(text) ? 'pvme-visual-qualification' : 'pvme-visual-line';
            row.append(...line); card.append(row, doc.createTextNode('\n'));
        }
        for (const item of grid.children) {
            if (/ARE REQUIRED|Cutting corners will result in failure/.test(item.textContent)) item.classList.add('pvme-visual-warning');
            if (item.textContent.length > 220) item.classList.add('pvme-visual-long-card');
        }
        block.replaceChildren(grid); block.style.whiteSpace = 'normal';
    }
    for (const paragraph of reader.querySelectorAll('p')) {
        const code = paragraph.querySelector('code');
        if (!code) continue;
        const before = doc.createRange(); before.selectNodeContents(paragraph); before.setEndBefore(code);
        const after = doc.createRange(); after.selectNodeContents(paragraph); after.setStartAfter(code);
        if (!/^[\s\u200b-\u200f\u2b25\u2b29\u2022]*$/.test(before.toString()) || !/^\s*:/.test(after.toString())) continue;
        const table = doc.createElement('table'); table.className = 'pvme-visual-cue';
        const caption = doc.createElement('caption'); caption.textContent = 'Cue and response - source wording';
        const row = doc.createElement('tr'), cue = doc.createElement('th'), response = doc.createElement('td');
        cue.scope = 'row'; cue.append(before.cloneContents(), code.cloneNode(true)); response.append(after.cloneContents());
        row.append(cue, response); table.append(caption, row); paragraph.replaceWith(table);
    }
    for (const table of reader.querySelectorAll('table.pvme-visual-cue')) {
        let previous = table.previousElementSibling;
        while (previous?.tagName === 'P' && !previous.querySelector('[id],a,img') && !previous.textContent.replace(/[\s\u200b-\u200f]/g, '')) previous = previous.previousElementSibling;
        if (previous?.matches('table.pvme-visual-cue')) { previous.append(doc.createTextNode('\n'), ...Array.from(table.rows)); table.remove(); }
    }
    for (const anchor of reader.querySelectorAll('a[href]')) {
        const bar = actionBars[anchor.getAttribute('href')];
        if (!bar || bar.guide !== title) continue;
        const panel = doc.createElement('section'); panel.className = 'pvme-action-bar-panel';
        panel.setAttribute('aria-label', bar.label + ' numbered source order');
        const heading = doc.createElement('h4'); heading.textContent = bar.label + ' - source order 1–9';
        const list = doc.createElement('ol'); list.className = 'pvme-action-bar';
        for (const [index, name] of bar.slots.entries()) {
            const slot = doc.createElement('li');
            const number = doc.createElement('span'); number.className = 'pvme-action-number';
            number.textContent = String(index + 1); number.setAttribute('aria-hidden', 'true');
            const label = doc.createElement('strong'); label.textContent = name;
            slot.setAttribute('aria-label', 'Source slot ' + (index + 1) + ': ' + name);
            slot.append(number, label); list.append(slot);
        }
        const date = doc.createElement('p'); date.className = 'pvme-reader-provenance';
        date.textContent = 'Numbered left-to-right order from the source image added ' + bar.sourceAdded + '. Labels checked ' + bar.verified + '. Guide requirements are unchanged.';
        panel.append(heading, list, date); anchor.closest('p')?.after(panel);
    }
    for (const anchor of reader.querySelectorAll('a[href]')) {
        const preset = presets[anchor.getAttribute('href')];
        if (!preset || preset.guide !== title) continue;
        const panel = doc.createElement('section'); panel.className = 'pvme-preset-panel';
        const heading = doc.createElement('h4'); heading.textContent = preset.name + ' - linked preset'; panel.append(heading);
        const provenance = doc.createElement('p');
        provenance.textContent = 'Source preset captured ' + preset.captured + '. Labels and positions come from that preset; tiles reflow on phones. Follow the guide requirements and notes below.';
        panel.append(provenance);
        for (const kind of ['equipment', 'inventory']) {
            const slots = preset.slots.filter(slot => slot.kind === kind);
            const xs = [...new Set(slots.map(slot => slot.x))].sort((a, b) => a - b);
            const ys = [...new Set(slots.map(slot => slot.y))].sort((a, b) => a - b);
            const name = doc.createElement('h5'); name.textContent = kind === 'equipment' ? 'Equipment' : 'Inventory'; panel.append(name);
            const grid = doc.createElement('ol'); grid.className = 'pvme-preset-grid pvme-preset-' + kind;
            grid.setAttribute('aria-label', name.textContent + ' source positions');
            for (const slot of slots) {
                const cell = doc.createElement('li');
                const position = doc.createElement('small'); position.textContent = 'R' + (ys.indexOf(slot.y) + 1) + ' C' + (xs.indexOf(slot.x) + 1);
                const item = doc.createElement('strong'); item.textContent = slot.item || 'Empty';
                cell.className = slot.item ? 'pvme-preset-filled' : 'pvme-preset-empty';
                cell.append(position, item); grid.append(cell);
            }
            const itemNotes = doc.createElement('div'); itemNotes.className = 'pvme-preset-item-notes';
            for (const note of preset.notes.filter(note => note.item && slots.some(slot => slot.item === note.item))) {
                const detail = doc.createElement('p'); detail.className = 'pvme-preset-note';
                const label = doc.createElement('strong'); label.textContent = note.item + ': ';
                detail.append(label, doc.createTextNode(note.text)); itemNotes.append(detail);
            }
            if (kind === 'inventory') {
                const inventory = doc.createElement('details'), summary = doc.createElement('summary');
                summary.textContent = 'Inventory - ' + slots.filter(slot => slot.item).length + ' filled source positions';
                inventory.append(summary, grid, itemNotes); panel.append(inventory);
            } else panel.append(grid, itemNotes);
        }
        for (const note of preset.notes.filter(note => note.item === null)) { const p = doc.createElement('p'); p.textContent = note.text; panel.append(p); }
        anchor.closest('p')?.after(panel);
    }
    enhanceAmascut(reader, title);
    return { reader, anchors };
}
module.exports = { createVisualReader, isDuplicateLabel };
