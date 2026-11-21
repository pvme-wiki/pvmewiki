const copy = document.querySelector('#copy');
const source = document.querySelector('#source');
const wikitext = document.querySelector('#wikitext');
const status = document.querySelector('#copy-status');

copy.hidden = false;
copy.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(wikitext.value);
        status.textContent = 'wikitext copied. paste it into the RuneScape Wiki source editor and choose show preview.';
    } catch {
        source.open = true;
        wikitext.focus();
        wikitext.select();
        status.textContent = 'clipboard unavailable. copy the selected wikitext manually or download it.';
    }
});
