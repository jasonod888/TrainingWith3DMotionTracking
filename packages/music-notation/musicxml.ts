/** MusicXML 4.0 partwise export for the shared notation document. */
import type { NotationDocument, NotationSegment, NotationSegmentNote } from './types';
import { keySignature, parseSpelling } from './spelling';

const TYPE_NAMES: Record<NotationSegment['value'], string> = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
  sixteenth: '16th',
  thirtysecond: '32nd',
  sixtyfourth: '64th',
};

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function pitchXml(note: NotationSegmentNote): string {
  const parsed = parseSpelling(note.spelling);
  const alter = parsed.alter === 0 ? '' : `<alter>${parsed.alter}</alter>`;
  return `<step>${parsed.letter}</step>${alter}<octave>${parsed.octave}</octave>`;
}

function tieXml(note: NotationSegmentNote): string {
  const ties: string[] = [];
  const tied: string[] = [];
  if (note.tie_from) { ties.push('<tie type="stop"/>'); tied.push('<tied type="stop"/>'); }
  if (note.tie_to) { ties.push('<tie type="start"/>'); tied.push('<tied type="start"/>'); }
  return ties.join('') + (tied.length ? `<notations>${tied.join('')}</notations>` : '');
}

function segmentXml(segment: NotationSegment): string {
  const head = `<duration>${segment.duration}</duration><voice>${segment.voice}</voice>`
    + `<type>${TYPE_NAMES[segment.value]}</type>${segment.dotted ? '<dot/>' : ''}<staff>${segment.staff === 'treble' ? 1 : 2}</staff>`;
  if (segment.rest) {
    return `<note><rest${segment.generated_rest && segment.duration === 1920 ? ' measure="yes"' : ''}/>${head}</note>`;
  }
  const notes = [...segment.notes].sort((left, right) => left.pitch - right.pitch);
  return notes.map((note, index) => {
    const accidental = note.display_accidental && note.accidental
      ? `<accidental>${note.accidental}</accidental>` : '';
    return `<note>${index > 0 ? '<chord/>' : ''}<pitch>${pitchXml(note)}</pitch>${head}${accidental}${tieXml(note)}</note>`;
  }).join('');
}


/**
 * Export a two-staff piano part. Notes are written with explicit voice and staff
 * values; ties are represented both as `<tie>` and `<tied>` so importers that
 * use either convention read them correctly.
 */
export function toMusicXML(document: NotationDocument, options: { title?: string; composer?: string } = {}): string {
  if (!document.measures.length) throw new Error('Cannot export a score without measures.');
  const title = options.title?.trim() || 'Piano lesson';
  const work = `<work><work-title>${escapeXml(title)}</work-title></work>`;
  const creator = options.composer?.trim()
    ? `<creator type="composer">${escapeXml(options.composer.trim())}</creator>` : '';
  const identification = `<identification>${creator}<encoding><software>Form piano notation</software><encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date></encoding></identification>`;
  // Build one measure at a time across both staves so <backup> stays inside the measure.
  const measures: string[] = [];
  for (let index = 0; index < document.measures.length; index += 1) {
    const measure = document.measures[index];
    let xml = `<measure number="${index + 1}">`;
    if (index === 0) {
      xml += `<attributes><divisions>${document.ppq}</divisions>`
        + `<key><fifths>${keySignature(document.key_signature).fifths}</fifths><mode>${keySignature(document.key_signature).mode}</mode></key>`
        + `<time><beats>${document.time_signature.numerator}</beats><beat-type>${document.time_signature.denominator}</beat-type></time>`
        + '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
        + `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${document.tempo.bpm}</per-minute></metronome></direction-type><sound tempo="${document.tempo.bpm}"/></direction>`;
    }
    for (const staff of ['treble', 'bass'] as const) {
      const staffNumber = staff === 'treble' ? 1 : 2;
      const segments = document.segments.filter(segment => segment.measure_index === measure.index && segment.staff === staff)
        .sort((left, right) => left.start - right.start || left.voice - right.voice || left.id.localeCompare(right.id));
      const voices = [...new Set(segments.map(segment => segment.voice))].sort();
      if (staff === 'bass') xml += `<backup><duration>${measure.duration}</duration></backup>`;
      if (!voices.length) {
        xml += `<note><rest measure="yes"/><duration>${measure.duration}</duration><voice>1</voice><type>whole</type><staff>${staffNumber}</staff></note>`;
      } else {
        voices.forEach((voice, voiceIndex) => {
          if (voiceIndex > 0) xml += `<backup><duration>${measure.duration}</duration></backup>`;
          for (const segment of segments.filter(item => item.voice === voice)) xml += segmentXml(segment);
        });
      }
    }
    if (index === document.measures.length - 1) xml += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
    measures.push(`${xml}</measure>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
${work}
${identification}
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
${measures.join('\n')}
</part>
</score-partwise>
`;
}

/** Exposed for tests and diagnostics; not part of the runtime editing surface. */
export function musicXmlSummary(xml: string): { measures: number; notes: number; backups: number; ties: number } {
  return {
    measures: (xml.match(/<measure\b/g) ?? []).length,
    notes: (xml.match(/<note>/g) ?? []).length,
    backups: (xml.match(/<backup>/g) ?? []).length,
    ties: (xml.match(/<tie\b/g) ?? []).length,
  };
}
