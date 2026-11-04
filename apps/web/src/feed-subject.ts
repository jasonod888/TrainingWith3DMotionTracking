/**
 * Feed subject selection, extracted so the gating and pagination rules are testable
 * without a DOM.
 *
 * Rules:
 * - The filter only exists when there are at least two subjects to choose between.
 * - A hidden filter never filters: a selection that is no longer offered resolves to
 *   `all`, so deleting or relabelling the selected subject cannot empty the feed.
 * - Public results are filtered by the server, in the query, before pagination; the
 *   page key carries the subject so switching subjects cannot reuse a stale page.
 */

export type SubjectCarrier = {
  lesson_id?: string;
  subject?: string | null;
  subject_label?: string | null;
};

export type SubjectOption = {id: string; label: string};

const UNKNOWN_SUBJECT = 'movement_other';

/** Union of subjects carried by the visible sources, first label wins. */
export function availableSubjects(...groups: SubjectCarrier[][]): SubjectOption[] {
  const seen = new Map<string, string>();
  for (const group of groups) {
    for (const item of group) {
      const id = item.subject;
      const label = item.subject_label;
      if (!id || !label || seen.has(id)) continue;
      seen.set(id, label);
    }
  }
  return [...seen].map(([id, label]) => ({id, label}));
}

/** `all` unless the selection is one of at least two real options. */
export function resolveSubject(selected: string, options: SubjectOption[]): string {
  if (options.length < 2) return 'all';
  return options.some(option => option.id === selected) ? selected : 'all';
}

export function subjectFor(rows: SubjectCarrier[], lessonId: string): string {
  return rows.find(row => row.lesson_id === lessonId)?.subject ?? UNKNOWN_SUBJECT;
}

export function matchesSubject(value: string | null | undefined, active: string): boolean {
  return active === 'all' || (value || UNKNOWN_SUBJECT) === active;
}

/** Server-side public listing request: the subject is a query parameter, not a local filter. */
export function publicMovesPath(query: string, subject: string, offset: number): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  if (subject !== 'all') params.set('subject', subject);
  if (offset > 0) params.set('offset', String(offset));
  const value = params.toString();
  return `/public/moves${value ? `?${value}` : ''}`;
}

/** Identity of a requested page, so a subject switch invalidates an in-flight response. */
export function publicPageKey(query: string, subject: string, offset: number): string {
  return JSON.stringify([query.trim(), subject, offset]);
}
