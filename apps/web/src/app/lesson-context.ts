/**
 * The single validated lesson-loading boundary for the application shell.
 *
 * One request produces one `LessonContext`: lesson/revision identity, Act identity,
 * audience, account scope, resolved capabilities and the existing specialized
 * document (body or music). Act-specific surfaces receive this object instead of
 * re-fetching the same manifest by id.
 *
 * Negotiation: `X-Act-Formats: 1` asks for the outer context envelope. A server or
 * cached response without it is adapted deterministically from the validated
 * document (v1 body -> full_body; music subject -> piano/guitar). An unknown Act
 * never becomes full_body: it raises UnsupportedActError with an unsupported set.
 *
 * Caching is deliberately narrow:
 * - lesson contexts are keyed by (account scope, audience, lesson, revision) and
 *   are only reused when the caller proves the expected revision; a mutable release
 *   pointer therefore always triggers a fresh load;
 * - reference assets are immutable and keyed by SHA-256.
 * Sign-out/account change clears both. Public never reads an owner's entry.
 */
import {ApiError, assetUrl} from '../api';
import {parseLessonDocument, parsePublicLessonDocument} from '../../../../packages/lesson-schema/parse';
import type {LessonDocument} from '../../../../packages/lesson-schema/index';
import {
  resolveCapabilities,
  unsupportedActCapabilities,
  type ActInput,
  type CapabilitySet,
  type LessonAssets,
} from '../../../../packages/learning-engine/act-capabilities';
import {actSupportFor, implementationFor} from '../acts/registry';

export type LessonAudience = 'owner' | 'invited' | 'link' | 'group' | 'public' | 'demo';

export type LessonContext = {
  lessonId: string;
  revisionId: string;
  actId: string;
  actLabel: string;
  audience: LessonAudience;
  /** Account id, 'public' or 'guest'. Part of every cache key. */
  accountScope: string;
  permissions: {canView: boolean; isOwner: boolean};
  capabilities: CapabilitySet;
  document: LessonDocument;
};

export class UnsupportedActError extends ApiError {
  readonly actId: string | null;
  readonly capabilities: CapabilitySet;

  constructor(actId: string | null) {
    super(actId
      ? `This lesson uses the "${actId}" Act, which this version of the app cannot open.`
      : 'This lesson does not declare an Act this version of the app can open.', 422);
    this.name = 'UnsupportedActError';
    this.actId = actId;
    this.capabilities = unsupportedActCapabilities('unsupported_act', this.message);
  }
}

const BODY_SUBJECTS = new Set(['dance', 'taekwondo', 'boxing', 'movement_other']);

/** Deterministic adapter for a response that predates the Act envelope. */
export function compatibilityActId(document: LessonDocument): string | null {
  if (document.kind === 'body') return 'full_body';
  if (document.kind === 'drawing') return 'drawing';
  const subject = document.value.subject;
  if (subject === 'piano' || subject === 'guitar' || subject === 'drawing') return subject;
  return BODY_SUBJECTS.has(subject) ? 'full_body' : null;
}

function feedbackEnabledFor(document: LessonDocument): boolean {
  if (document.kind === 'music') {
    const value = document.value;
    if (typeof value.feedback_enabled === 'boolean') return value.feedback_enabled;
    return value.assessment.assessment !== 'none';
  }
  if (document.kind === 'body') return document.value.feedback_enabled !== false;
  // Drawing is explicitly unassessed; there is no feedback to enable.
  if (document.kind === 'drawing') return false;
  return true;
}

function assetsFor(document: LessonDocument, publicRepresentations: readonly string[]): LessonAssets {
  if (document.kind === 'music') {
    return {
      playable: Boolean(document.value.reference),
      reviewed: document.value.reference_reviewed === true,
      publicRepresentation: Boolean(document.value.reference || document.value.public_poster),
    };
  }
  if (document.kind === 'drawing') {
    const steps = document.value.steps ?? [];
    return {
      playable: steps.length > 0,
      reviewed: true,
      publicRepresentation: Boolean(document.value.poster || steps.length),
    };
  }
  if (document.kind === 'body') {
    return {
      playable: Boolean(document.value.animation || document.value.landmarks),
      reviewed: true,
      publicRepresentation: publicRepresentations.includes('interactive_3d')
        && Boolean(document.value.animation),
    };
  }
  return {playable: document.value.section_count > 0, reviewed: true, publicRepresentation: false};
}

