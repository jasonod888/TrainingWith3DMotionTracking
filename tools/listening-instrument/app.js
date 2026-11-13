'use strict';

// Internal development instrument. The page loads an opaque browser manifest: candidate
// assets have neutral names and no roles. Role decoding lives in the analyst manifest, and a
// session records only its rotation index.
//
// Saved progress is bound to the analyst manifest hash, the instrument version, the listener
// and the rotation, so ratings can never be carried into a different study.

import {
  INSTRUMENT_VERSION, progressKey, rotationFor, sessionPayload, validateProgress,
} from './protocol.js';

const BLOCK_SIZE = 6;

const state = {
  study: null,
  browserSha: null,
  analystSha: null,
  listenerId: null,
  equipment: null,
  rotationIndex: 0,
  rotation: null,
  order: [],
  index: 0,
  ratings: {},
  startedAt: null,
};

const el = (id) => document.getElementById(id);

// Raw sum of UTF-16 code units is implemented in protocol.js so node can test it.

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function labelFor(index) {
  return String.fromCharCode(65 + index);
}

function ratingKey(itemId, labelIndex) {
  return `${itemId}|${labelIndex}`;
}

function storageKey() {
  return progressKey(state.analystSha, state.listenerId);
}

function persist() {
  const payload = {
    instrumentVersion: INSTRUMENT_VERSION,
    studySha: state.analystSha,
    rotation: state.rotationIndex,
    listenerId: state.listenerId,
    equipment: state.equipment,
    index: state.index,
    ratings: state.ratings,
    startedAt: state.startedAt,
  };
  localStorage.setItem(storageKey(), JSON.stringify(payload));
}

function restore() {
  const raw = localStorage.getItem(storageKey());
  if (!raw) return false;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch (error) {
    localStorage.removeItem(storageKey());
    return false;
  }
  const result = validateProgress(saved, {
    analystSha: state.analystSha,
    version: INSTRUMENT_VERSION,
    rotation: state.rotationIndex,
    listenerId: state.listenerId,
    items: state.study.items,
    itemOrderLength: state.order.length,
  });
  if (!result.ok) {
    localStorage.removeItem(storageKey());
    return false;
  }
  state.ratings = result.ratings;
  state.index = result.index;
  state.startedAt = result.startedAt || new Date().toISOString();
  state.equipment = result.equipment || state.equipment;
  return true;
}

function show(section) {
  for (const id of ['setup', 'session', 'break', 'done']) {
    el(id).classList.toggle('hidden', id !== section);
  }
}

function renderInstructions() {
  const parts = [];
  const question = document.createElement('p');
  question.className = 'question';
  question.textContent = state.study.question;
  parts.push(question);
  const list = document.createElement('ul');
  for (const anchor of state.study.scale) {
    const entry = document.createElement('li');
    entry.textContent = `${anchor.value} — ${anchor.label}`;
    list.appendChild(entry);
  }
  parts.push(list);
  const boundary = document.createElement('p');
  boundary.className = 'muted';
  boundary.textContent =
    'Scores are your similarity judgements, not a probability that the two are identical. ' +
    `Session cap: ${state.study.bounds.max_session_minutes} minutes.`;
  parts.push(boundary);
  el('instructions').replaceChildren(...parts);
}

function currentItem() {
  return state.study.items[state.order[state.index]];
}

function currentLabels(item) {
  return state.rotation.label_order[item.item_id];
}

