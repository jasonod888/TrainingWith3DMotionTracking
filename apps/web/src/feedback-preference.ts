import {useCallback, useEffect, useState} from 'react';

const PREFIX = 'form.feedback.enabled.';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readPreference(lessonId: string): boolean {
  try {
    const value = storage()?.getItem(PREFIX + lessonId);
    return value === null || value === undefined ? true : value === 'true';
  } catch {
    // Storage denial must not silently turn feedback off; use the default On.
    return true;
  }
}

function writePreference(lessonId: string, enabled: boolean): void {
  try {
    storage()?.setItem(PREFIX + lessonId, String(enabled));
  } catch {
    // A session-only preference is still better than changing the learner's choice.
  }
}

/** Feedback is On by default; only an explicit learner choice persists Off or On. */
export function useFeedbackPreference(lessonId: string): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(() => readPreference(lessonId));
  useEffect(() => { setEnabled(readPreference(lessonId)); }, [lessonId]);
  const update = useCallback((next: boolean) => {
    setEnabled(next);
    writePreference(lessonId, next);
  }, [lessonId]);
  return [enabled, update];
}
