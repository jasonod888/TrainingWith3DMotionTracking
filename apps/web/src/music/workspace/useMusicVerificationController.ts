/**
 * Verification/correction coordinator for the music review workspace.
 *
 * Owns finding loading/parsing, the exact server identity/token, prepared decisions,
 * accepted baselines, generation/abort guards and rollback requests. Local document
 * commands still run through the workspace document owner; the server stays the
 * authority for whether a decision was accepted.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import type {Alignment, NotationDocument} from '../../../../../packages/music-notation/index.ts';
import {
  decideVerification, findingDecision, loadVerification, parseVerificationState,
  rollbackAutomaticCorrections, type VerificationFinding, type VerificationState,
} from '../verification';
import {invertFinding, prepareFinding, type AcceptedBaseline} from './verification-transaction';
import type {WorkspaceAction} from './workspace-state';

export type {AcceptedBaseline};

export type VerificationHydration = {
  verification?: VerificationState | null;
  token?: string;
  acceptedBaselines?: Record<string, AcceptedBaseline>;
};

type ControllerOptions = {
  lessonId: string | null;
  draftId: string | null;
  document: NotationDocument | null;
  alignment: Alignment | null;
  dispatch: (action: WorkspaceAction) => void;
  /** Document replacement identity; a replacement cancels any pending decision. */
  documentEpoch?: number;
  rawModelDraft?: boolean;
  enabled?: boolean;
  readOnly?: boolean;
};

/** Server event order must match the live performance before a token may advance. */
function eventsAgree(state: VerificationState, document: NotationDocument | null): boolean {
  if (!document) return false;
  if (state.events.length !== document.performance.length) return false;
  return state.events.every((event, index) => {
    const local = document.performance[index];
    return Boolean(local) && event.id === local.id && event.pitch === local.pitch
      && Math.abs(event.onset - local.onset) < 1e-6;
  });
}

