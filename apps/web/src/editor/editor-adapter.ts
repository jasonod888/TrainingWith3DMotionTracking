/**
 * The Act editor adapter contract.
 *
 * The shared editor owns lifecycle, readiness, dirty state and revision handoff.
 * Each Act owns its draft payload and its specialized tools. The shared engine
 * never reads or generically edits a body/music reference; it only calls these
 * four operations.
 */
import type {EditorReadiness} from './editor-readiness';

export type EditorSaveInput = {
  /** The exact revision the edit was based on; null for a first save. */
  baseRevisionId: string | null;
};

export type EditorSaveResult = {revisionId: string};

export type ActEditorAdapter<TDraft> = {
  actId: string;
  /** Load the private draft/revision this editor works on. */
  loadDraft(): Promise<TDraft>;
  /** Playback validity and optional assessment readiness, from the Act's own rules. */
  readiness(draft: TDraft): EditorReadiness;
  isDirty(draft: TDraft): boolean;
  /** Persist privately. Must never publish or move the released revision. */
  save(draft: TDraft, input: EditorSaveInput): Promise<EditorSaveResult>;
  /** Complete the Act's required review step and return the reviewed revision. */
  completeReview(draft: TDraft, revision: EditorSaveResult): Promise<EditorSaveResult>;
};

/**
 * Runtime guard used by registration and tests. It intentionally checks shape,
 * not semantics: semantics belong to each Act's tests.
 */
export function assertEditorAdapter<TDraft>(adapter: ActEditorAdapter<TDraft>): void {
  if (!adapter.actId) throw new Error('An editor adapter needs an Act id.');
  for (const name of ['loadDraft', 'readiness', 'isDirty', 'save', 'completeReview'] as const) {
    if (typeof adapter[name] !== 'function') {
      throw new Error(`The ${adapter.actId} editor adapter is missing ${name}().`);
    }
  }
}
