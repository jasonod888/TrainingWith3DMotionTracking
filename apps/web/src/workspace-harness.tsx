import {createRoot} from 'react-dom/client';
import {PianoWorkspaceHarness} from './music/workspace/PianoWorkspaceHarness';
// The reused surfaces ship their own stylesheet; the harness adds only layout on top.
import './music/notation/notation.css';
import './music/workspace/workspace.css';

const host = document.getElementById('workspace-harness');
if (host) createRoot(host).render(<PianoWorkspaceHarness/>);
