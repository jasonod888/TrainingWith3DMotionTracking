import {StrictMode, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Piano} from 'react-piano';
import {Fretboard, type Position} from '@moonwave99/fretboard.js';
import {SVGuitarChord} from 'svguitar';
import 'react-piano/dist/styles.css';
import './music-ui-spike.css';

const TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const PHRASE: Position[] = [
  {string: 6, fret: 3, note: 'G'},
  {string: 5, fret: 2, note: 'B'},
  {string: 4, fret: 0, note: 'D'},
];

function Spike() {
  const [highlight, setHighlight] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [width, setWidth] = useState(640);
  const guitar = useRef<HTMLDivElement>(null);
  const chord = useRef<HTMLDivElement>(null);
  const board = useRef<Fretboard | null>(null);

  useEffect(() => {
    if (!mounted || !guitar.current) return undefined;
    // Fretboard.js has no destroy API and its clear() keeps its wrapper, so reset here for
    // Strict Mode/re-mount safety before creating the next instance.
    guitar.current.innerHTML = '';
    const instance = new Fretboard({el: guitar.current, tuning: TUNING, fretCount: 12,
      height: 170, width: Math.max(300, width), showFretNumbers: true});
    instance.render();
    board.current = instance;
    return () => { instance.clear(); if (guitar.current) guitar.current.innerHTML = ''; board.current = null; };
  }, [mounted, width]);

  useEffect(() => {
    if (!board.current) return;
    board.current.setDots(highlight ? PHRASE : []);
    board.current.render();
  }, [highlight, mounted, width]);

  useEffect(() => {
    if (!mounted || !chord.current) return undefined;
    chord.current.innerHTML = '';
    const chart = new SVGuitarChord(chord.current);
    chart.configure({title: 'C'}).chord({fingers: [[6, 'x'], [5, 3], [4, 2], [3, 0], [2, 1], [1, 0]], barres: []}).draw();
    return () => { if (chord.current) chord.current.innerHTML = ''; };
  }, [mounted]);

  return <main className="spike">
    <header>
      <p className="eyebrow">UI-L0 spike · not a production route</p>
      <h1>Instrument rendering candidates</h1>
      <p>react-piano 3.1.3 · @moonwave99/fretboard.js 0.2.13 · svguitar 2.10.1. Strict Mode, no audio or sample assets.</p>
      <div className="controls">
        <button onClick={() => setHighlight(value => !value)}>Toggle highlight</button>
        <button onClick={() => setMounted(value => !value)}>{mounted ? 'Destroy diagrams' : 'Remount diagrams'}</button>
        <button onClick={() => setWidth(value => value === 640 ? 360 : 640)}>Resize ({width}px)</button>
      </div>
    </header>
    <section className="case" aria-label="Piano highlighting">
      <h2>Piano · active C4 and E4</h2>
      {mounted ? <div className="piano-wrap"><Piano noteRange={{first: 48, last: 72}}
        activeNotes={highlight ? [60, 64] : []}
        onPlayNoteInput={() => {}} onStopNoteInput={() => {}}
        playNote={() => {}} stopNote={() => {}}/></div>
        : <p className="placeholder">Piano unmounted.</p>}
    </section>
    <section className="case" aria-label="Guitar neck">
      <h2>Guitar neck · phrase markers</h2>
      <div ref={guitar} className="guitar" data-testid="guitar"/>
      {!mounted && <p className="placeholder">Guitar unmounted.</p>}
    </section>
    <section className="case" aria-label="Chord diagram">
      <h2>Hand-authored C chord</h2>
      <div ref={chord} className="chord" data-testid="chord"/>
      {!mounted && <p className="placeholder">Chord unmounted.</p>}
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Spike/></StrictMode>);
