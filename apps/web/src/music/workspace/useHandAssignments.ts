import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  baselineHandEstimates, handPerformanceFingerprint, resolveHandAssignments,
  type HandAssignment, type HandConfidence, type ModelHandEstimate, type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import {request} from '../../api';

export type HandModelStatus = 'baseline' | 'loading' | 'model' | 'unavailable' | 'too-many';
type ModelPrediction = {id: string; hand: 'left' | 'right' | null; raw_score: number | null; status: string};
type ModelResponse = {
  ok: true; performance_fingerprint: string;
  model: {name: string; version: string; sha256: string};
  predictions: ModelPrediction[];
};

export function useHandAssignments(document: NotationDocument | null, lessonId: string | null,
  enabled: boolean) {
  const fingerprint = useMemo(() => document ? handPerformanceFingerprint(document.performance) : '',
    [document]);
  const performance = useMemo(() => document?.performance ?? [], [fingerprint]);
  const [model, setModel] = useState<{fingerprint: string; estimates: Record<string, ModelHandEstimate>} | null>(null);
  const [modelInfo, setModelInfo] = useState<{name: string; version: string; sha256: string} | null>(null);
  const [status, setStatus] = useState<HandModelStatus>('baseline');
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken(value => value + 1), []);

  useEffect(() => {
    if (!fingerprint) {
      setModel(null);
      setModelInfo(null);
      setStatus('baseline');
      return;
    }
    if (!enabled || !lessonId) {
      setModel(null);
      setModelInfo(null);
      setStatus('baseline');
      return;
    }
    if (performance.length > 20000) {
      setModel(null);
      setModelInfo(null);
      setStatus('too-many');
      return;
    }
    const requestedFingerprint = fingerprint;
    const events = performance.map(note => ({
      id: note.id, onset: note.onset, duration: note.duration, pitch: note.pitch,
    }));
    let cancelled = false;
    const controller = new AbortController();
    setStatus('loading');
    const timer = setTimeout(() => {
      void request<ModelResponse>(`/lessons/${encodeURIComponent(lessonId)}/hand-estimates`, 'POST',
        {events}, false, {}, controller.signal)
        .then(response => {
          if (cancelled) return;
          if (!response || response.performance_fingerprint !== requestedFingerprint) {
            setModel(null);
            setModelInfo(null);
            setStatus('unavailable');
            return;
          }
          const estimates: Record<string, ModelHandEstimate> = {};
          for (const prediction of response.predictions) {
            if (prediction.status !== 'predicted' || !prediction.hand) continue;
            estimates[prediction.id] = {
              hand: prediction.hand,
              confidence: 'ambiguous' as HandConfidence,
              model: {name: response.model.name, version: response.model.version},
              plausible: true,
              score: prediction.raw_score ?? undefined,
            };
          }
          setModel({fingerprint: requestedFingerprint, estimates});
          setModelInfo(response.model);
          setStatus('model');
        })
        .catch((cause: unknown) => {
          if (cancelled || controller.signal.aborted
            || (cause instanceof Error && cause.name === 'AbortError')) return;
          setModel(null);
          setModelInfo(null);
          setStatus('unavailable');
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, fingerprint, lessonId, performance, refreshToken]);

  const assignments = useMemo<Record<string, HandAssignment>>(() => {
    if (!document) return {};
    const estimates = model?.fingerprint === fingerprint ? model.estimates : {};
    return resolveHandAssignments(document, estimates);
  }, [document, fingerprint, model]);
  const baseline = useMemo(() => document ? baselineHandEstimates(document.performance) : {},
    [document]);
  return {assignments, baseline, status, refresh, modelInfo};
}