export function useMusicVerificationController({
  lessonId, draftId, document, alignment, dispatch, documentEpoch = 0,
  rawModelDraft = false, enabled = true, readOnly = false,
}: ControllerOptions) {
  const [verification, setVerification] = useState<VerificationState | null>(null);
  const [token, setTokenState] = useState('');
  const [busy, setBusyState] = useState(false);
  const [pendingFindingId, setPendingFindingId] = useState<string | null>(null);
  const [notice, setNoticeState] = useState('');
  const [conflict, setConflictState] = useState('');
  const [acceptedBaselines, setBaselinesState] = useState<Record<string, AcceptedBaseline>>({});

  const verificationRef = useRef<VerificationState | null>(verification);
  const baselinesRef = useRef<Record<string, AcceptedBaseline>>({});
  const documentRef = useRef<NotationDocument | null>(document);
  const alignmentRef = useRef<Alignment | null>(alignment);
  const readOnlyRef = useRef(readOnly);
  const busyRef = useRef(false);
  const epochRef = useRef(documentEpoch);
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const decisionGeneration = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  const decisionAbort = useRef<AbortController | null>(null);
  const lastDocument = useRef(document);
  const previousEpoch = useRef(documentEpoch);

  verificationRef.current = verification;
  documentRef.current = document;
  alignmentRef.current = alignment;
  readOnlyRef.current = readOnly;
  epochRef.current = documentEpoch;

  const setToken = useCallback((value: string) => setTokenState(value), []);
  const setBaselines = useCallback((value: Record<string, AcceptedBaseline>) => {
    baselinesRef.current = value;
    setBaselinesState(value);
  }, []);
  const setBusy = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusyState(value);
  }, []);
  const setNotice = useCallback((value: string) => setNoticeState(value), []);
  const setConflict = useCallback((value: string) => setConflictState(value), []);
  const abortLoad = useCallback(() => {
    loadAbort.current?.abort();
    loadAbort.current = null;
  }, []);
  const abortDecision = useCallback(() => {
    decisionAbort.current?.abort();
    decisionAbort.current = null;
  }, []);

  /** Invalidate any in-flight decision without touching the loaded report or token. */
  const invalidatePending = useCallback((reason?: string) => {
    const hadPending = busyRef.current;
    decisionGeneration.current += 1;
    abortDecision();
    setBusy(false);
    setPendingFindingId(null);
    if (reason && hadPending) setNoticeState(reason);
  }, [abortDecision, setBusy]);

  const reset = useCallback(() => {
    loadGeneration.current += 1;
    abortLoad();
    invalidatePending();
    setVerification(null);
    setToken('');
    setBaselines({});
    setNoticeState('');
    setConflictState('');
  }, [abortLoad, invalidatePending, setToken, setBaselines]);

  const hydrate = useCallback((input: VerificationHydration) => {
    // A recovered checkpoint replaces any in-flight server read; the caller decides
    // which identity/token is authoritative.
    loadGeneration.current += 1;
    abortLoad();
    invalidatePending();
    if (input.verification !== undefined) setVerification(input.verification);
    if (input.token !== undefined) setToken(input.token);
    if (input.acceptedBaselines !== undefined) setBaselines(input.acceptedBaselines);
    setNoticeState('');
    setConflictState('');
  }, [abortLoad, invalidatePending, setToken, setBaselines]);

  const load = useCallback(async () => {
    abortLoad();
    const run = ++loadGeneration.current;
    const alive = () => mounted.current && run === loadGeneration.current;
    if (!enabled || !lessonId || !draftId || rawModelDraft) {
      if (alive()) setVerification(null);
      return;
    }
    const controller = new AbortController();
    loadAbort.current = controller;
    try {
      const value = await loadVerification(lessonId, draftId, controller.signal);
      if (!alive() || value === null) return;
      const parsed = parseVerificationState(value);
      if (!parsed.ok) { if (alive()) setNotice(parsed.message); return; }
      if (!alive()) return;
      setVerification(parsed.value);
      setToken(parsed.value.state_token);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (alive()) setNotice(cause instanceof Error ? cause.message
        : 'Verification could not be loaded.');
    } finally {
      if (loadAbort.current === controller) loadAbort.current = null;
    }
  }, [abortLoad, enabled, lessonId, draftId, rawModelDraft, setNotice, setToken]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      loadGeneration.current += 1;
      decisionGeneration.current += 1;
      loadAbort.current?.abort();
      decisionAbort.current?.abort();
      loadAbort.current = null;
      decisionAbort.current = null;
    };
  }, [load]);

  // Lesson/revision navigation cancels a pending decision and retires baselines that
  // belong to the previous finding identity; a late response must never touch the
  // newly opened editor.
  useEffect(() => {
    invalidatePending();
    setVerification(null);
    setBaselines({});
    setConflictState('');
  }, [lessonId, draftId, invalidatePending, setBaselines]);

  // External document replacement owns a new epoch. A pending transaction prepared
  // against the previous document is invalid even when the finding id still exists.
  useEffect(() => {
    if (previousEpoch.current === documentEpoch) return;
    previousEpoch.current = documentEpoch;
    invalidatePending('The document was replaced; the pending verification decision was cancelled.');
  }, [documentEpoch, invalidatePending]);

  // A local edit while a decision is pending invalidates the prepared transaction.
  // The server response may still be recorded remotely, so the notice keeps the
  // conflict visible instead of silently reapplying it.
  useEffect(() => {
    if (document === lastDocument.current) return;
    lastDocument.current = document;
    if (busyRef.current) {
      invalidatePending('A local edit cancelled the pending verification decision; the working document was kept.');
    }
  }, [document, invalidatePending]);

  const decide = useCallback(async (finding: VerificationFinding, decision: 'accepted' | 'rejected') => {
    const current = verificationRef.current;
    const live = documentRef.current;
    if (readOnlyRef.current) {
      setNotice('This lesson is read-only; verification decisions are disabled.');
      return false;
    }
    if (!lessonId || !draftId || !current || !live || busyRef.current) return false;
    if (decision === 'accepted') {
      const prepared = prepareFinding(live, finding, alignmentRef.current);
      if (prepared.status !== 'applied') { setNotice(prepared.reason); return false; }
    }
    const previous = findingDecision(current, finding.id);
    const wasAccepted = previous?.decision === 'accepted';
    const run = ++decisionGeneration.current;
    const startingEpoch = epochRef.current;
    const serverIdentity = {
      proposalSha256: current.proposal_sha256,
      stateToken: current.state_token,
      reportSha256: current.report_sha256,
    };
    abortDecision();
    const controller = new AbortController();
    decisionAbort.current = controller;
    setBusy(true);
    setPendingFindingId(finding.id);
    setNotice('');
    setConflict('');
    try {
      const value = await decideVerification(lessonId, draftId, serverIdentity.proposalSha256,
        serverIdentity.stateToken, serverIdentity.reportSha256, finding.id, decision,
        controller.signal);
      if (!mounted.current || run !== decisionGeneration.current
        || epochRef.current !== startingEpoch) return false;
      const parsed = parseVerificationState(value);
      if (!parsed.ok) throw new Error(parsed.message);
      setVerification(parsed.value);
      setToken(parsed.value.state_token);
      const latest = documentRef.current;
      if (!latest) return false;
      if (decision === 'accepted') {
        const revalidated = prepareFinding(latest, finding, alignmentRef.current);
        if (revalidated.status !== 'applied') {
          setNotice('The server accepted this suggestion, but the local notes changed while the '
            + 'request was pending. The document was not overwritten; save will report a conflict '
            + 'until you reconcile it.');
          return false;
        }
        setBaselines({...baselinesRef.current, [finding.id]: revalidated.baseline});
        dispatch({type: 'commands', commands: revalidated.commands, candidate: revalidated.document,
          base: latest, label: `Verification: ${finding.kind}`});
        return true;
      }
      if (wasAccepted) {
        const result = invertFinding(latest, finding, alignmentRef.current,
          baselinesRef.current[finding.id]);
        if ('reason' in result) {
          setNotice(`${result.reason} The local document was kept.`);
          return false;
        }
        dispatch({type: 'commands', commands: result.commands, candidate: result.document,
          base: latest, label: 'Verification: reverted suggestion'});
        const next = {...baselinesRef.current};
        delete next[finding.id];
        setBaselines(next);
      }
      return true;
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current
        || run !== decisionGeneration.current) return false;
      const message = cause instanceof Error ? cause.message
        : 'The verification decision could not be completed.';
      setNotice(message);
      setConflict(message);
      try {
        const value = await loadVerification(lessonId, draftId, controller.signal);
        if (!mounted.current || run !== decisionGeneration.current) return false;
        if (value === null) return false;
        const parsed = parseVerificationState(value);
        if (!parsed.ok) return false;
        setVerification(parsed.value);
        if (eventsAgree(parsed.value, documentRef.current)) {
          setToken(parsed.value.state_token);
        } else {
          setConflict('Verification changed on the server and the local notes differ. '
            + 'The save token was not advanced; review the diagnostics before saving.');
          setNotice('Verification changed on the server and the local notes differ. '
            + 'The save token was not advanced; review the diagnostics before saving.');
        }
      } catch { /* keep the original decision error visible */ }
      return false;
    } finally {
      if (decisionAbort.current === controller) decisionAbort.current = null;
      if (mounted.current && run === decisionGeneration.current) {
        setBusy(false);
        setPendingFindingId(null);
      }
    }
  }, [abortDecision, lessonId, draftId, dispatch, setNotice, setConflict, setToken, setBaselines, setBusy]);

  /** Ask the server to roll back automatic corrections under the current token. */
  const rollback = useCallback(async () => {
    const current = verificationRef.current;
    if (readOnlyRef.current) {
      setNotice('This lesson is read-only; verification rollback is disabled.');
      return false;
    }
    if (!lessonId || !draftId || !current || busyRef.current) return false;
    const run = ++decisionGeneration.current;
    const startingEpoch = epochRef.current;
    abortDecision();
    const controller = new AbortController();
    decisionAbort.current = controller;
    setBusy(true);
    setPendingFindingId(null);
    setNotice('');
    setConflict('');
    try {
      await rollbackAutomaticCorrections(lessonId, draftId, current.state_token, controller.signal);
      if (!mounted.current || run !== decisionGeneration.current
        || epochRef.current !== startingEpoch) return false;
      await load();
      return true;
    } catch (cause) {
      if (controller.signal.aborted) return false;
      if (mounted.current && run === decisionGeneration.current) {
        const message = cause instanceof Error ? cause.message
          : 'Automatic corrections could not be rolled back.';
        setNotice(message);
        setConflict(message);
      }
      return false;
    } finally {
      if (decisionAbort.current === controller) decisionAbort.current = null;
      if (mounted.current && run === decisionGeneration.current) {
        setBusy(false);
        setPendingFindingId(null);
      }
    }
  }, [abortDecision, lessonId, draftId, load, setNotice, setConflict, setBusy]);

  return {
    verification, token, busy, pendingFindingId, notice, conflict,
    acceptedBaselines, setNotice, setConflict, setToken,
    hydrate, reset, reload: load, invalidatePending, decide, rollback,
  };
}
