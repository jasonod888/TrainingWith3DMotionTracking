/**
 * Shared publication readiness for every Act.
 *
 * Mirrors the server policy: a public release names an approved representation
 * role. Private, link, group and invite audiences still require an accepted
 * revision, but they do not need a public representation. Messages are actionable
 * and Act-specific instead of "music cannot be public" / "video-only cannot public".
 */
export type PublishAudience = 'invited' | 'link' | 'group' | 'public';

export type PublicationView = {
  actId: string;
  hasAnimation: boolean;
  hasPreviewVideo: boolean;
  hasReference: boolean;
  hasPoster?: boolean;
  accepted: boolean;
};

export type Readiness = {
  audience: PublishAudience;
  enabled: boolean;
  roles: string[];
  reason: string;
};

const ROLE_LABELS: Record<string, string> = {
  interactive_data: '3D movement',
  playable_preview: 'video preview',
  reference: 'reviewed score/notation',
  poster: 'poster',
};

export function allowedRoles(view: PublicationView): string[] {
  if (view.actId === 'full_body') return ['playable_preview', 'interactive_data'];
  return ['poster', 'playable_preview', 'reference'];
}

export function defaultRoles(view: PublicationView): string[] {
  // Only 3D movement keeps its historical default; music must be chosen.
  return view.actId === 'full_body' && view.hasAnimation ? ['interactive_data'] : [];
}

export function availableRoles(view: PublicationView): string[] {
  const available: string[] = [];
  for (const role of allowedRoles(view)) {
    if (role === 'interactive_data' && view.hasAnimation) available.push(role);
    if (role === 'playable_preview' && view.hasPreviewVideo) available.push(role);
    if (role === 'reference' && view.hasReference) available.push(role);
    if (role === 'poster' && view.hasPoster) available.push(role);
  }
  return available;
}

export function readinessMessage(actId: string, missing: readonly string[]): string {
  for (const code of missing) {
    if (code === 'revision_not_accepted') return 'Check this revision before publishing it.';
    if (code === 'rights_not_acknowledged') return 'Confirm you have the right to share this lesson publicly.';
    if (code === 'missing_asset:playable_preview') {
      return actId === 'full_body'
        ? 'This movement is video only. Prepare and approve a public video preview before publishing.'
        : 'This lesson has no approved preview video or audio yet.';
    }
    if (code === 'missing_asset:reference') return 'This lesson has no reviewed reference to publish.';
    if (code === 'missing_public_representation') {
      return actId === 'full_body'
        ? 'Choose an approved public representation: 3D movement or a prepared video preview.'
        : 'Choose what people will see: a reviewed score, an approved preview, or both.';
    }
    if (code === 'missing_playable_representation') {
      return 'A poster alone is not enough; add a 3D, video or reviewed reference representation.';
    }
  }
  return '';
}

export function readiness(input: {
  view: PublicationView;
  audience: PublishAudience;
  roles?: readonly string[];
  rightsAcknowledged?: boolean;
}): Readiness {
  const {view, audience} = input;
  const allowed = allowedRoles(view);
  const available = availableRoles(view);
  const requested = input.roles && input.roles.length ? [...input.roles] : defaultRoles(view);
  const roles = requested.filter(role => allowed.includes(role) && available.includes(role));

  const missing: string[] = [];
  if (!view.accepted) missing.push('revision_not_accepted');
  if (audience === 'public') {
    if (!roles.length) missing.push('missing_public_representation');
    if (!input.rightsAcknowledged) missing.push('rights_not_acknowledged');
  }
  const enabled = missing.length === 0;
  return {
    audience,
    enabled,
    roles,
    reason: enabled ? '' : readinessMessage(view.actId, missing),
  };
}

export function rolesSummary(roles: readonly string[]): string {
  return roles.map(role => ROLE_LABELS[role] ?? role).join(' + ');
}
