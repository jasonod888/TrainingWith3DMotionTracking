import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './LibraryApp';
import './style.css';
import './workflow.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
