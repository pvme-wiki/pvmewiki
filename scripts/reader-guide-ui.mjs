import { guideAge, guideAgeDetail } from '../src/guide-age.mjs';

const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function guideAgeBadge(record, { overlay = false, now = new Date() } = {}) {
  const date = record && record.status !== 'unknown' && !overlay ? record.date : null;
  const age = guideAge(date, now);
  return `<div class="guide-update-age guide-update-age--${age.state}" data-guide-update-age${date ? ` data-guide-updated="${escape(date)}"` : ''}><span class="guide-age-icon" aria-hidden="true">${age.icon}</span><strong data-guide-age-label>${escape(age.label)}</strong><small data-guide-age-detail>${escape(guideAgeDetail(age))}</small></div>`;
}
