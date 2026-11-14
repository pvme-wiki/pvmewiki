const DAY = 86_400_000;

function utcDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value ? milliseconds : null;
}

// Inputs are source-history dates. Deployment/import timestamps never enter this calculation.
export function guideAge(date, now = new Date()) {
  const checked = new Date(now);
  if (!Number.isFinite(checked.getTime())) return { state: 'unknown', days: null, asOf: null, label: 'Update age unverified', icon: '?' };
  const asOf = checked.toISOString().slice(0, 10);
  const source = utcDay(date);
  if (source === null) return { state: 'unknown', days: null, asOf, label: 'Update age unverified', icon: '?' };
  const days = (utcDay(asOf) - source) / DAY;
  if (days < 0) return { state: 'unknown', days: null, asOf, label: 'Source date is in the future — age unverified', icon: '?' };
  return {
    state: days <= 30 ? 'recent' : days >= 180 ? 'older' : 'known', days, asOf,
    label: `${days} ${days === 1 ? 'day' : 'days'} since last update`,
    icon: days <= 30 ? '✦' : days >= 180 ? '◷' : '↻',
  };
}

export function guideAgeDetail(age) {
  return age.days === null
    ? 'No verified elapsed time · check the source history below.'
    : `As of ${age.asOf} UTC · source history, not game verification.`;
}
