/**
 * Phase 0 music-preparation spike (dev only).
 *
 * Qualifies the two candidate preparation paths before Phase 3 depends on either:
 *   MP4 with AVC/AAC, and WebM with VP8/Opus.
 *
 * It reports what the installed mediabunny build can encode in this browser, then
 * prepares the selected clip, re-reads the output and records stream facts. It is
 * deliberately not part of the app bundle: open it with the Vite dev server at
 * /spike/music-prepare.html.
 */
import {
  ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, WebMOutputFormat,
  canEncodeAudio, canEncodeVideo, getEncodableAudioCodecs, getEncodableVideoCodecs,
} from 'mediabunny';

type Candidate = {
  id: string;
  label: string;
  format: 'mp4' | 'webm';
  video: 'avc' | 'vp8';
  audio: 'aac' | 'opus';
  mime: string;
};

const CANDIDATES: Candidate[] = [
  {id: 'mp4-aac', label: 'MP4 · AVC/AAC', format: 'mp4', video: 'avc', audio: 'aac', mime: 'video/mp4'},
  {id: 'webm-opus', label: 'WebM · VP8/Opus', format: 'webm', video: 'vp8', audio: 'opus', mime: 'video/webm'},
];

const MAX_BYTES = 250 * 1024 * 1024;
const MAX_DURATION_ERROR = 0.15;
const MAX_START_OFFSET_MS = 50;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const log = (message: string) => {
  const element = $('log');
  element.textContent += `${new Date().toLocaleTimeString()}  ${message}\n`;
  element.scrollTop = element.scrollHeight;
};

type Report = {
  path: string;
  encoder: string;
  output: string;
  audio: string;
  timing: string;
  size: string;
  verdict: 'pass' | 'fail' | 'warn';
  detail: string;
};

const reports: Report[] = [];

