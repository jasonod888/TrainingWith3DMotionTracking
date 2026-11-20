/** Alignment authoring: saved map, passages, anchors, offset and anchor undo/redo. */
import {useCallback, useMemo, useState} from 'react';
import {
  addAnchor, alignmentFromSpans, applyAnchors,
  type Alignment, type AnchorPoint, type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import {
  canonicalAnchors, serializeAlignment, type SavedAlignment, type SavedSpan,
} from './save-payload';

const MIN_OFFSET = -10;
const MAX_OFFSET = 10;

function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(MIN_OFFSET, Math.min(MAX_OFFSET, value));
}

function mapFromSaved(saved: SavedAlignment | null | undefined): Alignment | null {
  if (!saved?.passages?.length) return null;
  return {
    alignment_version: 1, mode: saved.mode, basis: saved.basis,
    passages: saved.passages,
  };
}

function canonical(list: AnchorPoint[]): AnchorPoint[] {
  return canonicalAnchors(list).map(anchor => ({seconds: anchor.seconds, tick: anchor.tick}));
}

export type AlignmentHydration = {
  spans?: SavedSpan[];
  offsetSeconds?: number;
  alignment?: SavedAlignment | null;
  anchors?: AnchorPoint[];
};

export function useMusicAlignmentEditor({document, spans: initialSpans = [], offsetSeconds: initialOffset = 0,
  alignment: initialAlignment = null, anchors: initialAnchors = [], readOnly = false}: {
  document: NotationDocument | null;
  spans?: SavedSpan[];
  offsetSeconds?: number;
  alignment?: SavedAlignment | null;
  anchors?: AnchorPoint[];
  readOnly?: boolean;
}) {
  const [spans, setSpans] = useState<SavedSpan[]>(initialSpans);
  const [anchors, setAnchors] = useState<AnchorPoint[]>(canonical(initialAnchors));
  const [mapState, setMapState] = useState<Alignment | null>(mapFromSaved(initialAlignment));
  const [offsetSeconds, setOffsetState] = useState(clampOffset(initialOffset));
  const [past, setPast] = useState<{anchors: AnchorPoint[]; map: Alignment | null}[]>([]);
  const [future, setFuture] = useState<{anchors: AnchorPoint[]; map: Alignment | null}[]>([]);
  const [notice, setNotice] = useState('');

  const snapshot = useCallback(() => ({anchors, map: mapState}), [anchors, mapState]);

  const baseAlignment = useMemo<Alignment | null>(
    () => (document ? alignmentFromSpans(document, spans) : null), [document, spans]);
  const anchored = useMemo(() => {
    if (!document || !baseAlignment) return null;
    if (!anchors.length) return baseAlignment;
    const result = applyAnchors(baseAlignment, document, anchors);
    // A stale/invalid anchor list is shown through the notice below, never silently
    // dropping the last valid map.
    return result.problem ? baseAlignment : result.alignment;
  }, [document, baseAlignment, anchors]);
  const alignment = mapState ?? anchored;

  const commit = useCallback((nextAnchors: AnchorPoint[], nextMap: Alignment | null) => {
    if (readOnly) return false;
    setPast(history => [...history.slice(-19), snapshot()]);
    setFuture([]);
    setAnchors(nextAnchors);
    setMapState(nextMap);
    return true;
  }, [readOnly, snapshot]);

  const applyAnchor = useCallback((seconds: number, tick: number) => {
    if (!document || !alignment) return false;
    if (!Number.isInteger(tick) || tick < 0) { setNotice('Enter a whole tick number.'); return false; }
    const result = addAnchor(alignment, document, seconds, tick);
    if (!result.ok) { setNotice(`Not applied: ${result.message}`); return false; }
    const next = canonical([...anchors, {seconds, tick}]);
    const committed = commit(next, result.alignment);
    if (committed) setNotice(next.length ? `Anchored at ${next.length} point(s).` : 'Anchor applied.');
    return committed;
  }, [document, alignment, anchors, commit]);

  const removeAnchor = useCallback((index: number) => {
    if (!document) return false;
    const next = anchors.filter((_, position) => position !== index);
    const base = alignmentFromSpans(document, spans);
    const result = next.length ? applyAnchors(base, document, next) : {alignment: base, problem: null};
    if (result.problem) { setNotice(`Not applied: ${result.problem}`); return false; }
    const committed = commit(next, next.length ? result.alignment : null);
    if (committed) setNotice(next.length ? `Anchored at ${next.length} point(s).` : 'Reset to the estimated map.');
    return committed;
  }, [document, anchors, spans, commit]);

  const reset = useCallback(() => {
    const committed = commit([], null);
    if (committed) setNotice('Reset to the estimated map.');
    return committed;
  }, [commit]);

  const undo = useCallback(() => {
    if (!past.length) return false;
    const previous = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([snapshot(), ...future].slice(0, 20));
    setAnchors(previous.anchors); setMapState(previous.map);
    setNotice('Anchor change undone.');
    return true;
  }, [past, future, snapshot]);
  const redo = useCallback(() => {
    if (!future.length) return false;
    const [next, ...rest] = future;
    setPast([...past.slice(-19), snapshot()]);
    setFuture(rest);
    setAnchors(next.anchors); setMapState(next.map);
    setNotice('Anchor change restored.');
    return true;
  }, [past, future, snapshot]);

  const changeOffset = useCallback((value: number) => {
    setOffsetState(clampOffset(value));
  }, []);

  const replaceSpans = useCallback((next: SavedSpan[]) => {
    setSpans(next);
    setMapState(null);
  }, []);

  /**
   * Initialize one accepted load/recovery. Loading a lesson is not an edit, so this
   * never creates anchor history and never accepts or reviews anything.
   */
  const hydrate = useCallback((input: AlignmentHydration) => {
    if (input.spans !== undefined) setSpans(input.spans);
    if (input.offsetSeconds !== undefined) setOffsetState(clampOffset(input.offsetSeconds));
    if (input.alignment !== undefined) setMapState(mapFromSaved(input.alignment));
    if (input.anchors !== undefined) {
      setAnchors(canonical(input.anchors.length
        ? input.anchors
        : input.alignment?.anchors ?? []));
    } else if (input.alignment !== undefined) {
      setAnchors(canonical(input.alignment?.anchors ?? []));
    }
    setPast([]); setFuture([]); setNotice('');
  }, []);

  return {spans, anchors, mapState, alignment, offsetSeconds,
    setOffsetSeconds: changeOffset, replaceSpans, hydrate,
    notice, setNotice, savedAlignment: serializeAlignment(alignment, anchors, offsetSeconds),
    applyAnchor, removeAnchor, reset, undo, redo, canUndo: past.length > 0,
    canRedo: future.length > 0};
}
