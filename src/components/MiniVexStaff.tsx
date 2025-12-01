import React, { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental } from 'vexflow';
import type { Duration } from '../types';

export interface MiniVexStaffProps {
    notes: number[];
    duration: Duration;
    isActive?: boolean;
}

export const MiniVexStaff: React.FC<MiniVexStaffProps> = ({ notes, duration, isActive = false }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current || notes.length === 0) return;
        containerRef.current.innerHTML = '';

        const width = 154;
        const height = 180;

        const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
        renderer.resize(width, height);
        const context = renderer.getContext();
        context.setFont('Arial', 10);

        // Grand staff layout - centered with shorter staves
        const trebleY = 10;
        const bassY = 85;
        // Center a narrower stave for better note centering
        const staveWidth = 80;
        const staveX = (width - staveWidth) / 2;

        // Create staves (no clef, no time sig - just staff lines)
        const trebleStave = new Stave(staveX, trebleY, staveWidth);
        trebleStave.setContext(context).draw();

        const bassStave = new Stave(staveX, bassY, staveWidth);
        bassStave.setContext(context).draw();

        // Helper: MIDI to VexFlow key
        const midiToVexKey = (midi: number): string => {
            const noteNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
            const note = noteNames[midi % 12];
            const octave = Math.floor(midi / 12) - 1;
            return `${note.replace('#', '')}/${octave}`;
        };

        const needsSharp = (midi: number): boolean => {
            return [1, 3, 6, 8, 10].includes(midi % 12);
        };

        // Split notes
        const sorted = [...notes].sort((a, b) => a - b);
        const trebleMidi = sorted.filter(n => n >= 60);
        const bassMidi = sorted.filter(n => n < 60);

        const dur: string = duration || 'q';
        const restDur: string = `${dur}r`;

        // Create notes
        const trebleNotes: StaveNote[] = [];
        const bassNotes: StaveNote[] = [];

        if (trebleMidi.length > 0) {
            const keys = trebleMidi.map(midiToVexKey);
            const note = new StaveNote({ clef: 'treble', keys, duration: dur });
            trebleMidi.forEach((midi, idx) => {
                if (needsSharp(midi)) {
                    note.addModifier(new Accidental('#'), idx);
                }
            });
            trebleNotes.push(note);
        } else {
            trebleNotes.push(new StaveNote({ clef: 'treble', keys: ['b/4'], duration: restDur }));
        }

        if (bassMidi.length > 0) {
            const keys = bassMidi.map(midiToVexKey);
            const note = new StaveNote({ clef: 'bass', keys, duration: dur });
            bassMidi.forEach((midi, idx) => {
                if (needsSharp(midi)) {
                    note.addModifier(new Accidental('#'), idx);
                }
            });
            bassNotes.push(note);
        } else {
            bassNotes.push(new StaveNote({ clef: 'bass', keys: ['d/3'], duration: restDur }));
        }

        // Render voices with natural centering from the stave position
        if (trebleNotes.length > 0) {
            const voice = new Voice({ numBeats: 1, beatValue: 4 }).setStrict(false);
            voice.addTickables(trebleNotes);
            new Formatter().joinVoices([voice]).format([voice], staveWidth - 20);
            voice.draw(context, trebleStave);
        }

        if (bassNotes.length > 0) {
            const voice = new Voice({ numBeats: 1, beatValue: 4 }).setStrict(false);
            voice.addTickables(bassNotes);
            new Formatter().joinVoices([voice]).format([voice], staveWidth - 20);
            voice.draw(context, bassStave);
        }

    }, [notes, duration, isActive]);

    return <div ref={containerRef} className="flex justify-center items-center" />;
};
