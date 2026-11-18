import React from 'react';
import './music/notation/notation.css';
import './music/workspace/workspace.css';
import {createRoot} from 'react-dom/client';
import {App} from './LibraryApp';
import {MidiTestPage} from './music/MidiTestPage';
import {loadSetupPolicy} from './camera-setup-policy';
import './style.css';
import './workflow.css';
import './create.css';
const midiTest = new URLSearchParams(location.search).get('page') === 'midi-test';
// Server-controlled camera setup policy. Not awaited: the default is "enabled",
// so a slow or failed request keeps the real flow rather than unlocking the
// bypass by accident. Entry handlers read it synchronously when pressed.
if (!midiTest) void loadSetupPolicy();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{midiTest ? <MidiTestPage/> : <App/>}</React.StrictMode>,
);
