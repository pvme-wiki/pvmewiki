// Shared exact public message contract. No editor document or account data enters it.
export const FEEDBACK_CATEGORIES = Object.freeze({ bug:'Site problem', navigation:'Navigation', accessibility:'Accessibility', idea:'Suggestion' });
export const FEEDBACK_MESSAGE_LIMIT = 600;
export function feedbackMessage(category, context, message) {
  return `PvME website feedback\nCategory: ${FEEDBACK_CATEGORIES[category]}\nPage: ${context}\n\n${message.trim()}`;
}
export function feedbackTextError(message) {
  if (typeof message!=='string' || message.trim().length<5 || message.trim().length>FEEDBACK_MESSAGE_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(message) || !message.isWellFormed()) return 'Write 5–600 characters of plain feedback.';
  if (/@|[a-z][a-z0-9+.-]*:\/\/|www\.|discord\.(?:gg|com)|mailto:|\b\d{7,}\b|\+?\d[\d ()-]{7,}\d/i.test(message)) return 'Remove contact details, links, mentions and account IDs before posting.';
  return '';
}
