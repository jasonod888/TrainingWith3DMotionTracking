import {BODY_CAPABILITIES, MUSIC_CAPABILITIES, type CapabilitySupport, type PracticeCapabilities} from './practice-capabilities';

/**
 * Canonical learning experience modes, separate from runtime progression
 * (sections/continuous) and from subject audio source (Original/Piano/WAV).
 */
export type ExperienceMode = 'watch' | 'practice' | 'challenge';
export type ExperienceModeSupport = CapabilitySupport;

export type ExperienceModeCapabilities = {
  watch: ExperienceModeSupport;
  practice: ExperienceModeSupport;
  challenge: ExperienceModeSupport;
  /** Shown as the disabled reason/status label for Challenge. */
  challengeReason?: string;
  challengeStatus?: string;
};

export const EXPERIENCE_MODES: readonly {id: ExperienceMode; label: string}[] = [
  {id: 'watch', label: 'Watch'},
  {id: 'practice', label: 'Practice'},
  {id: 'challenge', label: 'Challenge'},
];

/**
 * Derive all mode availability from the existing practice capability truth.
 * A future subject Challenge only changes `PracticeCapabilities.challenge` once;
 * the shared metadata below supplies the discoverable coming-soon presentation.
 */
export function experienceModeCapabilitiesFrom(
  capabilities: Pick<PracticeCapabilities, 'challenge'>,
): ExperienceModeCapabilities {
  return {
    watch: 'supported',
    practice: 'supported',
    challenge: capabilities.challenge,
    ...(capabilities.challenge === 'unsupported' ? {
      challengeStatus: 'Coming soon',
      challengeReason: 'Challenge is coming soon for this subject.',
    } : {}),
  };
}

/** Convenience adapters; both derive from the same practice capability constants. */
export const BODY_EXPERIENCE_CAPABILITIES = experienceModeCapabilitiesFrom(BODY_CAPABILITIES);
export const MUSIC_EXPERIENCE_CAPABILITIES = experienceModeCapabilitiesFrom(MUSIC_CAPABILITIES);

export type ExperienceModeOption = {
  id: ExperienceMode;
  label: string;
  available: boolean;
  status?: string;
  reason?: string;
};

export function experienceModeOptions(capabilities: ExperienceModeCapabilities): ExperienceModeOption[] {
  return EXPERIENCE_MODES.map(mode => {
    const support = capabilities[mode.id];
    return {
      ...mode,
      available: support === 'supported',
      ...(mode.id === 'challenge' && capabilities.challengeStatus
        ? {status: capabilities.challengeStatus} : {}),
      ...(mode.id === 'challenge' && capabilities.challengeReason
        ? {reason: capabilities.challengeReason} : {}),
    };
  });
}

/** Single compatibility adapter for legacy routes that still call Challenge “compete”. */
export function experienceModeToLegacy(mode: ExperienceMode): 'watch' | 'practice' | 'compete' {
  return mode === 'challenge' ? 'compete' : mode;
}

export function legacyModeToExperience(mode: 'watch' | 'practice' | 'compete'): ExperienceMode {
  return mode === 'compete' ? 'challenge' : mode;
}
