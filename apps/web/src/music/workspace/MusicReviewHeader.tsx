/**
 * Topbar for the music review workspace.
 *
 * This is a presentation owner: the composition root still owns document history,
 * dirty/save state, drawer visibility and the review dialog lifecycle. The header
 * receives only the state and commands it renders, so a document edit never has to
 * pass the whole workspace through an untyped context.
 */
import type {RefObject} from 'react';
import {
  ArrowLeft, MoreHorizontal, Redo2, Settings as SettingsIcon, Undo2,
} from 'lucide-react';

export type ReviewDrawerTarget = 'settings' | 'more' | 'video' | 'sound' | 'note';

/** Display-only title; the saved/source title is never rewritten. */
export function displayPieceTitle(raw: string): string {
  const clean = raw.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Piano review';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export type MusicReviewHeaderProps = {
  isPractice: boolean;
  title: string;
  lessonTitle?: string;
  onBack?: () => void;
  dirty: boolean;
  status: string;
  statusDetail: string;
  formatted: boolean;
  onReturnToCorrection: () => void;
  canUndo: boolean;
  canRedo: boolean;
  readOnly: boolean;
  historyLocked: boolean;
  onUndo: () => void;
  onRedo: () => void;
  drawerOpen: boolean;
  drawerTarget: ReviewDrawerTarget;
  onOpenSettings: () => void;
  onOpenMore: () => void;
  reviewTrigger: RefObject<HTMLButtonElement | null>;
  onOpenReview: () => void;
  saving: boolean;
  saveDisabled: boolean;
};

export function MusicReviewHeader({
  isPractice, title, lessonTitle, onBack, dirty, status, statusDetail, formatted,
  onReturnToCorrection, canUndo, canRedo, readOnly, historyLocked, onUndo, onRedo,
  drawerOpen, drawerTarget, onOpenSettings, onOpenMore, reviewTrigger, onOpenReview,
  saving, saveDisabled,
}: MusicReviewHeaderProps) {
  return <header className="ws-topbar">
    <div className="ws-topbar-lead">
      {onBack && <button type="button" className="ws-icon-button ws-back" data-workspace-back="true"
        aria-label="Back" title="Back"
        onClick={() => {
          if (dirty && !globalThis.window.confirm('Leave without saving your changes?')) return;
          onBack();
        }}><ArrowLeft size={19}/></button>}
      <div className="ws-title-block">
        <h1>{isPractice ? displayPieceTitle(lessonTitle || title) : displayPieceTitle(title)}</h1>
        {!isPractice && <p className="ws-topbar-status" data-save-status={dirty ? 'dirty' : 'clean'}
          title={statusDetail}>{status}</p>}
      </div>
    </div>
    <div className="ws-topbar-actions" hidden={isPractice}>
      {formatted && <button type="button" className="ws-quiet-button"
        onClick={onReturnToCorrection}>Return to correction</button>}
      {!isPractice && <button type="button" className="ws-icon-button ws-undo" aria-label="Undo" title="Undo"
        onClick={onUndo}
        disabled={readOnly || !canUndo || historyLocked}><Undo2 size={19}/></button>}
      {!isPractice && <button type="button" className="ws-icon-button ws-redo" aria-label="Redo" title="Redo"
        onClick={onRedo}
        disabled={readOnly || !canRedo || historyLocked}><Redo2 size={19}/></button>}
      <button type="button" className="ws-icon-button" aria-label="Settings" title="Settings"
        aria-expanded={drawerOpen && drawerTarget === 'settings'} data-settings-toggle="true"
        onClick={onOpenSettings}><SettingsIcon size={19}/></button>
      <button type="button" className="ws-icon-button ws-more" aria-label="More" title="More"
        aria-expanded={drawerOpen && drawerTarget === 'more'} data-more-toggle="true"
        onClick={onOpenMore}><MoreHorizontal size={19}/></button>
      {!isPractice && !readOnly && <button ref={reviewTrigger} type="button" className="ws-save"
        onClick={onOpenReview}
        disabled={saving || saveDisabled}
        data-review-save="true" aria-label="Review and save" title="Review and save">
        {saving ? 'Saving…' : 'Save'}
      </button>}
    </div>
  </header>;
}
