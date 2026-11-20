/**
 * Recovery checkpoint coordinator for the music review workspace.
 *
 * Owns the offer/stale/notice state and the delayed read/write/clear lifecycle.
 * Parsing and checkpoint identity live here; the caller applies a validated
 * checkpoint to its document and authored sidecars through `onRestore`.
 */
import {useCallback, useEffect, useState} from 'react';
import {
  parseNotationDocument,
  type Alignment,
  type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import {clearRecovery, peekRecovery, readRecovery, salvageGuitarChords, writeRecovery,
  type RecoveryCheckpoint, type RecoveryIdentity} from './recovery';
import {
  serializeAlignment, type SavedGuitarChord, type SavedSpan,
} from './save-payload';
import type {AcceptedBaseline} from './useMusicVerificationController';

export type RecoveryRestore = {
  checkpoint: RecoveryCheckpoint;
  document: NotationDocument;
  /** A checkpoint written against an older saved base; keep the current base. */
  stale: boolean;
};

/**
 * The checkpoint identity is account/lesson/draft/source-scoped. The base revision is
 * deliberately excluded so a stale-base checkpoint can still be offered separately.
 */
export function checkpointMatchesIdentity(
  checkpoint: RecoveryCheckpoint, identity: RecoveryIdentity,
): boolean {
  const recorded = checkpoint.identity;
  return Boolean(recorded)
    && recorded.accountId === identity.accountId
    && recorded.lessonId === identity.lessonId
    && recorded.draftId === identity.draftId
    && recorded.sourceSha256 === identity.sourceSha256;
}

export function useMusicReviewRecovery({
  identity, enabled, dirty, workspaceSignature, document, title, alignment, anchors,
  offsetSeconds, spans, sectionsDraft, assessmentPolicy, feedbackEnabled, guitarChords,
  lastValidChords, verificationToken, acceptedBaselines, authoredSpellings,
  savedRevisionId, onRestore,
}: {
  identity: RecoveryIdentity;
  enabled: boolean;
  dirty: boolean;
  workspaceSignature: string;
  document: NotationDocument | null;
  title: string;
  alignment: Alignment | null;
  anchors: {seconds: number; tick: number}[];
  offsetSeconds: number;
  spans: SavedSpan[];
  sectionsDraft: {id: string; label: string; start: number; end: number}[];
  assessmentPolicy: 'none' | 'notes';
  feedbackEnabled: boolean;
  guitarChords: SavedGuitarChord[];
  lastValidChords: SavedGuitarChord[];
  verificationToken: string;
  acceptedBaselines: Record<string, AcceptedBaseline>;
  authoredSpellings: {current: Record<string, Record<string, string>>};
  savedRevisionId: string | null;
  onRestore: (value: RecoveryRestore) => void;
}) {
  const [recoveryOffer, setRecoveryOffer] = useState<RecoveryCheckpoint | null>(null);
  const [staleCheckpoint, setStaleCheckpoint] = useState<RecoveryCheckpoint | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');

  // A local checkpoint is offered only when its account, draft and source match.
  useEffect(() => {
    // A new identity must never keep showing the previous lesson/account's offer.
    setRecoveryOffer(null);
    setStaleCheckpoint(null);
    setRecoveryNotice('');
    setRecoveryMessage('');
    if (!enabled) return;
    const outcome = readRecovery(identity);
    if (outcome.status === 'restored') setRecoveryOffer(outcome.checkpoint);
    else if (outcome.status === 'rejected') {
      setRecoveryNotice(outcome.reason);
      if (/saved revision/i.test(outcome.reason)) setStaleCheckpoint(peekRecovery());
    }
    // Only when the draft identity becomes available; a new saved base alone does not
    // re-read and silently re-offer a checkpoint the user already dismissed.
  }, [enabled, identity.accountId, identity.lessonId, identity.draftId, identity.sourceSha256]);

  // Autosave a local checkpoint while edits are unsaved; it is never called Saved.
  useEffect(() => {
    if (!enabled || !dirty || !document) return;
    const timer = setTimeout(() => {
      writeRecovery({
        identity, title,
        baseRevisionId: savedRevisionId, verificationToken: verificationToken || null,
        notation: document,
        alignment: serializeAlignment(alignment, anchors, offsetSeconds),
        offsetSeconds, spans,
        sections: sectionsDraft.length ? sectionsDraft : undefined,
        assessment: {policy: assessmentPolicy},
        feedbackEnabled,
        durationSeconds: document.duration,
        authoredSpellings: authoredSpellings.current,
        acceptedBaselines: acceptedBaselines as unknown as RecoveryCheckpoint['acceptedBaselines'],
        // An in-progress chord edit (blank name, unsorted position) must never make
        // the only recovery checkpoint unreadable.
        guitarChords: guitarChords.length
          ? salvageGuitarChords(guitarChords, lastValidChords)
          : undefined,
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [workspaceSignature, dirty, enabled, identity, document, title, alignment, anchors,
      offsetSeconds, spans, sectionsDraft, assessmentPolicy, feedbackEnabled, guitarChords,
      lastValidChords, verificationToken, acceptedBaselines, authoredSpellings, savedRevisionId]);

  const restoreCheckpoint = useCallback(() => {
    if (!recoveryOffer) return;
    // Re-validate at restore time: the identity may have changed before the effect
    // above cleared the previous offer.
    if (!checkpointMatchesIdentity(recoveryOffer, identity)) {
      setRecoveryOffer(null);
      setRecoveryMessage('');
      setRecoveryNotice('The local checkpoint no longer matches this lesson and was ignored.');
      return;
    }
    try {
      const restored = parseNotationDocument(recoveryOffer.notation);
      onRestore({checkpoint: recoveryOffer, document: restored, stale: false});
      setRecoveryOffer(null);
      setRecoveryMessage(`Restored a local checkpoint from ${
        new Date(recoveryOffer.savedAt).toLocaleString()} — it is not saved to the server.`);
    } catch {
      setRecoveryNotice('The local checkpoint could not be restored and was ignored.');
      setRecoveryOffer(null);
    }
  }, [recoveryOffer, identity, onRestore]);

  const restoreStaleCheckpoint = useCallback(() => {
    if (!staleCheckpoint) return;
    if (!checkpointMatchesIdentity(staleCheckpoint, identity)) {
      setStaleCheckpoint(null);
      setRecoveryMessage('');
      setRecoveryNotice('The stale checkpoint no longer matches this lesson and was ignored.');
      return;
    }
    try {
      const restored = parseNotationDocument(staleCheckpoint.notation);
      onRestore({checkpoint: staleCheckpoint, document: restored, stale: true});
      setStaleCheckpoint(null);
      setRecoveryNotice('');
      setRecoveryMessage('Restored a checkpoint written against an older revision. '
        + 'Saving now creates a new revision on the current base.');
    } catch {
      setRecoveryNotice('The stale checkpoint could not be restored and was ignored.');
      setStaleCheckpoint(null);
    }
  }, [staleCheckpoint, identity, onRestore]);

  const discardCheckpoint = useCallback(() => {
    clearRecovery();
    setRecoveryOffer(null);
  }, []);

  const discardStaleCheckpoint = useCallback(() => {
    clearRecovery();
    setStaleCheckpoint(null);
  }, []);

  /** A successful save of the current work supersedes every local checkpoint. */
  const clearCheckpoint = useCallback(() => {
    clearRecovery();
    setRecoveryOffer(null);
    setStaleCheckpoint(null);
    setRecoveryNotice('');
    setRecoveryMessage('');
  }, []);

  return {
    recoveryOffer, staleCheckpoint, recoveryNotice, recoveryMessage,
    restoreCheckpoint, restoreStaleCheckpoint, discardCheckpoint,
    discardStaleCheckpoint, clearCheckpoint,
  };
}
