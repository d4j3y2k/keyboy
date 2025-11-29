import React from 'react';
import ReactDOM from 'react-dom/client';
import MidiApp from './keyboy';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <MidiApp />
    </React.StrictMode>,
);
