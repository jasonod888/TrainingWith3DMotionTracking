import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './LibraryApp';
import {loadSetupPolicy} from './camera-setup-policy';
import './style.css';
import './workflow.css';
// Server-controlled camera setup policy. Not awaited: the default is "enabled",
// so a slow or failed request keeps the real flow rather than unlocking the
// bypass by accident. Entry handlers read it synchronously when pressed.
void loadSetupPolicy();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
