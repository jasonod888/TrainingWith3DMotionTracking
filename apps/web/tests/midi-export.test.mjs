import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportPerformanceToMidi} from '../src/music/midi-export.ts';

const readVar = (data, start) => {
  let index = start, value = 0;
  for (;;) {
    const byte = data[index++];
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, index];
  }
};

const parseEvents = (bytes) => {
  assert.equal(String.fromCharCode(...bytes.slice(14, 18)), 'MTrk');
  const length = (bytes[18] << 24) | (bytes[19] << 16) | (bytes[20] << 8) | bytes[21];
  const data = bytes.slice(22, 22 + length);
  const events = [];
  let index = 0, tick = 0;
  while (index < data.length) {
    const [delta, afterDelta] = readVar(data, index);
    index = afterDelta;
    tick += delta;
    const status = data[index++];
    if (status === 0xff) {
      const type = data[index++];
      const [metaLength, afterLength] = readVar(data, index);
      index = afterLength + metaLength;
      events.push({tick, type: 'meta', meta: type});
      if (type === 0x2f) break;
      continue;
    }
    if (status === 0x90 || status === 0x80) {
      const pitch = data[index++], velocity = data[index++];
      events.push({tick, type: status === 0x90 ? 'on' : 'off', pitch, velocity});
    } else if (status === 0xb0) {
      const controller = data[index++], value = data[index++];
      events.push({tick, type: 'cc', controller, value});
    } else if (status === 0xc0) {
      const program = data[index++];
      events.push({tick, type: 'program', program});
    } else {
      throw new Error(`Unexpected MIDI status ${status}`);
    }
  }
  return events;
};

test('exports a valid Format 0 piano track with notes and pedal CC', () => {
  const bytes = exportPerformanceToMidi([
    {id: 'a', pitch: 60, onset: 1, duration: 0.5, velocity: 0.8},
    {id: 'b', pitch: 64, onset: 1.5, duration: 0.25, velocity: 0.5},
  ], [{onset: 0.5, offset: 2}]);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  assert.equal((bytes[8] << 8) | bytes[9], 0, 'Format 0');
  assert.equal((bytes[10] << 8) | bytes[11], 1, 'one track');
  assert.equal((bytes[12] << 8) | bytes[13], 480);
  const events = parseEvents(bytes);
  const on = events.find(event => event.type === 'on' && event.pitch === 60);
  const off = events.find(event => event.type === 'off' && event.pitch === 60);
  assert.equal(on?.tick, 960);
  assert.equal(off?.tick, 1440);
  assert.ok(events.some(event => event.type === 'cc' && event.controller === 64 && event.value === 127));
  assert.ok(events.some(event => event.type === 'cc' && event.controller === 64 && event.value === 0));
  assert.ok(events.some(event => event.type === 'program' && event.program === 0));
});

test('reflects pitch and onset edits immediately and filters ghost blips', () => {
  const before = parseEvents(exportPerformanceToMidi([
    {id: 'note', pitch: 60, onset: 1, duration: 0.5, velocity: 0.7},
  ]));
  const after = parseEvents(exportPerformanceToMidi([
    {id: 'note', pitch: 67, onset: 2, duration: 0.5, velocity: 0.7},
  ]));
  assert.ok(before.some(event => event.type === 'on' && event.pitch === 60 && event.tick === 960));
  assert.ok(after.some(event => event.type === 'on' && event.pitch === 67 && event.tick === 1920));
  const filtered = parseEvents(exportPerformanceToMidi([
    {id: 'ghost', pitch: 72, onset: 0, duration: 0.05, velocity: 0.2},
    {id: 'real', pitch: 60, onset: 0.1, duration: 0.05, velocity: 0.5},
  ]));
  assert.ok(!filtered.some(event => event.type === 'on' && event.pitch === 72));
  assert.ok(filtered.some(event => event.type === 'on' && event.pitch === 60));
});

test('caps overlapping same-pitch notes and orders NoteOff before NoteOn', () => {
  const events = parseEvents(exportPerformanceToMidi([
    {id: 'first', pitch: 60, onset: 0, duration: 1, velocity: 0.7},
    {id: 'second', pitch: 60, onset: 0.5, duration: 0.5, velocity: 0.7},
  ]));
  const firstOff = events.find(event => event.type === 'off' && event.pitch === 60);
  const secondOn = events.find(event => event.type === 'on' && event.pitch === 60 && event.tick === 480);
  assert.ok(firstOff && secondOn);
  assert.ok(firstOff.tick <= secondOn.tick);
  assert.ok(events.indexOf(firstOff) < events.indexOf(secondOn));
});

test('raw pedal events become CC64 switches', () => {
  const events = parseEvents(exportPerformanceToMidi([], [
    {onset_seconds: 1, value: 1}, {onset_seconds: 2, value: 0},
  ]));
  assert.ok(events.some(event => event.type === 'cc' && event.tick === 960 && event.value === 127));
  assert.ok(events.some(event => event.type === 'cc' && event.tick === 1920 && event.value === 0));
});
