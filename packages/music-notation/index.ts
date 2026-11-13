export * from './types';
export * from './spelling';
export * from './rhythm';
export * from './build';
export * from './edit';
export * from './correction';
export * from './alignment';
export * from './parse';
export * from './musicxml';

import type { NotationDocument, NotationSegment, NotationStaff } from './types';

export function segmentsForMeasure(document: NotationDocument, measureIndex: number): NotationSegment[] {
  return document.segments.filter(segment => segment.measure_index === measureIndex);
}

export function segmentsForStaff(document: NotationDocument, staff: NotationStaff): NotationSegment[] {
  return document.segments.filter(segment => segment.staff === staff);
}

export function documentNoteCount(document: NotationDocument): number {
  return document.events.reduce((total, event) => total + event.notes.length, 0);
}

export function documentRestCount(document: NotationDocument): number {
  return document.segments.filter(segment => segment.rest).length;
}

export function measureLabel(document: NotationDocument, measureIndex: number): string {
  return `Measure ${measureIndex + 1} of ${document.measures.length}`;
}
