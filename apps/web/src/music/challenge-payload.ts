import type {MusicAssessmentReport} from '../../../../packages/music-engine/assessment';

/**
 * Explicit-save payload for a whole-piece live MIDI challenge report.
 * It never contains a score: the experimental policy withholds one.
 */
export function challengeAttemptPayload(report:MusicAssessmentReport, input:{
  id:string;
  revisionId:string;
  referenceSha256:string;
  duration:number;
  inputMode:'midi'|'microphone';
}) {
  if (report.score !== null) throw new Error('An experimental challenge report cannot contain a score.');
  if (!Number.isFinite(input.duration) || input.duration <= 0) throw new Error('A challenge report needs a positive duration.');
  return {
    report_version: 2 as const,
    status: 'insufficient-evidence' as const,
    id: input.id,
    save_requested: true as const,
    revision_id: input.revisionId,
    reference_sha256: input.referenceSha256,
    rubric_version: report.rubricVersion,
    scorer_version: report.scorerVersion,
    subject: 'piano' as const,
    input_mode: input.inputMode,
    speed: 1 as const,
    policy_qualified: false as const,
    score: null,
    score_reason: report.scoreReason,
    start: 0,
    end: input.duration,
    offset_seconds: report.offsetSeconds,
    alignment: {
      offset_seconds: report.offsetSeconds,
      offset_real_seconds: report.offsetRealSeconds,
      ambiguous: report.ambiguous,
      support: report.support,
      peak_separation_seconds: report.peakSeparationSeconds,
    },
    coverage: {
      reference: report.referenceCoverage,
      capture: report.captureCoverage,
      support: report.support,
    },
    counts: {
      expected_required: report.expectedRequired,
      assessed_required: report.assessedRequired,
      matched_required: report.matchedRequired,
      matched_optional: report.matchedOptional,
      missing_required: report.missingRequired,
      extra: report.extra,
      unassessed_required: report.unassessedRequired,
      outside_attacks: report.outsideAttacks,
    },
    timing: {
      available: report.timing.available,
      confidence: report.timing.confidence,
      matches: report.timing.matches,
      mean_absolute_error_seconds: report.timing.meanAbsoluteErrorSeconds,
      score: report.timing.score,
      on_time: report.timing.onTime,
      early: report.timing.early,
      late: report.timing.late,
    },
    sections: report.sections.map(section => ({
      id: section.id, label: section.label, start: section.start, end: section.end,
      expected_required: section.expectedRequired, assessed_required: section.assessedRequired,
      matched_required: section.matchedRequired, missing_required: section.missingRequired,
      extra: section.extra, reference_coverage: section.referenceCoverage, recall: section.recall,
      timing: {
        available: section.timing.available, confidence: section.timing.confidence,
        matches: section.timing.matches, mean_absolute_error_seconds: section.timing.meanAbsoluteErrorSeconds,
        score: section.timing.score, on_time: section.timing.onTime, early: section.timing.early, late: section.timing.late,
      },
    })),
    latency_measured: report.latencyMeasured,
    input_latency_ms: report.inputLatencyMs,
    model_profile: report.modelProfile,
  };
}
