import React, { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Annotation, AnnotationVerticalJustify } from 'vexflow';
import type { PhraseSegment } from '../types';

export interface SimpleStaffProps {
    segments: PhraseSegment[];
}

export const SimpleStaff: React.FC<SimpleStaffProps> = ({ segments }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        containerRef.current.innerHTML = '';

        const chords = segments.filter(s => s.type === 'chord' && s.notes.length > 0);
        if (chords.length === 0) return;

        // Calculate dimensions
        const noteWidth = 70;
        const staffWidth = Math.max(400, chords.length * noteWidth + 120);
        const staffHeight = 280;

        const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
        renderer.resize(staffWidth, staffHeight);
        const context = renderer.getContext();
        context.setFont('Arial', 10);

        // Grand staff layout
        const trebleY = 40;
        const bassY = 150;
        const staveWidth = chords.length * noteWidth + 40;

        // Create treble clef stave
        const trebleStave = new Stave(10, trebleY, staveWidth);
        trebleStave.addClef('treble');
        trebleStave.setContext(context).draw();

        // Create bass clef stave
        const bassStave = new Stave(10, bassY, staveWidth);
        bassStave.addClef('bass');
        bassStave.setContext(context).draw();

        // Draw brace connecting the staves
        context.beginPath();
        context.moveTo(10, trebleY);
        context.lineTo(10, bassY + 80);
        context.stroke();

        // Helper: MIDI to VexFlow key
        const midiToVexKey = (midi: number): string => {
            const noteNames = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
            const note = noteNames[midi % 12];
            const octave = Math.floor(midi / 12) - 1;
            // VexFlow uses format like "c/4" or "c#/4"
            return `${note.replace('#', '')}/${octave}`;
        };

        // Helper: Check if note needs accidental
        const needsSharp = (midi: number): boolean => {
            return [1, 3, 6, 8, 10].includes(midi % 12);
        };

        // Split notes into treble (>= 60) and bass (< 60)
        const trebleNotes: StaveNote[] = [];
        const bassNotes: StaveNote[] = [];

        chords.forEach((seg) => {
            const sorted = [...seg.notes].sort((a, b) => a - b);
            const trebleMidi = sorted.filter(n => n >= 60);
            const bassMidi = sorted.filter(n => n < 60);
            const dur: string = seg.duration || 'q';  // Use segment's duration
            const restDur: string = `${dur}r`;        // Rest version (e.g., 'qr', 'hr')
            const chordLabel = seg.analysis?.display || '';

            // Create treble note (or rest if no treble notes)
            if (trebleMidi.length > 0) {
                const keys = trebleMidi.map(midiToVexKey);
                const note = new StaveNote({ clef: 'treble', keys, duration: dur });
                // Add accidentals
                trebleMidi.forEach((midi, idx) => {
                    if (needsSharp(midi)) {
                        note.addModifier(new Accidental('#'), idx);
                    }
                });
                // Add chord label annotation above the note
                if (chordLabel) {
                    const annotation = new Annotation(chordLabel)
                        .setVerticalJustification(AnnotationVerticalJustify.TOP)
                        .setFont('Arial', 11, 'bold');
                    note.addModifier(annotation, 0);
                }
                trebleNotes.push(note);
            } else {
                // Rest in treble - add chord label to rest if there are bass notes
                const restNote = new StaveNote({ clef: 'treble', keys: ['b/4'], duration: restDur });
                if (chordLabel && bassMidi.length > 0) {
                    const annotation = new Annotation(chordLabel)
                        .setVerticalJustification(AnnotationVerticalJustify.TOP)
                        .setFont('Arial', 11, 'bold');
                    restNote.addModifier(annotation, 0);
                }
                trebleNotes.push(restNote);
            }

            // Create bass note (or rest if no bass notes)
            if (bassMidi.length > 0) {
                const keys = bassMidi.map(midiToVexKey);
                const note = new StaveNote({ clef: 'bass', keys, duration: dur });
                // Add accidentals
                bassMidi.forEach((midi, idx) => {
                    if (needsSharp(midi)) {
                        note.addModifier(new Accidental('#'), idx);
                    }
                });
                bassNotes.push(note);
            } else {
                // Rest in bass
                bassNotes.push(new StaveNote({ clef: 'bass', keys: ['d/3'], duration: restDur }));
            }
        });

        // Create voices and format
        if (trebleNotes.length > 0) {
            const trebleVoice = new Voice({ numBeats: trebleNotes.length, beatValue: 4 }).setStrict(false);
            trebleVoice.addTickables(trebleNotes);
            new Formatter().joinVoices([trebleVoice]).format([trebleVoice], staveWidth - 60);
            trebleVoice.draw(context, trebleStave);
        }

        if (bassNotes.length > 0) {
            const bassVoice = new Voice({ numBeats: bassNotes.length, beatValue: 4 }).setStrict(false);
            bassVoice.addTickables(bassNotes);
            new Formatter().joinVoices([bassVoice]).format([bassVoice], staveWidth - 60);
            bassVoice.draw(context, bassStave);
        }

    }, [segments]);

    const chordCount = segments.filter(s => s.type === 'chord').length;

    return (
        <div className="w-full bg-amber-50 rounded-xl border border-amber-200 shadow-inner overflow-x-auto">
            <div className="flex items-center justify-between px-4 py-2 border-b border-amber-200/50">
                <span className="text-xs font-medium text-amber-700">Sheet Music</span>
                {chordCount > 0 && (
                    <span className="text-xs text-amber-500">{chordCount} chord{chordCount !== 1 ? 's' : ''}</span>
                )}
            </div>
            <div ref={containerRef} className="p-2 min-h-[300px]" />
            {chordCount === 0 && (
                <div className="flex items-center justify-center h-[280px] text-amber-400 text-sm">
                    Play chords to see notation...
                </div>
            )}
        </div>
    );
};