export type BuildLessonContextInput = {
  document: LessonDocument;
  audience: LessonAudience;
  accountScope: string;
  /** Server-provided Act id, when the negotiated envelope was returned. */
  actId?: string | null;
  learnerFeedback?: 'on' | 'off' | 'unset';
  deviceInputs?: readonly ActInput[];
  challengeEnabled?: boolean;
  practiceEnabled?: boolean;
  /** Server-resolved ceiling. It may restrict, never expand, the local answer. */
  serverCapabilities?: Partial<CapabilitySet> | null;
};

/**
 * Build the context from already-validated data. Pure: no network, no storage.
 * Throws UnsupportedActError rather than substituting another Act.
 */
const CAPABILITY_NAMES = ['canEdit', 'canReview', 'canPractice', 'canChallenge',
  'canAssess', 'canRecord', 'canPublishPublicly'] as const;

function parseServerCapabilities(value: unknown): Partial<CapabilitySet> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result: Partial<CapabilitySet> = {};
  for (const name of CAPABILITY_NAMES) {
    const raw = record[name];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (item.support !== 'supported' && item.support !== 'unavailable'
        && item.support !== 'unsupported') continue;
    if (typeof item.available !== 'boolean') continue;
    result[name] = {
      support: item.support,
      available: item.available,
      reasonCode: typeof item.reasonCode === 'string' ? item.reasonCode : 'server_restricted',
      explanation: typeof item.explanation === 'string' ? item.explanation : '',
    };
  }
  return Object.keys(result).length ? result : null;
}

/** A server `false`/`unavailable`/`unsupported` is a ceiling the client cannot lift. */
function applyServerCeiling(local: CapabilitySet,
                            server?: Partial<CapabilitySet> | null): CapabilitySet {
  if (!server) return local;
  const result = {...local};
  for (const name of CAPABILITY_NAMES) {
    const ceiling = server[name];
    if (!ceiling) continue;
    if (ceiling.available && ceiling.support === 'supported') continue;
    result[name] = {
      support: ceiling.support === 'supported' ? 'unavailable' : ceiling.support,
      available: false,
      reasonCode: ceiling.reasonCode || local[name].reasonCode,
      explanation: ceiling.explanation || local[name].explanation,
    };
  }
  return result;
}

export function buildLessonContext(input: BuildLessonContextInput): LessonContext {
  const actId = input.actId ?? compatibilityActId(input.document);
  const support = actSupportFor(actId);
  const implementation = implementationFor(actId);
  if (!actId || !support || !implementation) throw new UnsupportedActError(actId ?? null);

  const isOwner = input.audience === 'owner';
  // Body challenge has no deployment flag; a music challenge is opt-in per
  // deployment (the server's music_challenge flag travels through the caller).
  const challengeEnabled = support.id === 'full_body'
    ? true
    : (input.challengeEnabled ?? false);
  const capabilities = applyServerCeiling(resolveCapabilities({
    act: support,
    assets: assetsFor(input.document, support.publicationRepresentations),
    creator: {feedbackEnabled: feedbackEnabledFor(input.document)},
    learner: {feedback: input.learnerFeedback ?? 'unset'},
    // The server cannot know this device. Until a capture surface starts, only
    // uploaded evidence is known to be possible; permission checks refine it.
    device: {availableInputs: input.deviceInputs ?? ['uploaded_recording']},
    audience: {canView: true, isOwner},
    deployment: {
      actEnabled: true,
      practiceEnabled: input.practiceEnabled ?? true,
      challengeEnabled,
    },
  }), input.serverCapabilities);

  return {
    lessonId: input.document.value.lesson_id,
    revisionId: input.document.value.revision_id,
    actId: support.id,
    actLabel: implementation.label,
    audience: input.audience,
    accountScope: input.accountScope,
    permissions: {canView: true, isOwner},
    capabilities,
    document: input.document,
  };
}