function writeReports() {
  const body = $('results');
  body.innerHTML = '';
  for (const report of reports) {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${report.path}</td><td>${report.encoder}</td><td>${report.output}</td>
      <td>${report.audio}</td><td>${report.timing}</td><td>${report.size}</td>
      <td class="${report.verdict}">${report.verdict.toUpperCase()}<div><small>${report.detail}</small></div></td>`;
    body.appendChild(row);
  }
}

async function capabilityReport() {
  const result = $('capability-result');
  result.textContent = 'Checking…';
  const [audio, video] = await Promise.all([getEncodableAudioCodecs(), getEncodableVideoCodecs()]);
  const rows: string[] = [];
  for (const candidate of CANDIDATES) {
    const [a, v] = await Promise.all([canEncodeAudio(candidate.audio), canEncodeVideo(candidate.video)]);
    rows.push(`<tr><td>${candidate.label}</td><td class="${a ? 'pass' : 'fail'}">${a ? 'yes' : 'no'} (${candidate.audio})</td>
      <td class="${v ? 'pass' : 'fail'}">${v ? 'yes' : 'no'} (${candidate.video})</td></tr>`);
    log(`encoder ${candidate.label}: audio ${candidate.audio}=${a}, video ${candidate.video}=${v}`);
  }
  result.innerHTML = `<table><thead><tr><th>Path</th><th>Audio encoder</th><th>Video encoder</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>
    <p><small>Encodable audio codecs: ${audio.join(', ') || 'none'} · video: ${video.join(', ') || 'none'}</small></p>`;
}

type Prepared = {
  file: File;
  duration: number;
  audio: {sampleRate: number; channels: number; codec: string | null; firstTimestamp: number} | null;
  videoFirstTimestamp: number | null;
  outputDuration: number;
  elapsedMs: number;
};

async function prepare(file: File, start: number, end: number, candidate: Candidate, signal: AbortSignal): Promise<Prepared> {
  const input = new Input({source: new BlobSource(file), formats: ALL_FORMATS});
  const target = new BufferTarget();
  const output = new Output({
    format: candidate.format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target,
  });
  let conversion: Conversion | undefined;
  const abort = () => void conversion?.cancel();
  signal.addEventListener('abort', abort, {once: true});
  const started = performance.now();
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This file has no readable video track.');
    const sourceDuration = await input.computeDuration();
    if (end > sourceDuration + 0.05) throw new Error(`End ${end}s is outside the source (${sourceDuration.toFixed(2)}s).`);
    const scale = Math.min(1, 1280 / Math.max(track.displayWidth, track.displayHeight));
    conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      trim: {start, end},
      copy: false,
      video: {
        codec: candidate.video,
        fit: 'contain',
        width: Math.max(2, Math.floor(track.displayWidth * scale / 2) * 2),
        height: Math.max(2, Math.floor(track.displayHeight * scale / 2) * 2),
        frameRate: 15,
      },
      audio: {codec: candidate.audio},
    });
    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map(item => `${item.track.type}: ${item.reason}`).join('; ');
      throw new Error(`Encoder combination is not valid in this browser (${reasons || 'no reason reported'}).`);
    }
    await conversion.execute();
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', abort);
    input.dispose();
  }
  if (!target.buffer) throw new Error('The conversion produced no output.');
  const elapsedMs = Math.round(performance.now() - started);
  const prepared = new File([target.buffer], `clip.${candidate.format === 'mp4' ? 'mp4' : 'webm'}`, {type: candidate.mime});

  const verifyInput = new Input({source: new BlobSource(prepared), formats: ALL_FORMATS});
  try {
    const audioTrack = await verifyInput.getPrimaryAudioTrack();
    const videoTrack = await verifyInput.getPrimaryVideoTrack();
    const outputDuration = await verifyInput.computeDuration();
    return {
      file: prepared,
      duration: end - start,
      outputDuration,
      elapsedMs,
      videoFirstTimestamp: videoTrack ? await videoTrack.getFirstTimestamp() : null,
      audio: audioTrack ? {
        sampleRate: await audioTrack.getSampleRate(),
        channels: await audioTrack.getNumberOfChannels(),
        codec: (await audioTrack.getCodecParameterString()) ?? null,
        firstTimestamp: await audioTrack.getFirstTimestamp(),
      } : null,
    };
  } finally {
    verifyInput.dispose();
  }
}

function judge(prepared: Prepared, requested: number, candidate: Candidate): {verdict: Report['verdict']; detail: string} {
  const problems: string[] = [];
  if (!prepared.audio) problems.push('no audio track in the output');
  else {
    if (!prepared.audio.sampleRate) problems.push('audio sample rate is zero');
    if (!prepared.audio.channels) problems.push('audio has no channels');
  }
  if (!prepared.videoFirstTimestamp && prepared.videoFirstTimestamp !== 0) problems.push('no video track in the output');
  if (Math.abs(prepared.outputDuration - requested) > MAX_DURATION_ERROR) {
    problems.push(`duration ${prepared.outputDuration.toFixed(2)}s differs from ${requested.toFixed(2)}s`);
  }
  if (prepared.audio && prepared.videoFirstTimestamp !== null) {
    const offset = Math.abs(prepared.audio.firstTimestamp - prepared.videoFirstTimestamp) * 1000;
    if (offset > MAX_START_OFFSET_MS) problems.push(`audio starts ${offset.toFixed(0)}ms from video`);
  }
  if (prepared.file.size > MAX_BYTES) problems.push('prepared clip exceeds the upload size limit');
  if (candidate.format === 'mp4' && candidate.audio === 'aac' && !prepared.audio) problems.push('MP4 path lost its audio');
  return problems.length
    ? {verdict: 'fail', detail: problems.join('; ')}
    : {verdict: 'pass', detail: 'stream facts within tolerance; confirm audibility by ear'};
}

async function run() {
  current?.abort();
  const file = ($('source') as HTMLInputElement).files?.[0];
  if (!file) return log('Choose a source video first.');
  const start = Number(($('start') as HTMLInputElement).value);
  const end = Number(($('end') as HTMLInputElement).value);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.2) return log('Choose a valid range of at least 0.2s.');
  const selected = [...document.querySelectorAll<HTMLInputElement>('input[name="path"]:checked')].map(input => input.value);
  if (!selected.length) return log('Select at least one preparation path.');
  const controller = new AbortController();
  current = controller;
  const cancelButton = $('cancel') as HTMLButtonElement;
  const runButton = $('run') as HTMLButtonElement;
  cancelButton.disabled = false;
  runButton.disabled = true;
  for (const id of selected) {
    const candidate = CANDIDATES.find(item => item.id === id)!;
    try {
      const prepared = await prepare(file, start, end, candidate, controller.signal);
      const {verdict, detail} = judge(prepared, end - start, candidate);
      const preview = $('preview') as HTMLVideoElement;
      if (preview.src) URL.revokeObjectURL(preview.src);
      preview.src = URL.createObjectURL(prepared.file);
      reports.push({
        path: candidate.label,
        encoder: 'ok',
        output: `${prepared.outputDuration.toFixed(2)}s · ${prepared.videoFirstTimestamp === null ? 'no video' : 'video'}`,
        audio: prepared.audio ? `${prepared.audio.codec ?? candidate.audio} · ${prepared.audio.sampleRate} Hz · ${prepared.audio.channels}ch` : 'none',
        timing: prepared.audio && prepared.videoFirstTimestamp !== null
          ? `Δstart ${(Math.abs(prepared.audio.firstTimestamp - prepared.videoFirstTimestamp) * 1000).toFixed(0)}ms`
          : 'unavailable',
        size: `${(prepared.file.size / 1024).toFixed(0)} KiB · ${prepared.elapsedMs}ms`,
        verdict,
        detail,
      });
      writeReports();
      log(`${candidate.label}: ${verdict} (${detail})`);
    } catch (error) {
      const message = (error as Error).name === 'ConversionCanceledError' ? 'cancelled by the operator' : (error as Error).message;
      reports.push({path: candidate.label, encoder: 'failed', output: '—', audio: '—', timing: '—', size: '—', verdict: 'fail', detail: message});
      writeReports();
      log(`${candidate.label}: ${message}`);
      if ((error as Error).name === 'ConversionCanceledError') break;
    }
  }
  cancelButton.disabled = true;
  runButton.disabled = false;
  current = null;
}

let current: AbortController | null = null;

$('capabilities').addEventListener('click', () => void capabilityReport());
$('run').addEventListener('click', () => void run());
$('cancel').addEventListener('click', () => { current?.abort(); log('Cancel requested.'); });

void capabilityReport();
