/** One generation-protected lesson-opening coordinator for every shell entry. */
import type {Page} from './routes';
import {
  buildLessonContext, buildPublicLessonContext, loadLessonContext,
  type LessonContext,
} from './lesson-context';
import {loadDemo, loadPublicMove} from '../api';

export type LessonOpenSource = 'private' | 'public' | 'demo';
export type LessonOpenIntent = 'preview' | 'practice' | 'edit' | 'share';
export type LessonOpenRequest = {
  lessonId: string;
  source: LessonOpenSource;
  intent: LessonOpenIntent;
  accountScope: string;
  /** Private owner/invited audience; ignored for public/demo. */
  audience?: 'owner' | 'invited' | 'link' | 'group';
  challengeEnabled?: boolean;
};
export type LessonOpenResult = {context: LessonContext; destinationPage: Page};

export class StaleLessonOpenError extends Error {
  constructor() { super('A newer lesson open replaced this one.'); this.name = 'StaleLessonOpenError'; }
}

export type LessonOpener = {
  open(request: LessonOpenRequest): Promise<LessonOpenResult>;
  cancel(): void;
};

type Deps = {
  privateLoad?: (request: LessonOpenRequest) => Promise<LessonContext>;
  publicLoad?: (lessonId: string) => Promise<LessonContext>;
  demoLoad?: () => Promise<LessonContext>;
};

function destinationFor(context: LessonContext, intent: LessonOpenIntent): Page {
  const kind = context.document.kind;
  if (kind === 'drawing') {
    if (intent === 'edit') return 'drawing-edit';
    if (intent === 'share') return 'drawing-share';
    return 'practice';
  }
  if (kind === 'music') {
    if (intent === 'share') return 'share';
    if (intent === 'edit') return 'music-review';
    return 'preview';
  }
  if (intent === 'share') return 'share';
  if (intent === 'edit') return 'review';
  if (intent === 'practice') return 'practice';
  return 'preview';
}

export function createLessonOpener(deps: Deps = {}): LessonOpener {
  let generation = 0;
  const privateLoad = deps.privateLoad ?? (request => loadLessonContext(request.lessonId, {
    audience: request.audience ?? 'owner', accountScope: request.accountScope,
    challengeEnabled: request.challengeEnabled,
  }));
  const publicLoad = deps.publicLoad ?? (async (lessonId: string) =>
    buildPublicLessonContext(await loadPublicMove(lessonId)));
  const demoLoad = deps.demoLoad ?? (async () => {
    const value = await loadDemo();
    if (!value) throw new Error('Demonstration unavailable.');
    return buildLessonContext({document: {kind: 'body', value}, audience: 'demo',
      accountScope: 'public'});
  });

  return {
    cancel() { generation += 1; },
    async open(request) {
      const token = ++generation;
      const context = request.source === 'public' ? await publicLoad(request.lessonId)
        : request.source === 'demo' ? await demoLoad() : await privateLoad(request);
      if (token !== generation) throw new StaleLessonOpenError();
      return {context, destinationPage: destinationFor(context, request.intent)};
    },
  };
}