/** Validate a public projection envelope and build its public context. */
export function buildPublicLessonContext(value: unknown): LessonContext {
  const parsed = parsePublicLessonDocument(value);
  if (!parsed.ok) throw new ApiError(parsed.message, 422);
  const metadata = parsed.value.metadata;
  const serverCapabilities: Partial<CapabilitySet> = {
    ...(parseServerCapabilities(metadata.effectiveCapabilities) ?? {}),
  };
  const denied = (reasonCode: string, explanation: string) => ({
    support: 'unavailable' as const, available: false, reasonCode, explanation,
  });
  const videoOnlyBody = parsed.value.document.kind === 'body'
    && !parsed.value.document.value.landmarks;
  const actions = metadata.effectiveActions;
  if (videoOnlyBody || actions?.practice === false) {
    serverCapabilities.canPractice = denied('watch_only',
      'This public release has no approved interactive reference; watch-only remains available.');
  }
  if (videoOnlyBody || actions?.challenge === false) {
    serverCapabilities.canChallenge = denied('watch_only',
      'A scored challenge needs an approved pose reference.');
  }
  if (videoOnlyBody) {
    serverCapabilities.canAssess = denied('no_assessment_adapter',
      'No approved pose reference was published for this video-only release.');
  }
  return buildLessonContext({
    document: parsed.value.document, audience: 'public', accountScope: 'public',
    serverCapabilities,
  });
}

const contextKey = (scope: string, audience: string, lessonId: string, revisionId: string) =>
  `${scope}|${audience}|${lessonId}|${revisionId}`;
const contexts = new Map<string, LessonContext>();
const references = new Map<string, ReferenceCacheEntry>();
const referenceInFlight = new Map<string, Promise<unknown>>();

/** Sign-out, account change, or explicit release invalidation. */
export function clearLessonContextCache(): void {
  contexts.clear();
  references.clear();
  referenceBytes = 0;
  referenceInFlight.clear();
}

export function invalidateLessonContext(lessonId: string): void {
  for (const key of [...contexts.keys()]) {
    if (key.includes(`|${lessonId}|`)) contexts.delete(key);
  }
}

export type LoadLessonContextOptions = {
  audience?: LessonAudience;
  accountScope?: string;
  learnerFeedback?: 'on' | 'off' | 'unset';
  deviceInputs?: readonly ActInput[];
  challengeEnabled?: boolean;
  practiceEnabled?: boolean;
  /** Reuse a cached context only when it matches expectedRevisionId. */
  useCached?: boolean;
  expectedRevisionId?: string | null;
  signal?: AbortSignal;
};

/**
 * Load and validate one lesson. Every cold open performs exactly one manifest
 * request, so a changed release pointer is observed; reuse is opt-in and exact.
 */
