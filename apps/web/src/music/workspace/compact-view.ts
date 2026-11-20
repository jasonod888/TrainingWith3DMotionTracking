/**
 * Shared compact-view preference for piano review and practice.
 *
 * The preference is presentation-only; it never dirties a document or reloads a
 * reference. Both Engines use the same key so switching Guide/Sheet in practice keeps
 * the review workspace's chosen layout.
 */
export const COMPACT_VIEW_STORAGE = 'piano-review-compact-view-v1';

export type CompactView = 'guide' | 'sheet';

export function readCompactView(): CompactView {
  try {
    if (typeof globalThis.localStorage === 'undefined') return 'guide';
    return globalThis.localStorage.getItem(COMPACT_VIEW_STORAGE) === 'sheet' ? 'sheet' : 'guide';
  } catch {
    return 'guide';
  }
}

export function writeCompactView(view: CompactView): void {
  try {
    globalThis.localStorage?.setItem(COMPACT_VIEW_STORAGE, view);
  } catch { /* UI preference only */ }
}
