/**
 * Honest action labels derived from Act identity and resolved capabilities.
 *
 * "music = Preview only" and "body = 3D movement" are implementation assumptions,
 * not capabilities. Guitar practises but has no challenge; piano may offer both.
 */
import type {CapabilitySet} from '../../../../packages/learning-engine/act-capabilities';

export type CallToAction = {label: string; disabled: boolean; reason: string};

/** Practice CTA for the watch screen. */
export function practiceCta(capabilities?: CapabilitySet | null): CallToAction {
  if (!capabilities) return {label: 'Practice', disabled: false, reason: ''};
  const result = capabilities.canPractice;
  if (result.available) return {label: 'Practice', disabled: false, reason: ''};
  return {
    label: result.reasonCode === 'missing_source' ? 'Watch only' : 'Practice unavailable',
    disabled: true,
    reason: result.explanation,
  };
}

/**
 * Music feed badge. Guitar never advertises a challenge even when the deployment
 * flag is on, because the Act itself has no challenge mode.
 */
export function musicFeedBadge(input: {
  subject?: string | null;
  challengeEnabled?: boolean;
  check?: boolean;
}): string {
  if (input.check) return 'Ready to check';
  if (input.subject === 'piano' && input.challengeEnabled) return 'Practice + challenge';
  return 'Practice';
}