function renderItem() {
  const item = currentItem();
  const labels = currentLabels(item);
  const container = el('item');
  container.replaceChildren();

  el('progress').textContent =
    `Excerpt ${state.index + 1} of ${state.order.length} — ${item.title}`;

  const reference = document.createElement('div');
  reference.className = 'reference';
  const heading = document.createElement('h3');
  heading.textContent = 'Reference';
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'auto';
  audio.src = item.reference.file;
  reference.append(heading, audio);
  container.appendChild(reference);

  const question = document.createElement('p');
  question.className = 'question';
  question.textContent = state.study.question;
  container.appendChild(question);

  labels.forEach((candidateIndex, labelIndex) => {
    const candidate = item.candidates[candidateIndex];
    const card = document.createElement('section');
    card.className = 'candidate';

    const header = document.createElement('header');
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = labelFor(labelIndex);
    const hint = document.createElement('span');
    hint.className = 'muted';
    hint.textContent = 'anonymous candidate';
    header.append(label, hint);

    const player = document.createElement('audio');
    player.controls = true;
    player.preload = 'auto';
    player.src = candidate.file;

    const sliderRow = document.createElement('div');
    sliderRow.className = 'slider-row';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    const value = document.createElement('output');
    value.className = 'value';
    value.textContent = '—';
    sliderRow.append(slider, value);

    const anchors = document.createElement('ul');
    anchors.className = 'anchors';
    for (const anchor of state.study.scale) {
      const entry = document.createElement('li');
      entry.textContent = `${anchor.value}: ${anchor.label}`;
      anchors.appendChild(entry);
    }

    const notes = document.createElement('textarea');
    notes.placeholder = 'Optional: notes and timing';
    const expression = document.createElement('textarea');
    expression.placeholder = 'Optional: expression and pedal';
    const tone = document.createElement('textarea');
    tone.placeholder = 'Optional: tone and room';

    const confidence = document.createElement('select');
    for (const [textValue, text] of [['', 'Confidence (optional)'], ['1', '1 guessing'],
      ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5 certain']]) {
      const option = document.createElement('option');
      option.value = textValue;
      option.textContent = text;
      confidence.appendChild(option);
    }

    card.append(header, player, sliderRow, anchors, notes, expression, tone, confidence);
    container.appendChild(card);

    const key = ratingKey(item.item_id, labelIndex);
    const stored = state.ratings[key];
    if (stored) {
      slider.dataset.touched = 'true';
      slider.value = String(stored.score);
      value.textContent = String(stored.score);
      notes.value = stored.notes_timing || '';
      expression.value = stored.expression_pedal || '';
      tone.value = stored.tone_room || '';
      confidence.value = stored.confidence || '';
    }
    slider.addEventListener('input', () => {
      slider.dataset.touched = 'true';
      value.textContent = slider.value;
    });
    const store = () => {
      if (slider.dataset.touched !== 'true') return;
      state.ratings[key] = {
        item_id: item.item_id,
        label: labelFor(labelIndex),
        label_index: labelIndex,
        score: Number(slider.value),
        notes_timing: notes.value,
        expression_pedal: expression.value,
        tone_room: tone.value,
        confidence: confidence.value === '' ? null : Number(confidence.value),
      };
    };
    for (const control of [slider, notes, expression, tone, confidence]) {
      control.addEventListener('change', store);
    }
  });

  el('previous').disabled = state.index === 0;
  el('next').textContent = state.index === state.order.length - 1 ? 'Finish' : 'Next';
  el('item-error').textContent = '';
}

function missingRatings() {
  const item = currentItem();
  const missing = [];
  currentLabels(item).forEach((_candidateIndex, labelIndex) => {
    if (!state.ratings[ratingKey(item.item_id, labelIndex)]) missing.push(labelFor(labelIndex));
  });
  return missing;
}

function advance() {
  const missing = missingRatings();
  if (missing.length) {
    el('item-error').textContent = `Rate candidate(s) ${missing.join(', ')} before continuing.`;
    return;
  }
  state.index += 1;
  if (state.index >= state.order.length) {
    finish();
    return;
  }
  persist();
  if (state.index % BLOCK_SIZE === 0) {
    show('break');
    return;
  }
  renderItem();
}

function finish() {
  state.index = state.order.length;
  persist();
  show('done');
  el('download-note').textContent =
    `${Object.keys(state.ratings).length} ratings recorded for ${state.listenerId}.`;
}

function currentPayload() {
  return sessionPayload({
    listenerId: state.listenerId,
    analystSha: state.analystSha,
    rotation: state.rotationIndex,
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    equipment: state.equipment,
    ratings: state.ratings,
  });
}

function beginSession() {
  const rotationIndex = rotationFor(state.study, state.listenerId);
  state.rotationIndex = rotationIndex;
  state.rotation = state.study.rotations[rotationIndex];
  state.order = state.rotation.item_order;
  state.startedAt = state.startedAt || new Date().toISOString();

  const restored = restore();
  if (!restored && localStorage.getItem(storageKey())) {
    // A stored session for another build or rotation was discarded by restore().
    el('item-error').textContent = '';
  }
  if (restored && state.index >= state.order.length) {
    finish();
    return;
  }
  show('session');
  renderItem();
  persist();
}

function start() {
  const listenerId = el('listener').value.trim();
  if (!listenerId) {
    el('setup-error').textContent = 'Enter the participant code.';
    return;
  }
  state.listenerId = listenerId;
  state.index = 0;
  state.ratings = {};
  state.startedAt = null;
  state.equipment = el('equipment').value.trim();
  if (localStorage.getItem(storageKey())) {
    const resume = window.confirm(
      'Saved progress found for this code and study. Resume where you left off?');
    if (!resume) localStorage.removeItem(storageKey());
  }
  beginSession();
}

async function boot() {
  try {
    const response = await fetch('study.browser.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`study.browser.json returned ${response.status}`);
    const buffer = await response.arrayBuffer();
    state.study = JSON.parse(new TextDecoder().decode(buffer));
    state.browserSha = await sha256Hex(buffer);
    state.analystSha = state.study.analyst_manifest_sha256;
    if (!state.analystSha) throw new Error('the manifest has no analyst identity');
  } catch (error) {
    el('setup-error').textContent =
      `Could not load the study (${error.message}). Serve this directory over HTTP, ` +
      'for example: python -m http.server 8765';
    return;
  }
  renderInstructions();
  el('start').disabled = false;
}

el('start').addEventListener('click', start);
el('next').addEventListener('click', advance);
el('previous').addEventListener('click', () => {
  if (state.index > 0) {
    state.index -= 1;
    persist();
    renderItem();
  }
});
el('save').addEventListener('click', () => {
  persist();
  el('item-error').textContent = 'Progress saved in this browser.';
});
el('resume').addEventListener('click', () => {
  show('session');
  renderItem();
});
el('download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(currentPayload(), null, 2)],
    { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `listening-${state.listenerId}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

boot();
