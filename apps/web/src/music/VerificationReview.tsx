import type {VerificationDecision, VerificationFinding, VerificationState} from './verification';
import {findingDecision} from './verification';

const KIND: Record<string, string> = {
  onset_shift: 'Timing',
  missed_repetition: 'Repeated strike',
  duplicate_event: 'One strike?',
  missing_pitch: 'Possible missing note',
  extra_pitch: 'Possible extra note',
  octave_ambiguity: 'Octave uncertainty',
  wrong_pitch: 'Possible wrong pitch',
  unmatched_attack: 'Unmatched attack',
  timeline: 'Timeline',
};
const STATUS: Record<VerificationFinding['status'], string> = {
  suggested: 'Suggested change', unresolved: 'Uncertain', flagged: 'Warning',
};
const REPORT_ERRORS: Record<string, string> = {
  'missing-artifact': 'The retained analysis expired or was removed.',
  'no-verification': 'This draft has no retained verification report.',
  'identity-mismatch': 'The retained report does not match this recording.',
  'invalid-report': 'The retained report could not be read.',
  'artifact-too-large': 'The retained analysis artifact exceeds its review limit.',
  'report-too-large': 'The retained report exceeds its review limit.',
  unavailable: 'Verification was unavailable for this draft.',
};
const PITCH_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const noteName = (pitch: number) => `${PITCH_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

function evidenceLine(finding: VerificationFinding) {
  const parts: string[] = [];
  const gain = finding.evidence.gain;
  const unexplained = finding.evidence.unexplained;
  const attack = finding.evidence.attack_sharp ?? finding.evidence.attack;
  if (typeof gain === 'number') parts.push(`audio explanation +${gain.toFixed(2)}`);
  if (typeof unexplained === 'number') parts.push(`${Math.round(unexplained * 100)}% unexplained`);
  if (typeof attack === 'number') parts.push(`attack ${attack.toFixed(1)}`);
  return parts.join(' · ');
}

function editSummary(edit: VerificationFinding['proposed_edits'][number]) {
  const before = edit.before as Record<string, unknown> | null;
  const after = edit.after as Record<string, unknown>;
  if (edit.op === 'set_onset') return `Start ${Number(before?.onset).toFixed(2)}s → ${Number(after.onset).toFixed(2)}s`;
  if (edit.op === 'set_pitch') return `Pitch ${noteName(Number(before?.pitch))} → ${noteName(Number(after.pitch))}`;
  if (edit.op === 'delete_note') return 'Remove this proposed note';
  if (edit.op === 'add_note') return `Add ${noteName(Number(after.pitch))} at ${Number(after.onset).toFixed(2)}s`;
  if (edit.op === 'merge') return 'Join the two proposed events into one strike';
  if (edit.op === 'split_note') return 'Split the proposed event into two strikes';
  return edit.op;
}

function decisionLabel(decision: VerificationDecision) {
  return decision.decision === 'accepted' ? 'Accepted' : 'Dismissed';
}

export function VerificationReview({state, busy, selected, eventNumbers, hasVideo, playing, baselineCount,
                                    onSelect, onDecision, onPlay, onStop, onAudition}:{
  state: VerificationState; busy: boolean; selected: string | null;
  eventNumbers: Record<string, number>; hasVideo: boolean; playing: boolean; baselineCount: number;
  onSelect: (finding: VerificationFinding) => void;
  onDecision: (findingId: string, decision: 'accepted' | 'rejected' | 'cleared',
               finding?: VerificationFinding) => void;
  onPlay: (finding: VerificationFinding) => void;
  onStop: () => void;
  onAudition: (finding: VerificationFinding, proposed: boolean) => void;
}) {
  const report = state.report;
  const findings = report?.findings ?? [];
  const orphans = state.decisions.filter(decision => !findings.some(finding => finding.id === decision.finding_id));
  const accepted = state.decisions.filter(item => item.decision === 'accepted').length;
  const automaticIds = new Set((state.automatic_corrections ?? [])
    .filter(item => !item.reverted_at).map(item => item.finding_id));
  const pending = findings.filter(finding => !findingDecision(state, finding.id) &&
    !automaticIds.has(finding.id)).length;
  const action = (finding: VerificationFinding, decision: 'accepted' | 'rejected' | 'cleared') => () =>
    onDecision(finding.id, decision, finding);
  const undoDecision = (decision: VerificationDecision) => () => {
    const finding = findings.find(item => item.id === decision.finding_id);
    onDecision(decision.finding_id, 'cleared', finding);
  };
  return <section className="verification-panel" aria-label="Automatic transcription verification">
    <div className="verification-head">
      <div>
        <h2>Automatic verification</h2>
        <p className="small muted">Findings compare the proposed notes with the recording. A suggestion is not applied unless you accept it. The original proposal stays available.</p>
      </div>
      <div className="verification-counts" role="status">
        <span>{findings.length} finding{findings.length === 1 ? '' : 's'}</span>
        <span>{pending} awaiting review</span>
        <span>{accepted} accepted</span>
        {report && <span className="small muted">verifier {report.verifier_version}</span>}
      </div>
    </div>
    <p className="small muted">Baseline proposal: {baselineCount} notes (retained unchanged). Working proposal: {state.events.length} notes. Accepted suggestions apply only to the working proposal.</p>
    {state.stale && state.available && <p className="inline-notice warning-notice" role="alert">The proposal changed after this report was generated. Reopen the review to verify it again; these suggestions cannot be applied.</p>}
    {!state.available && <p className="inline-notice warning-notice" role="alert">
      {REPORT_ERRORS[state.report_error ?? 'unavailable'] ?? 'Diagnostic verification evidence is unavailable.'} Accepted suggestions and their provenance remain in the working proposal.
    </p>}
    {state.report?.status && state.report.status !== 'complete' && <p className="inline-notice warning-notice" role="status">
      Verification did not analyse every passage in this recording. Unchecked passages have not passed verification.
    </p>}
    {report?.correction_policy?.mode === 'qualified' && <p className="small muted" role="status">
      Qualified correction policy {report.correction_policy.policy_version ?? 'unknown'}: {report.correction_policy.enabled_categories.length} enabled {report.correction_policy.enabled_categories.length === 1 ? 'category' : 'categories'}; {report.correction_policy.withheld_count ?? 0} withheld.
    </p>}
    {state.report?.warnings && state.report.warnings.length > 0 && <ul className="verification-warnings small muted">
      {state.report.warnings.slice(0, 6).map((warning, index) => <li key={index}>{warning}</li>)}
    </ul>}
    {state.invalid_working && <p className="inline-notice error-notice" role="alert">Accepted changes could not be reapplied without an invalid note. Undo the affected suggestions and review the notes.</p>}
    {state.conflicts.length > 0 && <p className="inline-notice warning-notice" role="alert">{state.conflicts.length} accepted suggestion{state.conflicts.length === 1 ? '' : 's'} could not be applied because another change replaced its notes.</p>}
    {!report ? <div className="verification-unavailable">
      {state.decisions.length === 0 ? <p>No diagnostic findings were retained for this draft.</p> :
        <ul className="verification-decisions">
          {state.decisions.map(decision => <li key={decision.finding_id}>
            <span className={`verification-decision is-${decision.decision}`}>{decisionLabel(decision)}</span>
            <span>{decision.finding ? `${KIND[decision.finding.kind] ?? decision.finding.kind} · ${decision.finding.explanation}` : decision.finding_id}</span>
            {decision.finding?.pitch !== null && decision.finding?.pitch !== undefined && <span className="small muted">{noteName(decision.finding.pitch)}</span>}
            <button type="button" disabled={busy || state.stale} onClick={undoDecision(decision)}>Undo</button>
          </li>)}
        </ul>}
    </div> : findings.length === 0 ? <p role="status">No disagreements were found in the analysed passages.</p> : <ol className="verification-list">
      {findings.map(finding => {
        const decision = findingDecision(state, finding.id);
        const earlier = !!(decision?.report_sha256 && state.report_sha256 &&
          decision.report_sha256 !== state.report_sha256);
        const linked = finding.event_ids.map(id => eventNumbers[id]).filter((value): value is number => !!value);
        const isSelected = selected === finding.id;
        const automatic = automaticIds.has(finding.id);
        const canAccept = finding.status === 'suggested' && finding.proposed_edits.length > 0 &&
          finding.correction_status !== 'withheld' && !automatic &&
          (report?.mode !== 'qualified' || finding.correction_status === 'qualified');
        return <li key={finding.id} className={isSelected ? 'is-selected' : undefined}>
          <button type="button" className="verification-select" aria-pressed={isSelected}
                  onClick={() => onSelect(finding)}>
            <span className="verification-title">
              <span className={`verification-status is-${finding.status}`}>{STATUS[finding.status]}</span>
              <strong>{KIND[finding.kind] ?? finding.kind}</strong>
              <span className="small muted">{finding.time_range[0].toFixed(2)}–{finding.time_range[1].toFixed(2)}s</span>
              {finding.pitch !== null && <span className="small muted">{noteName(finding.pitch)}</span>}
              {linked.length > 0 && <span className="small muted">note{linked.length === 1 ? '' : 's'} {linked.join(', ')}</span>}
            </span>
            <span className="verification-explanation">{finding.explanation}</span>
            {finding.correction_status === 'qualified' &&
              <span className="verification-status is-suggested">Qualified correction</span>}
            {finding.correction_status === 'withheld' &&
              <span className="verification-status is-unresolved">Correction withheld</span>}
            {finding.withheld_reason &&
              <span className="small muted verification-reasons">{finding.withheld_reason}</span>}
            {automatic &&
              <span className="verification-status is-suggested">Applied automatically to the working notes</span>}
            {finding.proposed_edits.length > 0 && <span className="small verification-edits">
              {finding.proposed_edits.map((edit, editIndex) => <span key={editIndex} className="verification-edit">{editSummary(edit)}</span>)}
            </span>}
            {finding.ambiguous && finding.ambiguity_reasons.length > 0 &&
              <span className="small muted verification-reasons">Why uncertain: {finding.ambiguity_reasons.join(' ')}</span>}
            {evidenceLine(finding) && <span className="small muted verification-evidence">{evidenceLine(finding)}</span>}
          </button>
          <div className="verification-actions">
            <button type="button" disabled={busy || !hasVideo} onClick={() => onPlay(finding)}>
              {playing ? 'Restart context' : 'Play context'}
            </button>
            <button type="button" disabled={busy} onClick={() => onAudition(finding, false)}>Audition now</button>
            {finding.proposed_edits.length > 0 &&
              <button type="button" disabled={busy} onClick={() => onAudition(finding, true)}>Audition proposed</button>}
            {playing && <button type="button" disabled={busy} onClick={onStop}>Stop playback</button>}
            {decision === undefined && canAccept &&
              <button type="button" className="primary" disabled={busy || state.stale || !state.available} onClick={action(finding, 'accepted')}>Accept suggestion</button>}
            {decision === undefined && !automatic &&
              <button type="button" disabled={busy || state.stale || !state.available} onClick={action(finding, 'rejected')}>Dismiss</button>}
            {decision !== undefined && <>
              <span className={`verification-decision is-${decision.decision}`}>
                {decisionLabel(decision)}{decision.decided_at ? ` ${new Date(decision.decided_at).toLocaleString()}` : ''}
              </span>
              {earlier && <span className="small muted">Recorded against an earlier report; its stored edit is still applied. Undo it if this finding changed.</span>}
              <button type="button" disabled={busy || state.stale} onClick={action(finding, 'cleared')}>Undo</button>
            </>}
          </div>
        </li>;
      })}
    </ol>}
    {report && orphans.length > 0 && <div className="verification-unavailable">
      <p className="small muted">These decisions refer to findings from an earlier report. Their stored edits remain applied; undo them before re-accepting if the finding was regenerated.</p>
      <ul className="verification-decisions">
        {orphans.map(decision => <li key={decision.finding_id}>
          <span className={`verification-decision is-${decision.decision}`}>{decisionLabel(decision)}</span>
          <span>{decision.finding ? `${KIND[decision.finding.kind] ?? decision.finding.kind} · ${decision.finding.explanation}` : decision.finding_id}</span>
          <button type="button" disabled={busy || state.stale}
                  onClick={() => onDecision(decision.finding_id, 'cleared')}>Undo</button>
        </li>)}
      </ul>
    </div>}
    <p className="small muted">Original proposal and revised proposal are separate. Accepting writes only to your unreviewed working copy; saving the reviewed reference stays a separate confirmed step. Accepting or undoing merges the change into the current working notes; unrelated manual edits are preserved.</p>
  </section>;
}
