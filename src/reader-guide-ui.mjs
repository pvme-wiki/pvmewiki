import { guideAge, guideAgeDetail } from './guide-age.mjs';

const PREFERENCE = 'pvme-guide-edit-collapsed';

export function enhanceReaderGuideUI({ document, storage, now = () => new Date(), schedule = setInterval, cancel = clearInterval } = {}) {
  if (!document) return () => {};
  if (document.querySelector('.reader-edit-dock')) return () => {};
  const badge = document.querySelector('[data-guide-update-age]');
  const refreshAge = () => {
    if (!badge || document.hidden) return;
    const age = guideAge(badge.dataset.guideUpdated, now());
    badge.className = `guide-update-age guide-update-age--${age.state}`;
    badge.querySelector('[data-guide-age-label]').textContent = age.label;
    badge.querySelector('[data-guide-age-detail]').textContent = guideAgeDetail(age);
    badge.querySelector('.guide-age-icon').textContent = age.icon;
  };
  refreshAge();
  document.addEventListener('visibilitychange', refreshAge);
  const timer = badge ? schedule(refreshAge, 60_000) : null;
  const anchor = document.querySelector('.reader-edit-slot > .suggest-edit');
  let dock, collapse, restore;
  if (anchor && !document.querySelector('.reader-edit-dock')) {
    const slot = anchor.parentElement;
    // The same anchor is moved; its no-JS in-flow fallback is never cloned.
    slot.style.minHeight = `${Math.ceil(anchor.getBoundingClientRect().height)}px`;
    dock = document.createElement('aside');
    dock.className = 'reader-edit-dock';
    dock.setAttribute('aria-label', 'Guide editing');
    collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'reader-edit-collapse';
    collapse.textContent = 'Hide edit action';
    collapse.setAttribute('aria-label', 'Collapse guide edit action');
    restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'reader-edit-restore';
    restore.textContent = '✎ Edit';
    restore.setAttribute('aria-label', 'Restore guide edit action');
    const setCollapsed = (collapsed, { focus = false, persist = false } = {}) => {
      anchor.hidden = collapsed;
      collapse.hidden = collapsed;
      restore.hidden = !collapsed;
      dock.classList.toggle('is-collapsed', collapsed);
      document.body.classList.toggle('reader-edit-collapsed', collapsed);
      if (persist) { try { storage?.setItem(PREFERENCE, collapsed ? '1' : '0'); } catch {} }
      if (focus) (collapsed ? restore : anchor).focus();
    };
    let collapsed = false;
    try { collapsed = storage?.getItem(PREFERENCE) === '1'; } catch {}
    collapse.addEventListener('click', () => setCollapsed(true, { focus: true, persist: true }));
    restore.addEventListener('click', () => setCollapsed(false, { focus: true, persist: true }));
    dock.append(anchor, collapse, restore);
    document.body.append(dock);
    document.body.classList.add('reader-edit-enhanced');
    setCollapsed(collapsed);
  }
  return () => {
    document.removeEventListener('visibilitychange', refreshAge);
    if (timer !== null) cancel(timer);
    // Cleanup leaves the original action available in its original document position.
    if (dock) {
      const slot = document.querySelector('.reader-edit-slot');
      if (slot) { slot.append(anchor); slot.style.minHeight = ''; }
      anchor.hidden = false;
      dock.remove();
      document.body.classList.remove('reader-edit-enhanced', 'reader-edit-collapsed');
    }
  };
}

if (typeof document !== 'undefined') {
  let storage;
  try { storage = window.localStorage; } catch {}
  enhanceReaderGuideUI({ document, storage });
}
