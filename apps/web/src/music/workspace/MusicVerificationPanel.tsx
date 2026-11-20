/**
 * Verification diagnostics for the music review workspace.
 *
 * Findings, the accepted/rejected decision and the rollback request are owned by
 * `useMusicVerificationController`; this view only presents the current report and
 * emits the controller's commands. The conflict banner stays separate from ordinary
 * save notices so an invalidated verification token cannot be hidden by save state.
 */
import {findingDecision, type VerificationFinding, type VerificationState} from '../verification';

export type MusicVerificationPanelProps = {
  verification: VerificationState | null;
  busy: boolean;
  onDecide: (finding: VerificationFinding, decision: 'accepted' | 'rejected') => void;
  onRollback: () => void;
};

export function MusicVerificationPanel({verification, busy, onDecide, onRollback}: MusicVerificationPanelProps) {
  return <>
    <h2>Verification diagnostics</h2>
    {!verification ? <p className="ws-hint">No verification report is available for this proposal.</p> : <>
      <p className="ws-hint" data-verification-status>
        {verification.stale ? 'Stale report' : verification.report ? 'Report ready' : 'Report unavailable'}
        {' · '}{verification.decisions.length} decided
        {verification.conflicts.length ? ` · ${verification.conflicts.length} conflict(s)` : ''}
      </p>
      {verification.report_error && <p className="ws-hint">{verification.report_error}</p>}
      {verification.report?.findings.slice(0, 12).map(finding => {
        const decision = findingDecision(verification, finding.id);
        return <div className="ws-row" key={finding.id} data-finding={finding.id}>
          <span>{finding.kind} · {finding.explanation}</span>
          <span className="ws-hint">{decision ? decision.decision : finding.status}</span>
          <button type="button" disabled={busy} data-verification-accept={finding.id}
            onClick={() => onDecide(finding, 'accepted')}>Accept</button>
          <button type="button" disabled={busy} data-verification-reject={finding.id}
            onClick={() => onDecide(finding, 'rejected')}>Reject</button>
        </div>;
      })}
      {verification.report && verification.report.findings.length > 12
        && <p className="ws-hint">{verification.report.findings.length - 12} more findings are not shown here.</p>}
      {verification.automatic_corrections?.some(item => !item.reverted_at)
        && <p className="ws-row">
          <button type="button" disabled={busy} data-verification-rollback="true"
            onClick={onRollback}>Roll back automatic corrections</button>
        </p>}
    </>}
  </>;
}

/** Conflict/attention banner rendered in the workspace notice strip. */
export function MusicVerificationBanner({conflict, notice, needsAttention, onReviewIssues}: {
  conflict: string;
  notice: string;
  needsAttention: boolean;
  onReviewIssues: () => void;
}) {
  return <>
    {conflict && <span className="ws-report is-bad" data-verification-conflict="true">
      {conflict}
    </span>}
    {notice && notice !== conflict && <span className="ws-report">{notice}</span>}
    {needsAttention && <span className="ws-report is-bad" data-verification-notice="true">
      Verification needs attention.
      <button type="button" onClick={onReviewIssues}>Review issues</button>
    </span>}
  </>;
}