export async function loadLessonContext(
  lessonId: string,
  options: LoadLessonContextOptions = {},
): Promise<LessonContext> {
  const audience = options.audience ?? 'owner';
  const scope = options.accountScope ?? 'guest';

  if (options.useCached) {
    const prefix = `${scope}|${audience}|${lessonId}|`;
    for (const [key, value] of contexts) {
      if (!key.startsWith(prefix)) continue;
      if (!options.expectedRevisionId || value.revisionId === options.expectedRevisionId) return value;
    }
  }

  const response = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}`, {
    credentials: 'same-origin',
    headers: {'X-Lesson-Formats': '1,2,3', 'X-Act-Formats': '1'},
    ...(options.signal ? {signal: options.signal} : {}),
  });
  if (response.status === 406) {
    const data = await response.json().catch(() => null);
    throw new ApiError(typeof data?.detail === 'string'
      ? data.detail
      : 'This lesson needs a newer version of the app. Refresh to update.', 406);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const detail = typeof data?.detail === 'string'
      ? data.detail
      : data?.detail?.detail;
    throw new ApiError(typeof detail === 'string'
      ? detail
      : 'Your lesson could not be loaded. Try again.', response.status);
  }

  const raw = await response.json().catch(() => null);
  const envelope = raw && typeof raw === 'object'
    && (raw as {context_version?: unknown}).context_version === 1
    && 'document' in (raw as Record<string, unknown>)
    ? raw as {document: unknown; act_id?: unknown; audience?: unknown;
              effective_capabilities?: unknown}
    : null;
  const parsed = parseLessonDocument(envelope ? envelope.document : raw);
  if (!parsed.ok) throw new ApiError(parsed.message, 422);

  const context = buildLessonContext({
    document: parsed.value,
    audience: envelope && typeof envelope.audience === 'string'
      ? envelope.audience as LessonAudience
      : audience,
    accountScope: scope,
    actId: envelope && typeof envelope.act_id === 'string' ? envelope.act_id : undefined,
    learnerFeedback: options.learnerFeedback,
    deviceInputs: options.deviceInputs,
    challengeEnabled: options.challengeEnabled,
    practiceEnabled: options.practiceEnabled,
    serverCapabilities: parseServerCapabilities(envelope?.effective_capabilities),
  });
  contexts.set(contextKey(scope, context.audience, lessonId, context.revisionId), context);
  return context;
}

/**
 * Revalidate a mutable release pointer before acting on an active release.
 * Always performs one fresh request; the old context is never reused.
 */
export function revalidateLessonContext(
  context: LessonContext,
  options: Omit<LoadLessonContextOptions, 'useCached' | 'expectedRevisionId'> = {},
): Promise<LessonContext> {
  return loadLessonContext(context.lessonId, {
    ...options,
    audience: context.audience,
    accountScope: context.accountScope,
    useCached: false,
  });
}

export type ReferenceAsset = {key: string; bytes?: number; sha256?: string};

/** Active references are pinned so a practice/editor session cannot be evicted. */
export const REFERENCE_CACHE_LIMITS = Object.freeze({
  maxEntries: 16,
  maxBytes: 32 * 1024 * 1024,
  maxEntryBytes: 8 * 1024 * 1024,
});
type ReferenceCacheEntry = {value: unknown; bytes: number; lastUsed: number; pinned: boolean};
let referenceClock = 0;
let referenceBytes = 0;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function evictReferences(protectedSha?: string): void {
  const evictable = () => [...references.entries()]
    .filter(([sha, entry]) => !entry.pinned && sha !== protectedSha)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  while (references.size > REFERENCE_CACHE_LIMITS.maxEntries
      || referenceBytes > REFERENCE_CACHE_LIMITS.maxBytes) {
    const victim = evictable()[0];
    if (!victim) break; // every remaining entry is active; keep it rather than break a session
    references.delete(victim[0]);
    referenceBytes -= victim[1].bytes;
  }
}

export function pinReference(sha256: string): void {
  const entry = references.get(sha256);
  if (!entry) return;
  entry.pinned = true;
  entry.lastUsed = ++referenceClock;
}

export function unpinReference(sha256: string): void {
  const entry = references.get(sha256);
  if (!entry) return;
  entry.pinned = false;
  entry.lastUsed = ++referenceClock;
  evictReferences();
}

/**
 * Load a reviewed reference exactly once per SHA-256. The bytes are verified
 * against `bytes`/`sha256` before the parsed value is cached, so a cached value is
 * always the reviewed file — never a same-named replacement. Oversized single
 * references bypass the cache instead of failing playback.
 */
export async function loadReferenceValue(asset: ReferenceAsset): Promise<unknown> {
  if (!asset.sha256) return (await fetchReference(asset)).value;
  const ref = references.get(asset.sha256);
  if (ref !== undefined) {
    ref.lastUsed = ++referenceClock;
    return ref.value;
  }
  const pending = referenceInFlight.get(asset.sha256);
  if (pending) return pending;
  const request = fetchReference(asset).then(({value, bytes}) => {
    if (bytes <= REFERENCE_CACHE_LIMITS.maxEntryBytes) {
      references.set(asset.sha256 as string, {
        value, bytes, lastUsed: ++referenceClock, pinned: false});
      referenceBytes += bytes;
      evictReferences(asset.sha256);
    }
    return value;
  }).finally(() => referenceInFlight.delete(asset.sha256 as string));
  referenceInFlight.set(asset.sha256, request);
  return request;
}

async function fetchReference(asset: ReferenceAsset): Promise<{value: unknown; bytes: number}> {
  const response = await fetch(assetUrl(asset.key), {credentials: 'same-origin'});
  if (!response.ok) throw new Error('The reviewed reference could not be loaded.');
  const bytes = await response.arrayBuffer();
  if (typeof asset.bytes === 'number' && bytes.byteLength !== asset.bytes) {
    throw new Error('The reviewed reference does not match its file size.');
  }
  if (asset.sha256 && (await sha256Hex(bytes)) !== asset.sha256) {
    throw new Error('The reviewed reference does not match its reviewed file. Reopen the lesson.');
  }
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  return {value: JSON.parse(text), bytes: bytes.byteLength};
}

/** Test/diagnostic helpers; production code clears through sign-out/account change. */
export function lessonContextCacheSize(): number {
  return contexts.size;
}

export function referenceCacheSize(): number {
  return references.size;
}

export function referenceCacheBytes(): number {
  return referenceBytes;
}

export function referenceCacheHas(sha256: string): boolean {
  return references.has(sha256);
}
