/**
 * Neutral discovery mapping and labels.
 *
 * This module must stay free of specialized editor or assessment imports: feed,
 * search and public surfaces consume this, not body/music editors.
 */
export type DiscoveryAct = 'full_body' | 'piano' | 'guitar' | string;

export type DiscoverySubject = {id: string; label: string};

export type DiscoveryActions = {watch: boolean; practice: boolean; challenge: boolean};

export type DiscoveryItem = {
  lessonId: string;
  releaseRevision: string;
  actId: DiscoveryAct;
  title: string;
  creator: {id: string; displayName: string};
  subjects: DiscoverySubject[];
  tags: string[];
  poster: {key?: string; url?: string} | null;
  duration: number;
  sections: number;
  roles: string[];
  representations: string[];
  actions: DiscoveryActions;
  audience: 'public';
  likeCount: number;
  likedByViewer: boolean;
};

export const SOCIAL_POLICY = 'deterministic-social-v1';

const ACT_LABELS: Record<string, string> = {
  full_body: 'Full body',
  piano: 'Piano',
  guitar: 'Guitar',
  drawing: 'Drawing',
};

const BODY_SUBJECTS = new Set(['dance', 'taekwondo', 'boxing', 'movement_other']);

export function actForSubject(subject: string | null | undefined): DiscoveryAct | null {
  if (subject === 'piano' || subject === 'guitar' || subject === 'drawing') return subject;
  return BODY_SUBJECTS.has(subject ?? '') ? 'full_body' : null;
}

export function actLabel(actId: DiscoveryAct | null | undefined): string {
  return ACT_LABELS[actId ?? ''] ?? 'Lesson';
}

function deriveActions(raw: Record<string, unknown>): DiscoveryActions {
  const explicit = raw.effective_actions as DiscoveryActions | undefined;
  if (explicit && typeof explicit === 'object') {
    return {watch: Boolean(explicit.watch), practice: Boolean(explicit.practice),
      challenge: Boolean(explicit.challenge)};
  }
  const roles = Array.isArray(raw.roles) ? raw.roles as string[] : [];
  const playable = roles.some(role => role === 'interactive_data' || role === 'playable_preview'
    || role === 'reference');
  return {watch: true, practice: playable, challenge: false};
}

/** Map the public API item (or a legacy card) into the neutral shape. */
export function discoveryFromApi(raw: Record<string, unknown>): DiscoveryItem {
  const subject = typeof raw.subject === 'string' ? raw.subject : null;
  const subjectLabel = typeof raw.subject_label === 'string' ? raw.subject_label : '';
  const subjects = Array.isArray(raw.subjects)
    ? (raw.subjects as DiscoverySubject[]).map(value => ({id: value.id, label: value.label}))
    : subject ? [{id: subject, label: subjectLabel || subject}] : [];
  const actId = (typeof raw.act_id === 'string' && raw.act_id)
    || actForSubject(subjects[0]?.id ?? subject)
    || 'unknown';
  const creator = raw.creator as {id?: string; display_name?: string} | undefined;
  const roles = Array.isArray(raw.roles) ? raw.roles as string[] : [];
  const representations = Array.isArray(raw.representations) ? raw.representations as string[] : [];
  const content = raw.content as {sections?: number} | undefined;
  return {
    lessonId: String(raw.lesson_id ?? ''),
    releaseRevision: String(raw.release_revision ?? raw.revision_id ?? ''),
    actId,
    title: String(raw.title ?? ''),
    creator: {
      id: String(creator?.id ?? raw.creator_id ?? ''),
      displayName: String(creator?.display_name ?? raw.creator_name ?? ''),
    },
    subjects,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]).map(String) : [],
    poster: raw.poster && typeof raw.poster === 'object'
      ? raw.poster as {key?: string; url?: string}
      : typeof raw.thumbnail_url === 'string' && raw.thumbnail_url
        ? {url: raw.thumbnail_url}
        : null,
    duration: Number(raw.duration ?? 0),
    sections: Number(content?.sections ?? raw.section_count ?? 0),
    roles,
    representations,
    actions: deriveActions(raw),
    audience: 'public',
    likeCount: Number(raw.like_count ?? 0),
    likedByViewer: Boolean(raw.liked_by_viewer),
  };
}

/** Owned/shared summaries become the same shape without pretending to be public. */
export function discoveryFromSummary(raw: Record<string, unknown>, challengeEnabled = false): DiscoveryItem {
  const subject = typeof raw.subject === 'string' ? raw.subject : null;
  const actId = actForSubject(subject) ?? 'unknown';
  return {
    lessonId: String(raw.lesson_id ?? ''),
    releaseRevision: String(raw.revision_id ?? ''),
    actId,
    title: String(raw.title ?? ''),
    creator: {id: '', displayName: ''},
    subjects: subject ? [{id: subject, label: String(raw.subject_label ?? subject)}] : [],
    tags: [],
    poster: raw.poster && typeof raw.poster === 'object' ? raw.poster as {key?: string} : null,
    duration: Number(raw.duration ?? 0),
    sections: Number(raw.section_count ?? 0),
    roles: [],
    representations: [],
    actions: {watch: true, practice: true,
      challenge: challengeEnabled && actId === 'piano'},
    audience: 'public',
    likeCount: 0,
    likedByViewer: false,
  };
}

/** Honest action label; unsupported capabilities are named, not hidden. */
export function actionSummary(item: Pick<DiscoveryItem, 'actions'>): string {
  const {practice, challenge} = item.actions;
  if (practice && challenge) return 'Practice + challenge';
  if (practice) return 'Practice';
  return 'Watch only';
}

/** The safe open target: practice only when the server says it is supported. */
export function openTarget(item: Pick<DiscoveryItem, 'actions'>): 'practice' | 'watch' {
  return item.actions.practice ? 'practice' : 'watch';
}

/** A message for an unsupported mode; never falls back to body rendering. */
export function unsupportedModeMessage(actId: DiscoveryAct, mode: 'practice' | 'challenge'): string {
  if (!ACT_LABELS[actId]) {
    return 'This lesson uses an Act this version of the app cannot open.';
  }
  if (mode === 'challenge') return 'This Act has no challenge mode.';
  return 'This lesson has no playable source for practice yet.';
}

export function dedupeById(items: readonly DiscoveryItem[]): DiscoveryItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (!item.lessonId || seen.has(item.lessonId)) return false;
    seen.add(item.lessonId);
    return true;
  });
}

/** Client-side filter used for owned/shared lists; server does this for public. */
export function filterDiscovery(
  items: readonly DiscoveryItem[],
  filters: {act?: string; subject?: string; tag?: string; q?: string},
): DiscoveryItem[] {
  const q = filters.q?.trim().toLocaleLowerCase() ?? '';
  return items.filter(item => {
    if (filters.act && item.actId !== filters.act) return false;
    if (filters.subject && !item.subjects.some(value => value.id === filters.subject)) return false;
    if (filters.tag && !item.tags.includes(filters.tag)) return false;
    if (q && !`${item.title} ${item.creator.displayName}`.toLocaleLowerCase().includes(q)) return false;
    return true;
  });
}
