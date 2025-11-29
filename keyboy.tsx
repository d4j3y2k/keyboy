import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Music, Cable, Trophy, Info, SkipForward } from 'lucide-react';

// --- TYPES & INTERFACES ---

interface NoteDetails {
    note: string;
    octave: number;
    name: string;
    midi: number;
}

interface ChordPattern {
    name: string;
    intervals: number[];
    priority: number;
    allowOmit5th?: boolean;
}

interface ChordAnalysis {
    root: string;
    quality: string;
    bass: string;
    display: string;
    intervals: number[];
    detectedRootPitchClass: number;
    isRootless?: boolean;
    // Actual intervals from MIDI (preserving octave info) for tension disambiguation
    actualIntervals?: number[];
}

interface PhraseSegment {
    type: 'chord' | 'scale';
    notes: number[];
    timestamp: number;
    analysis?: ChordAnalysis;
}

interface StaffProps {
    activeNotes: number[];
    history: PhraseSegment[];
}

interface VirtualKeyboardProps {
    activeNotes: number[];
    highlightedNotes?: number[];
    onNoteOn: (note: number) => void;
    onNoteOff: (note: number) => void;
}

interface TargetChord {
    root: string;
    quality: string;
    display: string;
}

// Web MIDI API Types
interface MIDIMessageEvent extends Event {
    data: Uint8Array;
}

interface MIDIInput extends EventTarget {
    id: string;
    name: string | null;
    state: 'connected' | 'disconnected';
    type: 'input';
    onmidimessage: ((event: MIDIMessageEvent) => void) | null;
}

interface MIDIOutput extends EventTarget {
    id: string;
    name: string | null;
    state: 'connected' | 'disconnected';
    type: 'output';
}

interface MIDIConnectionEvent extends Event {
    port: MIDIInput | MIDIOutput;
}

interface MIDIAccess extends EventTarget {
    inputs: Map<string, MIDIInput>;
    outputs: Map<string, MIDIOutput>;
    onstatechange: ((event: MIDIConnectionEvent) => void) | null;
}

interface NavigatorWithMIDI extends Navigator {
    requestMIDIAccess?: () => Promise<MIDIAccess>;
}

/**
 * MUSIC THEORY CONSTANTS & HELPERS
 */
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const INTERVALS = [
    'Root', 'min 2nd', 'Maj 2nd', 'min 3rd', 'Maj 3rd', 'Perf 4th',
    'Tritone', 'Perf 5th', 'min 6th', 'Maj 6th', 'min 7th', 'Maj 7th'
];

// Enharmonic spelling helper
const getNoteName = (pitchClass: number, preferFlat: boolean = false): string => {
    return preferFlat ? NOTES_FLAT[pitchClass] : NOTES[pitchClass];
};

// Root-based scale spelling: determines how chord tones are spelled based on root
// Each root has a preferred spelling for its scale degrees
// Sharp roots (C#, F#, G#) use sharps; Flat roots (Db, Eb, Gb, Ab, Bb) use flats
const ROOT_SPELLING: { [key: number]: { useFlat: boolean; scale: string[] } } = {
    0:  { useFlat: false, scale: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] },      // C - mixed
    1:  { useFlat: false, scale: ['C#', 'D', 'D#', 'E', 'E#', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'B#'] },   // C# - sharps
    2:  { useFlat: false, scale: ['D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B', 'C', 'C#'] },     // D - mixed
    3:  { useFlat: true,  scale: ['Eb', 'Fb', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'Cb', 'C', 'Db', 'D'] },   // Eb - flats
    4:  { useFlat: false, scale: ['E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B', 'C', 'C#', 'D', 'D#'] },     // E - sharps
    5:  { useFlat: true,  scale: ['F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E'] },     // F - flats
    6:  { useFlat: false, scale: ['F#', 'G', 'G#', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'E#'] },    // F# - sharps
    7:  { useFlat: false, scale: ['G', 'Ab', 'A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#'] },     // G - mixed
    8:  { useFlat: true,  scale: ['Ab', 'A', 'Bb', 'Cb', 'C', 'Db', 'D', 'Eb', 'Fb', 'F', 'Gb', 'G'] },   // Ab - flats
    9:  { useFlat: false, scale: ['A', 'Bb', 'B', 'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#'] },     // A - mixed
    10: { useFlat: true,  scale: ['Bb', 'Cb', 'C', 'Db', 'D', 'Eb', 'Fb', 'F', 'Gb', 'G', 'Ab', 'A'] },   // Bb - flats
    11: { useFlat: false, scale: ['B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#'] },     // B - sharps
};

// Get root name based on common usage and context
// Handles all enharmonic pitch classes: C#/Db, D#/Eb, F#/Gb, G#/Ab, A#/Bb
const getRootSpelling = (rootPitchClass: number, bassContext?: number[]): string => {
    // Sharp key indicators: presence of F#, C#, G#, D#, A#, E, B
    // Flat key indicators: presence of Bb, Eb, Ab, Db, Gb, F
    const hasSharpIndicators = bassContext && (
        bassContext.includes(6) ||  // F#
        bassContext.includes(1) ||  // C#
        bassContext.includes(8) ||  // G# (in sharp context)
        bassContext.includes(4) ||  // E (sharp key center)
        bassContext.includes(11)    // B (sharp key center)
    );
    const hasFlatIndicators = bassContext && (
        bassContext.includes(10) || // Bb
        bassContext.includes(3) ||  // Eb
        bassContext.includes(5)     // F (flat key center)
    );

    // C#/Db (pitch class 1)
    if (rootPitchClass === 1) {
        // Prefer Db in flat contexts (with F, Bb, Ab, Eb), C# otherwise
        if (hasFlatIndicators && !hasSharpIndicators) {
            return 'Db';
        }
        return 'C#'; // Default to C# (more common in pop/rock)
    }

    // D#/Eb (pitch class 3)
    if (rootPitchClass === 3) {
        // Prefer D# in sharp contexts (E major, B major, F# major)
        // E major has D#, B major has D#, F# major has D# (as #5 enharmonic)
        if (hasSharpIndicators && !hasFlatIndicators) {
            // Strong sharp context: E or B as likely key centers
            if (bassContext && (bassContext.includes(4) || bassContext.includes(11) || bassContext.includes(6))) {
                return 'D#';
            }
        }
        return 'Eb'; // Default to Eb (much more common)
    }

    // F#/Gb (pitch class 6)
    if (rootPitchClass === 6) {
        // Prefer Gb in very flat contexts (Db major, Gb major), F# otherwise
        if (hasFlatIndicators && bassContext &&
            (bassContext.includes(1) || bassContext.includes(8)) && // Db or Ab present
            !bassContext.includes(4) && !bassContext.includes(11)) { // No E or B
            return 'Gb';
        }
        return 'F#'; // Default to F# (much more common)
    }

    // G#/Ab (pitch class 8)
    if (rootPitchClass === 8) {
        // Prefer G# in sharp contexts (E major, A major, B major)
        // E major: E-G#-B, A major: A-C#-E with G# as maj7
        if (hasSharpIndicators && !hasFlatIndicators) {
            if (bassContext && (bassContext.includes(4) || bassContext.includes(9) || bassContext.includes(11))) {
                return 'G#';
            }
        }
        return 'Ab'; // Default to Ab (more common as a root)
    }

    // A#/Bb (pitch class 10)
    if (rootPitchClass === 10) {
        // Prefer A# in sharp contexts (B major, F# major)
        // B major has A# as maj7, F# major has A# as 3rd
        if (hasSharpIndicators && !hasFlatIndicators) {
            if (bassContext && (bassContext.includes(11) || bassContext.includes(6))) {
                return 'A#';
            }
        }
        return 'Bb'; // Default to Bb (much more common)
    }

    return ROOT_SPELLING[rootPitchClass].scale[0];
};

// Spell a chord tone relative to the root
const getChordToneSpelling = (pitchClass: number, rootPitchClass: number): string => {
    const interval = ((pitchClass - rootPitchClass) % 12 + 12) % 12;
    return ROOT_SPELLING[rootPitchClass].scale[interval];
};

// Check if root prefers flats
const shouldPreferFlat = (rootPitchClass: number): boolean => {
    return ROOT_SPELLING[rootPitchClass].useFlat;
};

// Tension-aware spelling: maps interval (mod 12) to proper tension name based on chord quality
// This ensures #9 shows as D# (not Eb), #11 shows as F# (not Gb), etc.
interface TensionSpelling {
    [interval: number]: { natural: string; sharp: string; flat: string };
}

// For each root, provide natural/sharp/flat versions of ambiguous intervals
const getTensionSpellings = (rootPitchClass: number): TensionSpelling => {
    const root = ROOT_SPELLING[rootPitchClass].scale[0];
    // Build tension spellings based on root
    // Intervals that can be #/b: 1(b9), 3(#9/b3), 6(#11/b5), 8(b13/#5)
    const baseNote = (semitones: number) => {
        const noteIndex = (rootPitchClass + semitones) % 12;
        return NOTES[noteIndex]; // Natural version
    };

    // Sharp/flat spellings for tension notes
    const spellings: TensionSpelling = {
        1: { // b9
            natural: ROOT_SPELLING[rootPitchClass].scale[1],
            sharp: ROOT_SPELLING[rootPitchClass].scale[1],
            flat: ROOT_SPELLING[rootPitchClass].scale[1]
        },
        3: { // #9 or b3
            natural: ROOT_SPELLING[rootPitchClass].scale[3], // b3 spelling (Eb for C)
            sharp: getSharpSpelling(rootPitchClass, 2), // #9 spelling (D# for C)
            flat: ROOT_SPELLING[rootPitchClass].scale[3]
        },
        6: { // #11 or b5
            natural: ROOT_SPELLING[rootPitchClass].scale[6],
            sharp: getSharpSpelling(rootPitchClass, 5), // #11 spelling (F# for C)
            flat: ROOT_SPELLING[rootPitchClass].scale[6] // b5 spelling (Gb for C)
        },
        8: { // b13 or #5
            natural: ROOT_SPELLING[rootPitchClass].scale[8],
            sharp: getSharpSpelling(rootPitchClass, 7), // #5 spelling (G# for C)
            flat: ROOT_SPELLING[rootPitchClass].scale[8] // b13 spelling (Ab for C)
        }
    };
    return spellings;
};

// Get sharp spelling of a scale degree
const getSharpSpelling = (rootPitchClass: number, scaleDegree: number): string => {
    const baseNote = ROOT_SPELLING[rootPitchClass].scale[scaleDegree];
    // Add sharp to the base note
    if (baseNote.includes('b')) {
        // Bb# = B, Eb# = E, etc.
        return baseNote.replace('b', '');
    } else if (baseNote.includes('#')) {
        // Already sharp, double sharp
        return baseNote + '#'; // F## etc.
    } else {
        return baseNote + '#';
    }
};

// Determine tension quality from pattern name and/or actual interval
// When actualInterval is provided, use octave-aware logic for accurate disambiguation
const getTensionQuality = (
    patternName: string,
    interval: number,
    actualInterval?: number
): 'natural' | 'sharp' | 'flat' => {
    // If we have actual interval data, use it for disambiguation
    if (actualInterval !== undefined) {
        if (interval === 3) { // Could be #9 or b3
            // If actual interval is 14-15+ semitones, it's #9
            if (actualInterval >= 14) return 'sharp';
            // If pattern explicitly says #9, use sharp
            if (patternName.includes('#9')) return 'sharp';
            return 'natural'; // b3 spelling
        }
        if (interval === 6) { // Could be #11 or b5
            // If actual interval is 17-18+ semitones, it's #11
            if (actualInterval >= 17) return 'sharp';
            // If pattern explicitly says #11, use sharp
            if (patternName.includes('#11')) return 'sharp';
            if (patternName.includes('b5')) return 'flat';
            return 'flat'; // Default to b5 when within octave
        }
        if (interval === 8) { // Could be b13 or #5
            // If actual interval is 19-20+ semitones, it's b13
            if (actualInterval >= 19) return 'flat';
            // If pattern explicitly says b13, use flat
            if (patternName.includes('b13')) return 'flat';
            if (patternName.includes('#5') || patternName.includes('aug')) return 'sharp';
            return 'sharp'; // Default to #5 when within octave
        }
    }

    // Fallback to pattern name heuristics when no actual interval data
    if (interval === 3) { // Could be #9 or b3
        if (patternName.includes('#9')) return 'sharp';
        return 'natural'; // Default to b3 spelling for minor chords
    }
    if (interval === 6) { // Could be #11 or b5
        if (patternName.includes('#11')) return 'sharp';
        if (patternName.includes('b5')) return 'flat';
        return 'natural';
    }
    if (interval === 8) { // Could be b13 or #5
        if (patternName.includes('#5') || patternName.includes('aug')) return 'sharp';
        if (patternName.includes('b13')) return 'flat';
        return 'natural';
    }
    if (interval === 1) { // b9
        return 'flat';
    }
    return 'natural';
};

// Spell a chord tone with tension awareness
// When actualInterval is provided (from MIDI octave analysis), use it for accurate #/b disambiguation
const getChordToneWithTension = (
    pitchClass: number,
    rootPitchClass: number,
    patternName: string,
    actualInterval?: number
): string => {
    const interval = ((pitchClass - rootPitchClass) % 12 + 12) % 12;

    // For non-tension intervals, use standard spelling
    if (![1, 3, 6, 8].includes(interval)) {
        return ROOT_SPELLING[rootPitchClass].scale[interval];
    }

    // For tension intervals, use quality-aware spelling with optional actual interval data
    const quality = getTensionQuality(patternName, interval, actualInterval);
    const spellings = getTensionSpellings(rootPitchClass);

    if (spellings[interval]) {
        return spellings[interval][quality];
    }

    return ROOT_SPELLING[rootPitchClass].scale[interval];
};

// Normalize intervals to mod 12, sorted, unique
const normalizeIntervals = (intervals: number[]): number[] => {
    return [...new Set(intervals.map(i => ((i % 12) + 12) % 12))].sort((a, b) => a - b);
};

// Calculate actual intervals from MIDI notes (preserving octave information)
// This allows distinguishing #9 (interval 15) from b3 (interval 3), etc.
interface ActualIntervalInfo {
    pitchClass: number;      // 0-11 pitch class
    actualInterval: number;  // Actual semitone distance from root (can be > 12)
    midi: number;            // Original MIDI note number
}

const calculateActualIntervals = (
    sortedMidiNotes: number[],
    rootPitchClass: number
): ActualIntervalInfo[] => {
    if (sortedMidiNotes.length === 0) return [];

    // Find the lowest instance of the root pitch class (or closest reference point)
    // If the root is not in the voicing (rootless), use the lowest note as reference
    // and calculate what the root WOULD be
    let rootMidi: number;

    const rootInstances = sortedMidiNotes.filter(n => n % 12 === rootPitchClass);
    if (rootInstances.length > 0) {
        rootMidi = Math.min(...rootInstances);
    } else {
        // Rootless voicing: calculate where the root would be below the lowest note
        const lowestNote = sortedMidiNotes[0];
        const lowestPitchClass = lowestNote % 12;
        const intervalFromRoot = ((lowestPitchClass - rootPitchClass) % 12 + 12) % 12;
        rootMidi = lowestNote - intervalFromRoot;
    }

    return sortedMidiNotes.map(midi => ({
        pitchClass: midi % 12,
        actualInterval: midi - rootMidi,
        midi
    }));
};

// Check if a pitch class appears as a compound interval (> octave) in the voicing
// Returns the actual interval if found as compound, or the mod-12 interval if not
const getActualIntervalForPitchClass = (
    actualIntervals: ActualIntervalInfo[],
    targetPitchClass: number,
    rootPitchClass: number
): number => {
    const expectedMod12 = ((targetPitchClass - rootPitchClass) % 12 + 12) % 12;

    // Look through actual intervals to find this pitch class
    const matches = actualIntervals.filter(info => info.pitchClass === targetPitchClass);

    if (matches.length === 0) return expectedMod12;

    // If any instance is compound (> 12 semitones from root), return that interval
    // This helps identify #9 (15) vs b3 (3), #11 (18) vs b5 (6), etc.
    const compoundMatch = matches.find(m => m.actualInterval > 12);
    if (compoundMatch) {
        return compoundMatch.actualInterval;
    }

    // Return the actual interval of the lowest instance
    return Math.min(...matches.map(m => m.actualInterval));
};

// Determine if an ambiguous pitch class is more likely sharp or flat based on voicing
// This uses octave placement heuristics: tensions above the octave are usually sharp
interface TensionDisambiguation {
    interval3IsSharp9: boolean;  // true = #9, false = b3
    interval6IsSharp11: boolean; // true = #11, false = b5
    interval8IsSharp5: boolean;  // true = #5, false = b13
}

const disambiguateTensions = (
    actualIntervals: ActualIntervalInfo[],
    rootPitchClass: number,
    hasMaj3: boolean,
    hasMin3: boolean,
    has7th: boolean,
    hasPerfect5: boolean
): TensionDisambiguation => {
    const result: TensionDisambiguation = {
        interval3IsSharp9: false,
        interval6IsSharp11: false,
        interval8IsSharp5: false
    };

    // --- #9 vs b3 disambiguation ---
    // Pitch class 3 from root could be b3 (interval 3) or #9 (interval 15)
    const pitchClass3 = ((rootPitchClass + 3) % 12);
    const interval3Actual = getActualIntervalForPitchClass(actualIntervals, pitchClass3, rootPitchClass);

    if (interval3Actual >= 14) {
        // Clearly compound - it's #9
        result.interval3IsSharp9 = true;
    } else if (hasMaj3) {
        // Has major 3rd - check voicing to determine if pitch class 3 is #9 or b3
        const maj3PitchClass = (rootPitchClass + 4) % 12;
        const maj3Instances = actualIntervals.filter(i => i.pitchClass === maj3PitchClass);
        const pc3Instances = actualIntervals.filter(i => i.pitchClass === pitchClass3);

        if (maj3Instances.length > 0 && pc3Instances.length > 0) {
            const lowestMaj3 = Math.min(...maj3Instances.map(i => i.midi));
            const lowestPc3 = Math.min(...pc3Instances.map(i => i.midi));
            // If pitch class 3 is voiced ABOVE the major 3rd, it's #9
            // This applies even with 7th chords - voicing determines interpretation
            if (lowestPc3 > lowestMaj3) {
                result.interval3IsSharp9 = true;
            }
            // If pitch class 3 is voiced BELOW the major 3rd, it's b3 (cluster)
            // Leave interval3IsSharp9 as false
        } else if (has7th && pc3Instances.length > 0) {
            // Has 7th but can't compare voicing (maj3 not present for some reason)
            // Default to #9 for 7th chords as this is more common
            result.interval3IsSharp9 = true;
        }
    }

    // --- #11 vs b5 disambiguation ---
    // Pitch class 6 from root could be b5 (interval 6) or #11 (interval 18)
    const pitchClass6 = ((rootPitchClass + 6) % 12);
    const interval6Actual = getActualIntervalForPitchClass(actualIntervals, pitchClass6, rootPitchClass);

    if (interval6Actual >= 17) {
        // Clearly compound - it's #11
        result.interval6IsSharp11 = true;
    } else if (hasPerfect5 && hasMaj3) {
        // Has perfect 5th AND major 3rd - the tritone is likely #11 (Lydian)
        result.interval6IsSharp11 = true;
    } else if (has7th && hasMaj3 && !hasPerfect5) {
        // Has 7th and major 3rd but no perfect 5th - could be either
        // Prefer #11 in maj7 context (Lydian), b5 in dom7 context unless clearly compound
        const hasMaj7 = actualIntervals.some(i => ((i.pitchClass - rootPitchClass + 12) % 12) === 11);
        if (hasMaj7) {
            result.interval6IsSharp11 = true; // Lydian voicing
        }
        // For dom7 without 5th, keep as b5 (7b5 chord)
    }

    // --- #5 vs b13 disambiguation ---
    // Pitch class 8 from root could be #5 (augmented) or b13 (interval 20)
    const pitchClass8 = ((rootPitchClass + 8) % 12);
    const interval8Actual = getActualIntervalForPitchClass(actualIntervals, pitchClass8, rootPitchClass);

    if (interval8Actual >= 19) {
        // Clearly compound - it's b13
        result.interval8IsSharp5 = false;
    } else if (hasPerfect5) {
        // Has perfect 5th - the pitch class 8 is likely b13
        result.interval8IsSharp5 = false;
    } else if (!hasPerfect5 && !has7th) {
        // No 5th, no 7th - probably augmented triad (#5)
        result.interval8IsSharp5 = true;
    }

    return result;
};

const CHORD_PATTERNS: ChordPattern[] = [
    // 13th chords (highest priority - most specific)
    { name: 'Maj13', intervals: normalizeIntervals([0, 4, 7, 11, 14, 21]), priority: 65, allowOmit5th: true },
    { name: '13', intervals: normalizeIntervals([0, 4, 7, 10, 14, 21]), priority: 65, allowOmit5th: true },
    { name: 'min13', intervals: normalizeIntervals([0, 3, 7, 10, 14, 21]), priority: 65, allowOmit5th: true },
    { name: '13sus4', intervals: normalizeIntervals([0, 5, 7, 10, 14, 21]), priority: 64, allowOmit5th: true },

    // 11th chords
    { name: 'Maj9#11', intervals: normalizeIntervals([0, 4, 7, 11, 14, 18]), priority: 62, allowOmit5th: true },
    { name: '9#11', intervals: normalizeIntervals([0, 4, 7, 10, 14, 18]), priority: 62, allowOmit5th: true },
    { name: 'Maj11', intervals: normalizeIntervals([0, 4, 7, 11, 14, 17]), priority: 60, allowOmit5th: true },
    { name: '11', intervals: normalizeIntervals([0, 4, 7, 10, 14, 17]), priority: 60, allowOmit5th: true },
    { name: 'min11', intervals: normalizeIntervals([0, 3, 7, 10, 14, 17]), priority: 60, allowOmit5th: true },

    // 9th chords
    { name: 'Maj9', intervals: normalizeIntervals([0, 4, 7, 11, 14]), priority: 55, allowOmit5th: true },
    { name: '9', intervals: normalizeIntervals([0, 4, 7, 10, 14]), priority: 55, allowOmit5th: true },
    { name: 'min9', intervals: normalizeIntervals([0, 3, 7, 10, 14]), priority: 55, allowOmit5th: true },
    { name: 'minMaj9', intervals: normalizeIntervals([0, 3, 7, 11, 14]), priority: 55, allowOmit5th: true },
    { name: '9sus4', intervals: normalizeIntervals([0, 5, 7, 10, 14]), priority: 54, allowOmit5th: true },

    // Altered dominants with multiple alterations (highest specificity)
    { name: '13b9', intervals: normalizeIntervals([0, 4, 7, 10, 13, 21]), priority: 66, allowOmit5th: true },
    { name: '13#9', intervals: normalizeIntervals([0, 4, 7, 10, 15, 21]), priority: 66, allowOmit5th: true },
    { name: '7b9#11', intervals: normalizeIntervals([0, 4, 7, 10, 13, 18]), priority: 58, allowOmit5th: true },
    { name: '7#9#11', intervals: normalizeIntervals([0, 4, 7, 10, 15, 18]), priority: 58, allowOmit5th: true },
    { name: '7b9b13', intervals: normalizeIntervals([0, 4, 7, 10, 13, 20]), priority: 58 },
    { name: '7#9b13', intervals: normalizeIntervals([0, 4, 7, 10, 15, 20]), priority: 58 },
    { name: '7alt', intervals: normalizeIntervals([0, 4, 6, 10, 13, 15]), priority: 59 },

    // Maj7 with alterations
    { name: 'Maj7#9', intervals: normalizeIntervals([0, 4, 7, 11, 15]), priority: 56, allowOmit5th: true },

    // Altered dominants - basic
    { name: '7#9', intervals: normalizeIntervals([0, 4, 7, 10, 15]), priority: 54, allowOmit5th: true },
    { name: '7b9', intervals: normalizeIntervals([0, 4, 7, 10, 13]), priority: 54, allowOmit5th: true },
    // Note: #5/b5 patterns can't omit 5th as it would change identity
    { name: '7#5#9', intervals: normalizeIntervals([0, 4, 8, 10, 15]), priority: 56 },
    { name: '7#5b9', intervals: normalizeIntervals([0, 4, 8, 10, 13]), priority: 56 },
    { name: '7b5b9', intervals: normalizeIntervals([0, 4, 6, 10, 13]), priority: 56 },
    { name: '7b5#9', intervals: normalizeIntervals([0, 4, 6, 10, 15]), priority: 56 },
    // 7b13 needs 5th to distinguish from 7#5 (b13=8 vs #5=8 when 5th missing)
    { name: '7b13', intervals: normalizeIntervals([0, 4, 7, 10, 20]), priority: 53 },

    // Half-diminished extensions (Locrian / Locrian ♮2)
    { name: 'm9b5', intervals: normalizeIntervals([0, 3, 6, 10, 14]), priority: 56 },
    { name: 'm11b5', intervals: normalizeIntervals([0, 3, 6, 10, 14, 17]), priority: 58 },
    { name: 'm7b5(11)', intervals: normalizeIntervals([0, 3, 6, 10, 17]), priority: 54 },

    // #11 chords (Lydian) - allowOmit5th with disambiguation handled in analyzeChord
    // When 5th is missing, we prefer #11 over b5 if maj3+maj7 present (Lydian context)
    { name: 'Maj7#11', intervals: normalizeIntervals([0, 4, 7, 11, 18]), priority: 52, allowOmit5th: true },
    { name: '7#11', intervals: normalizeIntervals([0, 4, 7, 10, 18]), priority: 52, allowOmit5th: true },

    // 6/9 chords - allowOmit5th for common voicings
    { name: '6/9', intervals: normalizeIntervals([0, 4, 7, 9, 14]), priority: 52, allowOmit5th: true },
    { name: 'min6/9', intervals: normalizeIntervals([0, 3, 7, 9, 14]), priority: 52, allowOmit5th: true },

    // Sus7 chords (before regular 7ths to catch them properly)
    { name: '7sus4', intervals: [0, 5, 7, 10], priority: 46 },
    { name: '7sus2', intervals: [0, 2, 7, 10], priority: 46 },
    { name: 'Maj7sus4', intervals: [0, 5, 7, 11], priority: 46 },
    { name: 'Maj7sus2', intervals: [0, 2, 7, 11], priority: 46 },

    // Seventh chords
    { name: 'Maj7', intervals: [0, 4, 7, 11], priority: 45, allowOmit5th: true },
    { name: 'min7', intervals: [0, 3, 7, 10], priority: 45, allowOmit5th: true },
    { name: '7', intervals: [0, 4, 7, 10], priority: 45, allowOmit5th: true },
    { name: 'dim7', intervals: [0, 3, 6, 9], priority: 45 },
    { name: 'm7b5', intervals: [0, 3, 6, 10], priority: 45 },
    { name: 'minMaj7', intervals: [0, 3, 7, 11], priority: 45, allowOmit5th: true },
    // Altered 5th chords - the altered 5th IS the identity, can't omit
    { name: 'Maj7#5', intervals: [0, 4, 8, 11], priority: 46 },
    { name: '7#5', intervals: [0, 4, 8, 10], priority: 46 },
    { name: '7b5', intervals: [0, 4, 6, 10], priority: 46 },

    // Sixth chords - allowOmit5th for common voicings (C-E-A, Am6 as A-C-F#)
    { name: '6', intervals: [0, 4, 7, 9], priority: 42, allowOmit5th: true },
    { name: 'min6', intervals: [0, 3, 7, 9], priority: 42, allowOmit5th: true },

    // Add chords - allowOmit5th for common voicings
    { name: 'add9', intervals: normalizeIntervals([0, 4, 7, 14]), priority: 40, allowOmit5th: true },
    { name: 'madd9', intervals: normalizeIntervals([0, 3, 7, 14]), priority: 40, allowOmit5th: true },
    { name: 'add11', intervals: normalizeIntervals([0, 4, 7, 17]), priority: 40, allowOmit5th: true },
    { name: 'madd11', intervals: normalizeIntervals([0, 3, 7, 17]), priority: 40, allowOmit5th: true },
    // add#11 needs 5th to distinguish from addb5
    { name: 'add#11', intervals: normalizeIntervals([0, 4, 7, 18]), priority: 40 },
    // Triad with #9 (no 7th) - C-E-G-D# should be add#9, not "Maj + extra"
    // Note: These normalize to [0,3,4,7] - disambiguation will demote to cluster if b3 is below maj3
    { name: 'add#9', intervals: normalizeIntervals([0, 4, 7, 15]), priority: 41, allowOmit5th: true },
    { name: 'madd#9', intervals: normalizeIntervals([0, 3, 7, 15]), priority: 41, allowOmit5th: true },
    // Cluster voicings: maj3 + b3 together where b3 is NOT voiced as #9 (above the octave)
    // These are rare but occur in jazz clusters - C-Eb-E-G where Eb is below E
    { name: '(add b3)', intervals: [0, 3, 4, 7], priority: 40 },  // Major triad + added b3 cluster
    { name: 'm(add 3)', intervals: [0, 3, 4, 7], priority: 39 },  // Minor triad + added maj3 (less common interpretation)

    // Triads
    { name: '', intervals: [0, 4, 7], priority: 35 },  // Major triad - just root name
    { name: 'm', intervals: [0, 3, 7], priority: 35 },  // Minor - lowercase m
    { name: 'dim', intervals: [0, 3, 6], priority: 35 },
    { name: 'aug', intervals: [0, 4, 8], priority: 35 },
    { name: 'sus2', intervals: [0, 2, 7], priority: 33 },
    { name: 'sus4', intervals: [0, 5, 7], priority: 33 },

    // Lydian triad fragment - C-E-F# (maj3 + tritone, no 5th)
    // This is inherently ambiguous: could be #11 (Lydian) or b5 (altered)
    // The disambiguation logic in analyzeChord() will determine which based on octave placement
    // If the tritone is voiced as compound interval (18+ semitones), it's #11
    // If within the octave, default to b5 unless context suggests Lydian
    { name: '(#11)', intervals: [0, 4, 6], priority: 34 },  // Used when disambiguated as #11
    { name: '(b5)', intervals: [0, 4, 6], priority: 33 },   // Used when disambiguated as b5

    // Quartal voicings (stacked 4ths) - lower priority so sus7 catches first
    { name: 'quartal', intervals: normalizeIntervals([0, 5, 10]), priority: 22 },
    { name: 'quartal4', intervals: normalizeIntervals([0, 5, 10, 15]), priority: 23 },

    // Power chord
    { name: '5', intervals: [0, 7], priority: 20 },
];

// Helper: Convert MIDI number to Note Name (e.g., 60 -> C4)
const getNoteDetails = (midi: number): NoteDetails => {
    const note = NOTES[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return { note, octave, name: `${note}${octave}`, midi };
};

// Common chord extensions that don't clash (mod 12): 9=2, 11=5, 13=9, 6=9, add2=2
// These should be penalized less than truly "wrong" notes
const COMMON_EXTENSIONS = new Set([2, 5, 9]); // 9th, 11th/sus4, 13th/6th

// Calculate penalty for extra notes - extensions are penalized less
const calculateExtraNotesPenalty = (extraIntervals: number[], patternIntervals: number[]): number => {
    let penalty = 0;
    const patternHas7th = patternIntervals.some(i => i === 10 || i === 11); // dom7 or maj7

    for (const interval of extraIntervals) {
        if (COMMON_EXTENSIONS.has(interval)) {
            // Common extensions get light penalty, even lighter if chord has 7th
            penalty += patternHas7th ? 3 : 6;
        } else {
            // Non-extension notes get heavier penalty
            penalty += 18;
        }
    }
    return penalty;
};

// Helper: Analyze active notes to find the chord with fuzzy matching
const analyzeChord = (activeNotes: number[]): ChordAnalysis | null => {
    if (activeNotes.length < 1) return null;

    const sorted = [...activeNotes].sort((a, b) => a - b);
    const bassMidi = sorted[0];
    const bassPitchClass = bassMidi % 12;
    const uniquePitchClasses = [...new Set(sorted.map(n => n % 12))].sort((a, b) => a - b);

    interface Match {
        pattern: ChordPattern;
        root: number;
        score: number;
        isRootless: boolean;
        isExact: boolean;
    }

    const matches: Match[] = [];

    // Try each pitch class in the chord as potential root
    for (const potentialRoot of uniquePitchClasses) {
        const intervals = uniquePitchClasses
            .map(n => (n - potentialRoot + 12) % 12)
            .sort((a, b) => a - b);
        const intervalSet = new Set(intervals);

        for (const pattern of CHORD_PATTERNS) {
            const patternSet = new Set(pattern.intervals);

            // Check for exact match
            if (pattern.intervals.length === intervals.length &&
                pattern.intervals.every(i => intervalSet.has(i))) {
                matches.push({
                    pattern,
                    root: potentialRoot,
                    score: pattern.priority * 100 + 1000,
                    isRootless: false,
                    isExact: true
                });
                continue;
            }

            // Check for superset match (all pattern intervals present, extra notes allowed)
            const allPatternPresent = pattern.intervals.every(i => intervalSet.has(i));
            if (allPatternPresent) {
                const extraIntervals = intervals.filter(i => !patternSet.has(i));
                const penalty = calculateExtraNotesPenalty(extraIntervals, pattern.intervals);
                matches.push({
                    pattern,
                    root: potentialRoot,
                    score: pattern.priority * 100 - penalty,
                    isRootless: false,
                    isExact: false
                });
                continue;
            }

            // Check for match with omitted 5th (common voicing)
            if (pattern.allowOmit5th && pattern.intervals.includes(7)) {
                const patternWithout5th = pattern.intervals.filter(i => i !== 7);
                const allPresentWithout5th = patternWithout5th.every(i => intervalSet.has(i));

                if (allPresentWithout5th && !intervalSet.has(7)) {
                    const extraIntervals = intervals.filter(i => !patternSet.has(i) && i !== 7);
                    const penalty = calculateExtraNotesPenalty(extraIntervals, pattern.intervals);
                    matches.push({
                        pattern,
                        root: potentialRoot,
                        score: pattern.priority * 100 - 15 - penalty,
                        isRootless: false,
                        isExact: false
                    });
                }
            }
        }
    }

    // Try rootless detection - roots NOT in the played notes
    for (let potentialRoot = 0; potentialRoot < 12; potentialRoot++) {
        if (uniquePitchClasses.includes(potentialRoot)) continue;

        const intervals = uniquePitchClasses
            .map(n => (n - potentialRoot + 12) % 12)
            .sort((a, b) => a - b);
        const intervalSet = new Set(intervals);

        for (const pattern of CHORD_PATTERNS) {
            // Only consider 7th chords and above for rootless
            if (pattern.intervals.length < 4) continue;
            if (!pattern.intervals.includes(0)) continue;

            const patternWithoutRoot = pattern.intervals.filter(i => i !== 0);

            // Check if all non-root intervals are present
            const allNonRootPresent = patternWithoutRoot.every(i => intervalSet.has(i));

            if (allNonRootPresent && patternWithoutRoot.length >= 3) {
                const patternWithoutRootSet = new Set(patternWithoutRoot);
                const extraIntervals = intervals.filter(i => !patternWithoutRootSet.has(i));
                const penalty = calculateExtraNotesPenalty(extraIntervals, pattern.intervals);
                matches.push({
                    pattern,
                    root: potentialRoot,
                    score: pattern.priority * 80 - 50 - penalty,
                    isRootless: true,
                    isExact: false
                });
            }

            // Rootless with omitted 5th
            if (pattern.allowOmit5th) {
                const patternWithoutRootAnd5th = patternWithoutRoot.filter(i => i !== 7);
                const allNonRootNo5thPresent = patternWithoutRootAnd5th.every(i => intervalSet.has(i));

                if (allNonRootNo5thPresent && !intervalSet.has(7) && patternWithoutRootAnd5th.length >= 2) {
                    const patternSet = new Set(patternWithoutRootAnd5th);
                    const extraIntervals = intervals.filter(i => !patternSet.has(i));
                    const penalty = calculateExtraNotesPenalty(extraIntervals, pattern.intervals);
                    matches.push({
                        pattern,
                        root: potentialRoot,
                        score: pattern.priority * 70 - 80 - penalty,
                        isRootless: true,
                        isExact: false
                    });
                }
            }
        }
    }

    if (matches.length === 0) {
        // No match found, return raw notes with root-based spelling
        const bassRootName = getRootSpelling(bassPitchClass, uniquePitchClasses);
        return {
            root: bassRootName,
            quality: '',
            bass: bassRootName,
            display: sorted.map(n => getChordToneSpelling(n % 12, bassPitchClass)).join(' '),
            intervals: uniquePitchClasses.map(n => (n - bassPitchClass + 12) % 12).sort((a, b) => a - b),
            detectedRootPitchClass: bassPitchClass
        };
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    let best = matches[0];

    // Calculate actual intervals from MIDI notes for octave-aware disambiguation
    const actualIntervals = calculateActualIntervals(sorted, best.root);

    // Check chord context for disambiguation
    const candidateIntervals = uniquePitchClasses.map(n => (n - best.root + 12) % 12);
    const hasMaj3 = candidateIntervals.includes(4);
    const hasMin3 = candidateIntervals.includes(3);
    const hasMaj7 = candidateIntervals.includes(11);
    const hasDom7 = candidateIntervals.includes(10);
    const has7th = hasMaj7 || hasDom7;
    const hasTritone = candidateIntervals.includes(6); // Could be b5 or #11
    const hasNatural5 = candidateIntervals.includes(7);
    const hasPitchClass8 = candidateIntervals.includes(8); // Could be #5 or b13

    // Use octave-aware disambiguation
    const tensionInfo = disambiguateTensions(
        actualIntervals,
        best.root,
        hasMaj3,
        hasMin3,
        has7th,
        hasNatural5
    );

    // --- #9 vs b3 disambiguation ---
    // Both pitch class 3 (b3/#9) and pitch class 4 (maj3) are present
    if (hasMin3 && hasMaj3) {
        if (tensionInfo.interval3IsSharp9) {
            // Octave analysis says it's #9 - PROMOTE to #9 pattern
            const sharp9Match = matches.find(m =>
                m.pattern.name.includes('#9') &&
                m.root === best.root &&
                m.score > best.score - 150
            );
            if (sharp9Match && !best.pattern.name.includes('#9')) {
                best = sharp9Match;
            } else if (!best.pattern.name.includes('#9') && !best.pattern.name.includes('m')) {
                // Pattern doesn't have #9 in name but should - rename if it's an add chord
                if (best.pattern.name === '' || best.pattern.name.startsWith('add') ||
                    best.pattern.name.startsWith('Maj') || best.pattern.name === '7') {
                    const originalPattern = best.pattern;
                    let newName = originalPattern.name;
                    if (newName === '') newName = 'add#9';
                    else if (!newName.includes('#9')) newName = newName + '(#9)';
                    best = {
                        ...best,
                        pattern: { ...originalPattern, name: newName }
                    };
                }
            }
        } else {
            // Octave analysis says it's b3 (not #9) - DEMOTE #9 patterns
            if (best.pattern.name.includes('#9')) {
                // Pattern has #9 but actual voicing has b3 below maj3
                if (!best.pattern.name.includes('7')) {
                    // Non-7th chord - look for cluster pattern
                    const clusterMatch = matches.find(m =>
                        (m.pattern.name === '(add b3)' || m.pattern.name === 'm(add 3)') &&
                        m.root === best.root
                    );
                    if (clusterMatch) {
                        best = clusterMatch;
                    } else {
                        // No cluster pattern found - rename the pattern
                        const originalPattern = best.pattern;
                        let newName = originalPattern.name.replace('#9', 'b3').replace('add', '(add ').replace('madd', 'm(add ');
                        if (newName.includes('(add ') && !newName.endsWith(')')) newName += ')';
                        best = {
                            ...best,
                            pattern: { ...originalPattern, name: newName }
                        };
                    }
                } else {
                    // 7th chord with #9 but b3 is below maj3 - rename to show cluster
                    // e.g., "7#9" becomes "7(add b3)" or similar
                    const originalPattern = best.pattern;
                    const newName = originalPattern.name.replace('#9', '(add b3)');
                    best = {
                        ...best,
                        pattern: { ...originalPattern, name: newName }
                    };
                }
            }
        }
    }

    // --- #11 vs b5 disambiguation ---
    if (hasTritone) {
        if (tensionInfo.interval6IsSharp11) {
            // Should be #11
            const sharp11Match = matches.find(m =>
                m.pattern.name.includes('#11') &&
                m.root === best.root &&
                m.score > best.score - 150
            );
            if (sharp11Match && !best.pattern.name.includes('#11')) {
                best = sharp11Match;
            } else if (best.pattern.name.includes('b5')) {
                // Rename b5 to #11
                const originalPattern = best.pattern;
                best = {
                    ...best,
                    pattern: {
                        ...originalPattern,
                        name: originalPattern.name.replace('b5', '#11')
                    }
                };
            } else if (best.pattern.name === '(b5)') {
                // Fragment pattern - select #11 variant
                const sharp11Fragment = matches.find(m =>
                    m.pattern.name === '(#11)' && m.root === best.root
                );
                if (sharp11Fragment) {
                    best = sharp11Fragment;
                }
            }
        } else {
            // Should be b5 (octave analysis says tritone is within the octave)
            if (best.pattern.name === '(#11)') {
                // Fragment pattern - select b5 variant or rename
                const b5Fragment = matches.find(m =>
                    m.pattern.name === '(b5)' && m.root === best.root
                );
                if (b5Fragment) {
                    best = b5Fragment;
                } else {
                    // No b5 pattern found - rename inline
                    best = {
                        ...best,
                        pattern: { ...best.pattern, name: '(b5)' }
                    };
                }
            } else if (best.pattern.name.includes('#11') && !hasNatural5) {
                // Has #11 in name but should be b5
                const b5Match = matches.find(m =>
                    m.pattern.name.includes('b5') &&
                    m.root === best.root &&
                    m.score > best.score - 150
                );
                if (b5Match) {
                    best = b5Match;
                } else {
                    const originalPattern = best.pattern;
                    best = {
                        ...best,
                        pattern: {
                            ...originalPattern,
                            name: originalPattern.name.replace('#11', 'b5')
                        }
                    };
                }
            }
        }
    }

    // --- #5 vs b13 disambiguation ---
    if (hasPitchClass8 && hasNatural5 && has7th) {
        // Has both 5th and pitch class 8 with 7th - likely b13, not #5
        if (best.pattern.name.includes('#5') && !best.pattern.name.includes('aug')) {
            const b13Match = matches.find(m =>
                m.pattern.name.includes('b13') &&
                m.root === best.root &&
                m.score > best.score - 150
            );
            if (b13Match) {
                best = b13Match;
            }
        }
    }

    // Use root-based enharmonic spelling
    const rootName = getRootSpelling(best.root, uniquePitchClasses);
    const bassName = getChordToneSpelling(bassPitchClass, best.root);
    const isInversion = best.root !== bassPitchClass && !best.isRootless;

    let displayName = `${rootName}${best.pattern.name}`;
    if (best.isRootless) {
        displayName += ' (rootless)';
    }
    if (isInversion) {
        displayName += `/${bassName}`;
    }

    // Store actual intervals for tension-aware note display
    const actualIntervalsArray = actualIntervals.map(ai => ai.actualInterval);

    return {
        root: rootName,
        quality: best.pattern.name,
        bass: bassName,
        display: displayName,
        intervals: best.pattern.intervals,
        detectedRootPitchClass: best.root,
        isRootless: best.isRootless,
        actualIntervals: actualIntervalsArray
    };
};

/**
 * COMPONENTS
 */

// === CHORD CARD COMPONENTS ===

interface ChordCardProps {
    segment: PhraseSegment;
    isActive?: boolean;
    isSelected?: boolean;
    onClick?: () => void;
}

const ChordCard: React.FC<ChordCardProps> = ({ segment, isActive = false, isSelected = false, onClick }) => {
    // Card dimensions - 20% larger
    const CARD_WIDTH = 156;
    const CARD_PADDING = 12;
    const STAFF_WIDTH = CARD_WIDTH - CARD_PADDING * 2;
    const STAFF_HEIGHT = 216;

    // Staff layout - scaled up proportionally
    const LINE_SPACING = 11;
    const TREBLE_BASE = 90;
    const BASS_BASE = 174;
    const TREBLE_TOP = TREBLE_BASE - 4 * LINE_SPACING;
    const CENTER_X = STAFF_WIDTH / 2;

    // Colors
    const STAFF_COLOR = isActive ? '#b87070' : '#a0937d';
    const NOTE_COLOR = isActive ? '#c41e3a' : '#3a3428';
    const LEDGER_COLOR = isActive ? '#c48888' : '#bfad94';

    // Note positioning helpers
    const chromaticToDiatonic = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
    const isAccidentalNote = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

    const getNoteY = useCallback((midi: number): number => {
        const octave = Math.floor(midi / 12) - 1;
        const diatonicStep = chromaticToDiatonic[midi % 12];
        const absoluteStep = octave * 7 + diatonicStep;

        if (midi >= 60) {
            const e4Step = 30;
            return TREBLE_BASE - ((absoluteStep - e4Step) * LINE_SPACING / 2);
        } else {
            const g2Step = 18;
            return BASS_BASE - ((absoluteStep - g2Step) * LINE_SPACING / 2);
        }
    }, []);

    const getLedgerLines = useCallback((midi: number, x: number): JSX.Element[] => {
        const lines: JSX.Element[] = [];
        const y = getNoteY(midi);
        const topLine = midi >= 60 ? TREBLE_TOP : BASS_BASE - 4 * LINE_SPACING;
        const bottomLine = midi >= 60 ? TREBLE_BASE : BASS_BASE;

        if (y > bottomLine) {
            for (let ly = bottomLine + LINE_SPACING; ly <= y + LINE_SPACING / 2; ly += LINE_SPACING) {
                lines.push(
                    <line key={`lb-${ly}`} x1={x - 11} y1={ly} x2={x + 11} y2={ly}
                        stroke={LEDGER_COLOR} strokeWidth="0.7" />
                );
            }
        }
        if (y < topLine) {
            for (let ly = topLine - LINE_SPACING; ly >= y - LINE_SPACING / 2; ly -= LINE_SPACING) {
                lines.push(
                    <line key={`lt-${ly}`} x1={x - 11} y1={ly} x2={x + 11} y2={ly}
                        stroke={LEDGER_COLOR} strokeWidth="0.7" />
                );
            }
        }
        return lines;
    }, [getNoteY]);

    // Calculate note head X positions - proper handling of seconds with stem direction
    const calculateNotePositions = useCallback((notes: number[], stemUp: boolean): Map<number, number> => {
        const positions = new Map<number, number>();
        if (notes.length === 0) return positions;

        const NOTE_HEAD_OFFSET = 11;

        // Initialize all at center
        for (const midi of notes) {
            positions.set(midi, CENTER_X);
        }

        if (notes.length === 1) return positions;

        // Process notes to find seconds that need offset
        // For stem up: offset upper note of second to the right
        // For stem down: offset lower note of second to the left
        const orderedNotes = stemUp ? [...notes] : [...notes].reverse();

        let needsOffset = false;

        for (let i = 1; i < orderedNotes.length; i++) {
            const currentMidi = orderedNotes[i];
            const prevMidi = orderedNotes[i - 1];

            const currentY = getNoteY(currentMidi);
            const prevY = getNoteY(prevMidi);
            const yDiff = Math.abs(currentY - prevY);

            // A second occurs when Y difference is small
            const isSecond = yDiff <= LINE_SPACING * 0.75;

            if (isSecond) {
                if (!needsOffset) {
                    const offset = stemUp ? NOTE_HEAD_OFFSET : -NOTE_HEAD_OFFSET;
                    positions.set(currentMidi, CENTER_X + offset);
                    needsOffset = true;
                } else {
                    needsOffset = false;
                }
            } else {
                needsOffset = false;
            }
        }

        return positions;
    }, [getNoteY, CENTER_X, LINE_SPACING]);

    // Calculate accidental positions - avoid collisions with other accidentals and note heads
    const calculateAccidentalPositions = useCallback((
        notes: number[],
        notePositions: Map<number, number>
    ): Map<number, number> => {
        const accidentalX = new Map<number, number>();

        // Collision constants scaled for card size
        const ACCIDENTAL_WIDTH = 11;
        const ACCIDENTAL_HEIGHT = 10;
        const NOTE_HEAD_WIDTH = 12;
        const NOTE_HEAD_HEIGHT = 10;
        const BASE_OFFSET = -15;

        // Get all note head positions
        const noteHeads = notes.map(midi => ({
            midi,
            y: getNoteY(midi),
            x: notePositions.get(midi) || CENTER_X
        }));

        // Get notes with accidentals, sorted by Y (top to bottom for proper stacking)
        const accidentalNotes = notes
            .filter(midi => isAccidentalNote(midi))
            .map(midi => ({
                midi,
                y: getNoteY(midi),
                noteX: notePositions.get(midi) || CENTER_X
            }))
            .sort((a, b) => a.y - b.y);

        if (accidentalNotes.length === 0) return accidentalX;

        // Track placed accidentals for collision detection
        const placedAccidentals: { y: number; x: number }[] = [];

        for (const note of accidentalNotes) {
            // Start to the left of the leftmost note position
            const leftmostX = Math.min(...noteHeads.map(n => n.x));
            let accX = leftmostX + BASE_OFFSET;

            let attempts = 0;
            const maxAttempts = 8;

            while (attempts < maxAttempts) {
                let collision = false;

                // Check collision with other placed accidentals
                for (const p of placedAccidentals) {
                    const yDiff = Math.abs(note.y - p.y);
                    const xOverlap = accX > p.x - ACCIDENTAL_WIDTH && accX < p.x + ACCIDENTAL_WIDTH;
                    if (yDiff < ACCIDENTAL_HEIGHT && xOverlap) {
                        collision = true;
                        break;
                    }
                }

                // Check collision with all note heads
                if (!collision) {
                    for (const nh of noteHeads) {
                        const yDiff = Math.abs(note.y - nh.y);
                        const accRight = accX + ACCIDENTAL_WIDTH;
                        const noteLeft = nh.x - NOTE_HEAD_WIDTH / 2;
                        if (yDiff < NOTE_HEAD_HEIGHT && accRight > noteLeft) {
                            collision = true;
                            break;
                        }
                    }
                }

                if (!collision) break;

                accX -= ACCIDENTAL_WIDTH;
                attempts++;
            }

            accidentalX.set(note.midi, accX);
            placedAccidentals.push({ y: note.y, x: accX });
        }

        return accidentalX;
    }, [getNoteY, CENTER_X]);

    const sortedNotes = useMemo(() => [...segment.notes].sort((a, b) => a - b), [segment.notes]);

    // Split notes for stem rendering
    const trebleNotes = useMemo(() => sortedNotes.filter(n => n >= 60), [sortedNotes]);
    const bassNotes = useMemo(() => sortedNotes.filter(n => n < 60), [sortedNotes]);

    // Calculate stem directions
    const trebleStemUp = useMemo(() => {
        if (trebleNotes.length === 0) return true;
        const avg = trebleNotes.reduce((a, b) => a + b, 0) / trebleNotes.length;
        return avg < 71;
    }, [trebleNotes]);

    const bassStemUp = useMemo(() => {
        if (bassNotes.length === 0) return true;
        const avg = bassNotes.reduce((a, b) => a + b, 0) / bassNotes.length;
        return avg < 50;
    }, [bassNotes]);

    // Calculate note positions with stem direction awareness
    const trebleNotePositions = useMemo(
        () => calculateNotePositions(trebleNotes, trebleStemUp),
        [calculateNotePositions, trebleNotes, trebleStemUp]
    );
    const bassNotePositions = useMemo(
        () => calculateNotePositions(bassNotes, bassStemUp),
        [calculateNotePositions, bassNotes, bassStemUp]
    );

    // Merge positions
    const notePositions = useMemo(() => {
        const merged = new Map<number, number>();
        trebleNotePositions.forEach((x, midi) => merged.set(midi, x));
        bassNotePositions.forEach((x, midi) => merged.set(midi, x));
        return merged;
    }, [trebleNotePositions, bassNotePositions]);

    // Calculate accidental positions with collision avoidance
    const accidentalPositions = useMemo(
        () => calculateAccidentalPositions(sortedNotes, notePositions),
        [calculateAccidentalPositions, sortedNotes, notePositions]
    );

    // Determine flat preference based on bass note
    const useFlat = useMemo(() => {
        if (sortedNotes.length === 0) return false;
        return shouldPreferFlat(sortedNotes[0] % 12);
    }, [sortedNotes]);

    // Render stem for a group of notes
    const renderStem = useCallback((notes: number[], stemUp: boolean, positions: Map<number, number>) => {
        if (notes.length === 0) return null;

        const sortedGroup = [...notes].sort((a, b) => a - b);
        const topY = getNoteY(sortedGroup[sortedGroup.length - 1]);
        const bottomY = getNoteY(sortedGroup[0]);

        // Find the rightmost or leftmost note position for stem attachment
        const noteXPositions = sortedGroup.map(n => positions.get(n) || CENTER_X);
        const stemAttachX = stemUp ? Math.max(...noteXPositions) : Math.min(...noteXPositions);

        const stemX = stemUp ? stemAttachX + 5 : stemAttachX - 5;
        const stemY1 = stemUp ? bottomY : topY;
        const stemY2 = stemUp
            ? Math.min(topY - 34, bottomY - 38)
            : Math.max(bottomY + 34, topY + 38);

        return (
            <line x1={stemX} y1={stemY1} x2={stemX} y2={stemY2}
                stroke={NOTE_COLOR} strokeWidth="1.3" />
        );
    }, [getNoteY, NOTE_COLOR, CENTER_X]);

    return (
        <div
            onClick={onClick}
            className={`
                flex-shrink-0 rounded-xl overflow-hidden transition-all duration-300 cursor-pointer
                ${isActive
                    ? 'bg-gradient-to-b from-red-50 via-orange-50 to-amber-50 border-2 border-red-400/60 shadow-xl shadow-red-300/30 scale-[1.08] z-10'
                    : isSelected
                    ? 'bg-gradient-to-b from-blue-50 via-indigo-50/30 to-white border-2 border-blue-400/70 shadow-lg shadow-blue-200/40 scale-[1.04] ring-2 ring-blue-300/50'
                    : 'bg-gradient-to-b from-amber-50 via-orange-50/30 to-white border border-amber-300/70 shadow-md hover:shadow-lg hover:scale-[1.02]'
                }
            `}
            style={{ width: CARD_WIDTH }}
        >
            {/* Header - Chord Name */}
            <div className={`
                px-3 py-2 text-center font-bold text-base border-b truncate
                ${isActive
                    ? 'bg-gradient-to-r from-red-100 via-red-50 to-red-100 border-red-200/60 text-red-900'
                    : isSelected
                    ? 'bg-gradient-to-r from-blue-100 via-blue-50 to-blue-100 border-blue-200/60 text-blue-900'
                    : 'bg-gradient-to-r from-amber-100/80 via-amber-50 to-amber-100/80 border-amber-200/60 text-stone-800'
                }
            `}>
                {segment.analysis?.display || '—'}
            </div>

            {/* Mini Staff */}
            <div className="px-2 py-3">
                <svg width={STAFF_WIDTH} height={STAFF_HEIGHT} className="block">
                    {/* Treble staff lines */}
                    {[0, 1, 2, 3, 4].map(i => (
                        <line key={`t${i}`}
                            x1={4} y1={TREBLE_BASE - i * LINE_SPACING}
                            x2={STAFF_WIDTH - 4} y2={TREBLE_BASE - i * LINE_SPACING}
                            stroke={STAFF_COLOR} strokeWidth="0.7" opacity="0.65"
                        />
                    ))}

                    {/* Bass staff lines */}
                    {[0, 1, 2, 3, 4].map(i => (
                        <line key={`b${i}`}
                            x1={4} y1={BASS_BASE - i * LINE_SPACING}
                            x2={STAFF_WIDTH - 4} y2={BASS_BASE - i * LINE_SPACING}
                            stroke={STAFF_COLOR} strokeWidth="0.7" opacity="0.65"
                        />
                    ))}

                    {/* Stems */}
                    {renderStem(trebleNotes, trebleStemUp, trebleNotePositions)}
                    {renderStem(bassNotes, bassStemUp, bassNotePositions)}

                    {/* Note heads */}
                    {sortedNotes.map((midi) => {
                        const noteX = notePositions.get(midi) || CENTER_X;
                        const y = getNoteY(midi);
                        const hasAcc = isAccidentalNote(midi);
                        const accX = accidentalPositions.get(midi);

                        return (
                            <g key={midi}>
                                {getLedgerLines(midi, noteX)}
                                {hasAcc && accX !== undefined && (
                                    <text x={accX} y={y + 4} fontSize="11"
                                        fontFamily="Times, serif" fill={NOTE_COLOR} opacity="0.85">
                                        {useFlat ? '♭' : '♯'}
                                    </text>
                                )}
                                <ellipse cx={noteX} cy={y} rx="5.5" ry="4.2"
                                    fill={NOTE_COLOR}
                                    transform={`rotate(-18 ${noteX} ${y})`}
                                />
                            </g>
                        );
                    })}
                </svg>
            </div>
        </div>
    );
};

// Container for card-based chord history with deck navigation
interface ChordCardHistoryProps {
    activeNotes: number[];
    history: PhraseSegment[];
    selectedIndex: number | null;
    onSelectCard: (index: number | null) => void;
}

const ChordCardHistory: React.FC<ChordCardHistoryProps> = ({ activeNotes, history, selectedIndex, onSelectCard }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [isHoveringLeft, setIsHoveringLeft] = useState(false);
    const [isHoveringRight, setIsHoveringRight] = useState(false);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const [isBrowsing, setIsBrowsing] = useState(false);
    const scrollIntervalRef = useRef<number | null>(null);

    // Filter to only chord segments
    const chordSegments = useMemo(() => history.filter(s => s.type === 'chord'), [history]);

    // Create segment for active notes
    const activeSegment = useMemo((): PhraseSegment | null => {
        if (activeNotes.length === 0) return null;
        return {
            type: 'chord',
            notes: activeNotes,
            timestamp: Date.now(),
            analysis: analyzeChord(activeNotes) || undefined
        };
    }, [activeNotes]);

    // Check scroll state
    const updateScrollState = useCallback(() => {
        if (scrollRef.current) {
            const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
            setCanScrollLeft(scrollLeft > 5);
            setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 5);
        }
    }, []);

    // Update scroll state on scroll and resize
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        updateScrollState();
        el.addEventListener('scroll', updateScrollState);
        window.addEventListener('resize', updateScrollState);

        return () => {
            el.removeEventListener('scroll', updateScrollState);
            window.removeEventListener('resize', updateScrollState);
        };
    }, [updateScrollState, chordSegments.length]);

    // Auto-scroll to end when new chords added (unless browsing or card selected)
    useEffect(() => {
        if (scrollRef.current && !isBrowsing && selectedIndex === null) {
            requestAnimationFrame(() => {
                if (scrollRef.current) {
                    scrollRef.current.scrollTo({
                        left: scrollRef.current.scrollWidth,
                        behavior: 'smooth'
                    });
                }
            });
        }
    }, [chordSegments.length, isBrowsing, selectedIndex]);

    // Continuous scroll while hovering - check bounds inside interval to avoid stutter
    useEffect(() => {
        if (isHoveringLeft) {
            setIsBrowsing(true);
            scrollIntervalRef.current = window.setInterval(() => {
                if (scrollRef.current && scrollRef.current.scrollLeft > 0) {
                    scrollRef.current.scrollBy({ left: -8, behavior: 'auto' });
                }
            }, 16);
        } else if (isHoveringRight) {
            scrollIntervalRef.current = window.setInterval(() => {
                if (scrollRef.current) {
                    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
                    if (scrollLeft < scrollWidth - clientWidth - 1) {
                        scrollRef.current.scrollBy({ left: 8, behavior: 'auto' });
                    }
                }
            }, 16);
        } else {
            if (scrollIntervalRef.current) {
                window.clearInterval(scrollIntervalRef.current);
                scrollIntervalRef.current = null;
            }
        }

        return () => {
            if (scrollIntervalRef.current) {
                window.clearInterval(scrollIntervalRef.current);
            }
        };
    }, [isHoveringLeft, isHoveringRight]);

    // Reset browsing state when scrolled to end
    useEffect(() => {
        if (!canScrollRight && isBrowsing) {
            setIsBrowsing(false);
        }
    }, [canScrollRight, isBrowsing]);

    const hasContent = chordSegments.length > 0 || activeSegment;

    // Jump to start/end handlers
    const scrollToStart = useCallback(() => {
        if (scrollRef.current) {
            setIsBrowsing(true);
            scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
        }
    }, []);

    const scrollToEnd = useCallback(() => {
        if (scrollRef.current) {
            setIsBrowsing(false);
            scrollRef.current.scrollTo({ left: scrollRef.current.scrollWidth, behavior: 'smooth' });
        }
    }, []);

    return (
        <div className="w-full bg-gradient-to-b from-stone-100 to-amber-50/50 rounded-xl border border-amber-200/50 shadow-inner relative">
            {/* Card count indicator */}
            {chordSegments.length > 0 && (
                <div className="absolute top-2 right-3 z-20 flex items-center gap-2">
                    <span className="text-xs text-amber-600/70 font-medium bg-amber-100/80 px-2 py-0.5 rounded-full">
                        {chordSegments.length} chord{chordSegments.length !== 1 ? 's' : ''}
                    </span>
                    {canScrollLeft && (
                        <button
                            onClick={scrollToStart}
                            className="text-xs text-amber-600 hover:text-amber-800 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded-full transition-colors"
                            title="Go to oldest"
                        >
                            ← First
                        </button>
                    )}
                    {canScrollRight && (
                        <button
                            onClick={scrollToEnd}
                            className="text-xs text-amber-600 hover:text-amber-800 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded-full transition-colors"
                            title="Go to newest"
                        >
                            Latest →
                        </button>
                    )}
                </div>
            )}

            {/* Left scroll zone - always rendered to preserve hover state */}
            <div
                className={`absolute left-0 top-0 bottom-0 w-16 z-10 flex items-center justify-start pl-2 transition-opacity duration-200 ${
                    canScrollLeft ? 'opacity-100 cursor-pointer' : 'opacity-0 pointer-events-none'
                }`}
                style={{
                    background: isHoveringLeft
                        ? 'linear-gradient(to right, rgba(251, 191, 36, 0.4), transparent)'
                        : 'linear-gradient(to right, rgba(251, 191, 36, 0.15), transparent)',
                }}
                onMouseEnter={() => setIsHoveringLeft(true)}
                onMouseLeave={() => setIsHoveringLeft(false)}
            >
                <div className={`
                    text-amber-600 transition-all duration-200
                    ${isHoveringLeft ? 'opacity-100 scale-110' : 'opacity-50 scale-100'}
                `}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                </div>
            </div>

            {/* Right scroll zone - always rendered to preserve hover state */}
            <div
                className={`absolute right-0 top-0 bottom-0 w-16 z-10 flex items-center justify-end pr-2 transition-opacity duration-200 ${
                    canScrollRight ? 'opacity-100 cursor-pointer' : 'opacity-0 pointer-events-none'
                }`}
                style={{
                    background: isHoveringRight
                        ? 'linear-gradient(to left, rgba(251, 191, 36, 0.4), transparent)'
                        : 'linear-gradient(to left, rgba(251, 191, 36, 0.15), transparent)',
                }}
                onMouseEnter={() => setIsHoveringRight(true)}
                onMouseLeave={() => setIsHoveringRight(false)}
            >
                <div className={`
                    text-amber-600 transition-all duration-200
                    ${isHoveringRight ? 'opacity-100 scale-110' : 'opacity-50 scale-100'}
                `}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </div>
            </div>

            {/* Scrollable card container */}
            <div
                ref={scrollRef}
                className="overflow-x-auto scrollbar-thin scrollbar-thumb-amber-300 scrollbar-track-transparent"
                style={{ scrollbarWidth: 'thin' }}
            >
                <div className="flex gap-3 p-4 pr-8 pl-6 min-w-min items-center">
                    {/* History cards */}
                    {chordSegments.map((segment, idx) => (
                        <ChordCard
                            key={`${segment.timestamp}-${idx}`}
                            segment={segment}
                            isSelected={selectedIndex === idx}
                            onClick={() => onSelectCard(selectedIndex === idx ? null : idx)}
                        />
                    ))}

                    {/* Active chord card - only show when no card is selected */}
                    {activeSegment && selectedIndex === null && (
                        <ChordCard
                            segment={activeSegment}
                            isActive={true}
                            onClick={() => onSelectCard(null)}
                        />
                    )}

                    {/* Empty state placeholder */}
                    {!hasContent && (
                        <div className="flex-shrink-0 w-[156px] h-[270px] rounded-xl border-2 border-dashed border-amber-300/50 flex items-center justify-center">
                            <span className="text-amber-400/70 text-sm font-medium text-center px-3">
                                Play a chord...
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// The Staff Component (SVG) - Grand Staff with phrase history
const Staff: React.FC<StaffProps> = ({ activeNotes, history }) => {
    // Layout constants
    const LINE_SPACING = 10;
    const TREBLE_BASE = 70;
    const BASS_BASE = 150;
    const STAFF_TOP = TREBLE_BASE - 4 * LINE_SPACING;
    const CLEF_AREA_WIDTH = 55;
    const CHORD_BASE_SPACING = 64;
    const SCALE_NOTE_SPACING = 18;
    const SEGMENT_GAP = 10;
    const ACTIVE_GAP = 45;
    const MIN_WIDTH = 320;
    const PADDING = 24;
    const LABEL_VERTICAL_OFFSET = 16;
    const LABEL_FONT_SIZE = 12;
    const LABEL_CHAR_WIDTH = 7.5;
    const LABEL_PADDING = 16;
    const LABEL_HEIGHT = 22;

    // Colors - classic black on cream
    const STAFF_LINE_COLOR = '#222';
    const LEDGER_LINE_COLOR = '#444';
    const CLEF_COLOR = '#1a1a1a';
    const BAR_LINE_COLOR = '#333';
    const HISTORY_NOTE_COLOR = '#1a1a1a';
    const ACTIVE_NOTE_COLOR = '#c41e3a';
    const LABEL_COLOR = '#3f3a33';
    const LABEL_BG_COLOR = '#fff6e8';
    const LABEL_BORDER_COLOR = '#e2c79a';

    // Chromatic to diatonic mapping
    const chromaticToDiatonic = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
    const isAccidental = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

    const getNoteY = useCallback((midi: number): number => {
        const octave = Math.floor(midi / 12) - 1;
        const diatonicStep = chromaticToDiatonic[midi % 12];
        const absoluteStep = octave * 7 + diatonicStep;

        if (midi >= 60) {
            const e4Step = 30;
            return TREBLE_BASE - ((absoluteStep - e4Step) * LINE_SPACING / 2);
        } else {
            const g2Step = 18;
            return BASS_BASE - ((absoluteStep - g2Step) * LINE_SPACING / 2);
        }
    }, []);

    const getLedgerLines = useCallback((midi: number, x: number, keyPrefix: string): JSX.Element[] => {
        const lines: JSX.Element[] = [];
        const y = getNoteY(midi);
        const topLine = midi >= 60 ? STAFF_TOP : BASS_BASE - 4 * LINE_SPACING;
        const bottomLine = midi >= 60 ? TREBLE_BASE : BASS_BASE;

        if (y > bottomLine) {
            for (let ly = bottomLine + LINE_SPACING; ly <= y + LINE_SPACING / 2; ly += LINE_SPACING) {
                lines.push(<line key={`${keyPrefix}-lb-${ly}`} x1={x - 10} y1={ly} x2={x + 10} y2={ly} stroke={LEDGER_LINE_COLOR} strokeWidth="0.75" />);
            }
        }
        if (y < topLine) {
            for (let ly = topLine - LINE_SPACING; ly >= y - LINE_SPACING / 2; ly -= LINE_SPACING) {
                lines.push(<line key={`${keyPrefix}-lt-${ly}`} x1={x - 10} y1={ly} x2={x + 10} y2={ly} stroke={LEDGER_LINE_COLOR} strokeWidth="0.75" />);
            }
        }
        return lines;
    }, [getNoteY]);

    // Render a single note head (without stem)
    const renderNoteHead = useCallback((midi: number, x: number, keyPrefix: string, color: string, isActive: boolean = false) => {
        const y = getNoteY(midi);
        const hasAccidental = isAccidental(midi);
        const glowFilter = isActive ? 'url(#activeGlow)' : undefined;

        return (
            <g key={`${keyPrefix}-${midi}`} filter={glowFilter}>
                {getLedgerLines(midi, x, keyPrefix)}
                {hasAccidental && (
                    <text x={x - 12} y={y + 3.5} fontSize="10" fontFamily="Times, serif" fill={color} opacity="0.9">♯</text>
                )}
                <ellipse cx={x} cy={y} rx="5" ry="4" fill={color} transform={`rotate(-20 ${x} ${y})`} />
            </g>
        );
    }, [getNoteY, getLedgerLines]);

    // Calculate X positions for note heads, handling seconds (adjacent notes)
    const calculateNoteHeadPositions = useCallback((groupNotes: number[], stemUp: boolean, baseX: number): Map<number, number> => {
        const positions = new Map<number, number>();
        const NOTE_HEAD_OFFSET = 9;

        if (groupNotes.length === 0) return positions;

        // Initialize all at base position
        for (const midi of groupNotes) {
            positions.set(midi, baseX);
        }

        if (groupNotes.length === 1) return positions;

        // Process notes to find seconds that need offset
        // For stem up: offset upper note of second to the right
        // For stem down: offset lower note of second to the left
        // For consecutive seconds, alternate the offset

        // groupNotes is sorted low midi to high midi
        // Process in stem direction order
        const orderedNotes = stemUp ? [...groupNotes] : [...groupNotes].reverse();

        let needsOffset = false;

        for (let i = 1; i < orderedNotes.length; i++) {
            const currentMidi = orderedNotes[i];
            const prevMidi = orderedNotes[i - 1];

            const currentY = getNoteY(currentMidi);
            const prevY = getNoteY(prevMidi);
            const yDiff = Math.abs(currentY - prevY);

            // A second occurs when Y difference is small (within ~0.7 of LINE_SPACING)
            const isSecond = yDiff <= LINE_SPACING * 0.7;

            if (isSecond) {
                if (!needsOffset) {
                    // Offset this note
                    const offset = stemUp ? NOTE_HEAD_OFFSET : -NOTE_HEAD_OFFSET;
                    positions.set(currentMidi, baseX + offset);
                    needsOffset = true; // Next second note goes back to normal
                } else {
                    // Previous was offset, this one stays normal
                    needsOffset = false;
                }
            } else {
                needsOffset = false;
            }
        }

        return positions;
    }, [getNoteY]);

    // Calculate accidental X positions, avoiding collisions with other accidentals AND note heads
    const calculateAccidentalPositions = useCallback((
        groupNotes: number[],
        notePositions: Map<number, number>,
        baseX: number
    ): Map<number, number> => {
        const accidentalX = new Map<number, number>();
        const ACCIDENTAL_WIDTH = 9;    // Horizontal space for one accidental
        const ACCIDENTAL_HEIGHT = 8;   // Vertical collision threshold
        const NOTE_HEAD_WIDTH = 10;    // Width of note head to avoid
        const NOTE_HEAD_HEIGHT = 8;    // Vertical extent of note head
        const BASE_OFFSET = -14;       // Base offset from note head

        // Get all note head positions for collision detection
        const noteHeads = groupNotes.map(midi => ({
            midi,
            y: getNoteY(midi),
            x: notePositions.get(midi) || baseX
        }));

        // Get notes with accidentals, sorted by Y position (top to bottom)
        const accidentalNotes = groupNotes
            .filter(midi => isAccidental(midi))
            .map(midi => ({
                midi,
                y: getNoteY(midi),
                noteX: notePositions.get(midi) || baseX
            }))
            .sort((a, b) => a.y - b.y);

        if (accidentalNotes.length === 0) return accidentalX;

        // Track placed accidentals
        const placedAccidentals: { y: number; x: number }[] = [];

        for (const note of accidentalNotes) {
            // Start position: to the left of the leftmost note head position
            const leftmostX = Math.min(baseX, note.noteX);
            let accX = leftmostX + BASE_OFFSET;

            let attempts = 0;
            const maxAttempts = 10;

            while (attempts < maxAttempts) {
                let collision = false;

                // Check collision with other accidentals
                for (const p of placedAccidentals) {
                    const yDiff = Math.abs(note.y - p.y);
                    const xOverlap = accX > p.x - ACCIDENTAL_WIDTH && accX < p.x + ACCIDENTAL_WIDTH;
                    if (yDiff < ACCIDENTAL_HEIGHT && xOverlap) {
                        collision = true;
                        break;
                    }
                }

                // Check collision with ALL note heads (not just this note's)
                if (!collision) {
                    for (const nh of noteHeads) {
                        const yDiff = Math.abs(note.y - nh.y);
                        // Accidental collides with note head if they overlap horizontally
                        const accRight = accX + ACCIDENTAL_WIDTH;
                        const noteLeft = nh.x - NOTE_HEAD_WIDTH / 2;
                        if (yDiff < NOTE_HEAD_HEIGHT && accRight > noteLeft) {
                            collision = true;
                            break;
                        }
                    }
                }

                if (!collision) break;

                accX -= ACCIDENTAL_WIDTH;
                attempts++;
            }

            accidentalX.set(note.midi, accX);
            placedAccidentals.push({ y: note.y, x: accX });
        }

        return accidentalX;
    }, [getNoteY]);

    // Render a single note head at specific position with separate accidental position
    const renderNoteHeadAt = useCallback((
        midi: number,
        noteX: number,
        accidentalX: number | null,
        keyPrefix: string,
        color: string,
        isActive: boolean,
        ledgerX: number,
        useFlat: boolean
    ) => {
        const y = getNoteY(midi);
        const hasAccidental = isAccidental(midi);
        const glowFilter = isActive ? 'url(#activeGlow)' : undefined;
        const accidentalSymbol = useFlat ? '♭' : '♯';

        return (
            <g key={`${keyPrefix}-${midi}`} filter={glowFilter}>
                {getLedgerLines(midi, ledgerX, keyPrefix)}
                {hasAccidental && accidentalX !== null && (
                    <text x={accidentalX} y={y + 3.5} fontSize="10" fontFamily="Times, serif" fill={color} opacity="0.9">{accidentalSymbol}</text>
                )}
                <ellipse cx={noteX} cy={y} rx="5" ry="4" fill={color} transform={`rotate(-20 ${noteX} ${y})`} />
            </g>
        );
    }, [getNoteY, getLedgerLines]);

    // Render a chord (group of notes with shared stem)
    const renderChordGroup = useCallback((notes: number[], x: number, keyPrefix: string, color: string, isActive: boolean = false) => {
        if (notes.length === 0) return null;

        // Determine if we should use flats based on the bass note
        // Flat-preferring pitch classes: 1 (Db), 3 (Eb), 6 (Gb), 8 (Ab), 10 (Bb)
        const sortedNotes = [...notes].sort((a, b) => a - b);
        const bassPitchClass = sortedNotes[0] % 12;
        const useFlat = shouldPreferFlat(bassPitchClass);

        // Split into Treble and Bass groups for separate stems
        const trebleNotes = notes.filter(n => n >= 60).sort((a, b) => a - b);
        const bassNotes = notes.filter(n => n < 60).sort((a, b) => a - b);

        const groups: { notes: number[]; isTreble: boolean }[] = [];
        if (trebleNotes.length > 0) groups.push({ notes: trebleNotes, isTreble: true });
        if (bassNotes.length > 0) groups.push({ notes: bassNotes, isTreble: false });

        return (
            <g key={`${keyPrefix}-chord`}>
                {groups.map((group, gIdx) => {
                    const groupNotes = group.notes;
                    const isTreble = group.isTreble;

                    // Determine stem direction based on average pitch vs staff center
                    const centerMidi = isTreble ? 71 : 50;
                    const avgMidi = groupNotes.reduce((a, b) => a + b, 0) / groupNotes.length;
                    const stemUp = avgMidi < centerMidi;

                    // Calculate note head positions (handling seconds)
                    const notePositions = calculateNoteHeadPositions(groupNotes, stemUp, x);

                    // Calculate accidental positions (staggered to avoid collisions)
                    const accidentalPositions = calculateAccidentalPositions(groupNotes, notePositions, x);

                    // Stem attaches to right side of notes for stem-up, left side for stem-down
                    const stemX = stemUp ? x + 4.5 : x - 4.5;

                    // Find Y extent of notes
                    const topNoteY = getNoteY(groupNotes[groupNotes.length - 1]);
                    const bottomNoteY = getNoteY(groupNotes[0]);

                    // Stem goes from outermost note to octave beyond
                    const stemY1 = stemUp ? bottomNoteY : topNoteY;
                    const stemY2 = stemUp ? Math.min(topNoteY - 28, bottomNoteY - 35) : Math.max(bottomNoteY + 28, topNoteY + 35);

                    return (
                        <g key={`${keyPrefix}-g${gIdx}`}>
                            {/* Stem */}
                            <line x1={stemX} y1={stemY1} x2={stemX} y2={stemY2} stroke={color} strokeWidth="1.25" />

                            {/* Note Heads with calculated positions */}
                            {groupNotes.map(midi => {
                                const noteX = notePositions.get(midi) || x;
                                const accX = accidentalPositions.get(midi) ?? null;
                                return renderNoteHeadAt(midi, noteX, accX, `${keyPrefix}-g${gIdx}`, color, isActive, x, useFlat);
                            })}
                        </g>
                    );
                })}
            </g>
        );
    }, [getNoteY, calculateNoteHeadPositions, calculateAccidentalPositions, renderNoteHeadAt]);

    const layout = useMemo(() => {
        type LayoutSegment = { segment: PhraseSegment; x: number; width: number; idx: number; labelWidth: number };
        let x = CLEF_AREA_WIDTH;
        const segments: LayoutSegment[] = [];

        history.forEach((segment, idx) => {
            let width: number;
            let labelWidth = CHORD_BASE_SPACING;

            if (segment.type === 'chord') {
                const labelText = segment.analysis?.display || '';
                const estimatedWidth = labelText.length > 0
                    ? labelText.length * LABEL_CHAR_WIDTH + LABEL_PADDING
                    : CHORD_BASE_SPACING;
                labelWidth = Math.max(CHORD_BASE_SPACING, estimatedWidth);
                width = labelWidth + 6; // a little breathing room between labels
            } else {
                const scaleWidth = segment.notes.length * SCALE_NOTE_SPACING + 24;
                width = Math.max(CHORD_BASE_SPACING, scaleWidth);
                labelWidth = width;
            }

            segments.push({ segment, x, width, idx, labelWidth });
            x += width + SEGMENT_GAP;
        });

        const activeX = x + (history.length > 0 ? ACTIVE_GAP : 15);
        const totalWidth = Math.max(MIN_WIDTH, activeX + PADDING + 40);

        return { segments, activeX, totalWidth };
    }, [history]);

    const sortedActiveNotes = useMemo(() => [...activeNotes].sort((a, b) => a - b), [activeNotes]);

    const trebleClef = (
        <g transform="translate(30, 28) scale(0.042)">
            <path fill={CLEF_COLOR} d="M557 1472q0 -61 -29 -115q-37 -68 -109 -128q-64 -54 -156 -107q-3 -47 -3 -78q0 -130 48 -243q37 -87 107 -159q67 -69 143 -107q21 -10 21 -31q0 -14 -11 -24q-14 -14 -33 -14q-11 0 -22 5q-95 46 -176 129q-82 84 -130 191q-55 123 -55 273q0 43 4 102q-57 -27 -95 -72 q-47 -55 -47 -133q0 -48 22 -95q19 -40 61 -77q35 -31 35 -69q0 -30 -21 -51q-21 -21 -51 -21q-39 0 -72 36q-65 71 -65 179q0 107 62 192q57 78 151 119q11 84 41 162q52 137 159 239q91 87 208 87q82 0 136 -54q52 -52 52 -135zM480 1303q0 54 -34 89q-34 36 -85 36 q-76 0 -144 -63q-77 -72 -116 -174q-22 -58 -31 -120q57 28 108 68q89 71 137 139q50 64 50 130q0 -5 0 -5q0 -3 0 -3q-2 -1 -2 -1q0 -2 0 -2v-3q0 3 0 3q1 3 2 3q0 1 0 1q0 2 0 2z" />
        </g>
    );

    const bassClef = (
        <g transform="translate(30, 120) scale(0.036)">
            <path fill={CLEF_COLOR} d="M557 512q0 -124 -70 -214q-78 -100 -205 -140q-34 -11 -34 -44q0 -23 16 -39q16 -17 40 -17q11 0 23 4q160 46 262 177q96 124 96 289q0 144 -76 260q-82 125 -228 182q-27 10 -27 36q0 15 10 27q13 15 33 15q7 0 15 -3q178 -62 282 -210q97 -139 97 -323zM160 544 q53 0 90 -37q37 -38 37 -91t-37 -90q-37 -37 -90 -37t-91 37q-37 37 -37 90t37 91q38 37 91 37zM160 288q53 0 90 -37q37 -38 37 -91t-37 -91q-37 -37 -90 -37t-91 37q-37 38 -37 91t37 91q38 37 91 37z" />
            <circle cx="370" cy="16" r="12" fill={CLEF_COLOR} />
            <circle cx="370" cy="48" r="12" fill={CLEF_COLOR} />
        </g>
    );

    const staffEndX = layout.totalWidth - PADDING;
    const midStaff = (TREBLE_BASE + BASS_BASE) / 2;

    return (
        <div className="w-full h-52 bg-amber-50 rounded-lg shadow-inner border border-amber-200 overflow-x-auto">
            <svg
                viewBox={`0 0 ${layout.totalWidth} 200`}
                className="h-full"
                style={{ minWidth: layout.totalWidth, width: '100%' }}
                preserveAspectRatio="xMinYMid meet"
            >
                <defs>
                    <filter id="activeGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="0" stdDeviation="1.5" floodColor="#c41e3a" floodOpacity="0.4" />
                    </filter>
                </defs>

                {/* Staff lines */}
                {[0, 1, 2, 3, 4].map(i => (
                    <line key={`treble-${i}`} x1={PADDING} y1={TREBLE_BASE - i * LINE_SPACING} x2={staffEndX} y2={TREBLE_BASE - i * LINE_SPACING} stroke={STAFF_LINE_COLOR} strokeWidth="0.75" />
                ))}
                {[0, 1, 2, 3, 4].map(i => (
                    <line key={`bass-${i}`} x1={PADDING} y1={BASS_BASE - i * LINE_SPACING} x2={staffEndX} y2={BASS_BASE - i * LINE_SPACING} stroke={STAFF_LINE_COLOR} strokeWidth="0.75" />
                ))}

                {/* Clefs */}
                {trebleClef}
                {bassClef}

                {/* Brace */}
                <path
                    d={`M${PADDING} ${STAFF_TOP} Q${PADDING - 8} ${midStaff - 25} ${PADDING} ${midStaff} Q${PADDING - 8} ${midStaff + 25} ${PADDING} ${BASS_BASE}`}
                    fill="none" stroke={BAR_LINE_COLOR} strokeWidth="2.5"
                />

                {/* Bar lines */}
                <line x1={PADDING} y1={STAFF_TOP} x2={PADDING} y2={BASS_BASE} stroke={BAR_LINE_COLOR} strokeWidth="1" />
                <line x1={staffEndX} y1={STAFF_TOP} x2={staffEndX} y2={BASS_BASE} stroke={BAR_LINE_COLOR} strokeWidth="1" />

                {/* History segments */}
                {layout.segments.map(({ segment, x, idx, labelWidth }) => {
                    const elements: JSX.Element[] = [];
                    const sortedNotes = [...segment.notes].sort((a, b) => a - b);

                    if (segment.type === 'chord') {
                        // Render as chord group
                        elements.push(renderChordGroup(sortedNotes, x, `h${idx}`, HISTORY_NOTE_COLOR, false) as JSX.Element);

                        if (segment.analysis) {
                            const labelY = STAFF_TOP - LABEL_VERTICAL_OFFSET;
                            const bubbleWidth = Math.max(labelWidth, CHORD_BASE_SPACING);
                            elements.push(
                                <g key={`h${idx}-label`}>
                                    <rect
                                        x={x - bubbleWidth / 2}
                                        y={labelY - LABEL_HEIGHT / 2}
                                        width={bubbleWidth}
                                        height={LABEL_HEIGHT}
                                        rx="6"
                                        fill={LABEL_BG_COLOR}
                                        stroke={LABEL_BORDER_COLOR}
                                        strokeWidth="0.8"
                                        opacity="0.96"
                                    />
                                    <text
                                        x={x}
                                        y={labelY}
                                        textAnchor="middle"
                                        dominantBaseline="middle"
                                        fontSize={LABEL_FONT_SIZE}
                                        fill={LABEL_COLOR}
                                        fontFamily="monospace"
                                        fontWeight="700"
                                    >
                                        {segment.analysis.display}
                                    </text>
                                </g>
                            );
                        }
                    } else {
                        // Render as scale (individual notes)
                        sortedNotes.forEach((note, nIdx) => {
                            elements.push(renderChordGroup([note], x + nIdx * SCALE_NOTE_SPACING, `h${idx}-n${nIdx}`, HISTORY_NOTE_COLOR, false) as JSX.Element);
                        });
                    }

                    return <g key={`segment-${idx}`}>{elements}</g>;
                })}

                {/* Active notes - Render as chord group */}
                {renderChordGroup(sortedActiveNotes, layout.activeX, 'active', ACTIVE_NOTE_COLOR, true)}
            </svg>
        </div>
    );
};

const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({ activeNotes, highlightedNotes = [], onNoteOn, onNoteOff }) => {
    const pressedKeysRef = useRef<Set<number>>(new Set());

    const startNote = 36; // C2
    const endNote = 84; // C6

    // 20% larger keyboard
    const WHITE_KEY_WIDTH = 37;
    const WHITE_KEY_HEIGHT = 130;
    const BLACK_KEY_WIDTH = 26;
    const BLACK_KEY_HEIGHT = 86;

    // Build white keys array and calculate black key positions
    const whiteKeys: number[] = [];
    const blackKeys: { midi: number; left: number }[] = [];

    // Black key offsets from left edge of preceding white key (as fraction of white key width)
    const blackKeyOffset: Record<number, number> = {
        1: 0.65,  // C#
        3: 0.75,  // D#
        6: 0.60,  // F#
        8: 0.68,  // G#
        10: 0.76, // A#
    };

    let whiteIndex = 0;
    for (let midi = startNote; midi <= endNote; midi++) {
        const pc = midi % 12;
        const isBlack = [1, 3, 6, 8, 10].includes(pc);
        if (!isBlack) {
            whiteKeys.push(midi);
            whiteIndex++;
        } else {
            const offset = blackKeyOffset[pc] || 0.65;
            blackKeys.push({
                midi,
                left: (whiteIndex - 1 + offset) * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2,
            });
        }
    }

    const totalWidth = whiteKeys.length * WHITE_KEY_WIDTH;

    const handlePointerDown = useCallback((midi: number, e: React.PointerEvent) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        if (!pressedKeysRef.current.has(midi)) {
            pressedKeysRef.current.add(midi);
            onNoteOn(midi);
        }
    }, [onNoteOn]);

    const handlePointerUp = useCallback((midi: number, e: React.PointerEvent) => {
        e.preventDefault();
        if (pressedKeysRef.current.has(midi)) {
            pressedKeysRef.current.delete(midi);
            onNoteOff(midi);
        }
    }, [onNoteOff]);

    const handlePointerLeave = useCallback((midi: number, e: React.PointerEvent) => {
        if (pressedKeysRef.current.has(midi)) {
            pressedKeysRef.current.delete(midi);
            onNoteOff(midi);
        }
    }, [onNoteOff]);

    return (
        <div className="w-full select-none overflow-x-auto touch-none flex justify-center py-2">
            <div
                className="relative"
                style={{ width: totalWidth, height: WHITE_KEY_HEIGHT }}
            >
                {/* White keys */}
                {whiteKeys.map((midi, idx) => {
                    const isActive = activeNotes.includes(midi);
                    const isHighlighted = highlightedNotes.includes(midi);
                    const isMatched = isActive && isHighlighted; // Pressed AND in selected chord
                    const isC = midi % 12 === 0;
                    const octave = Math.floor(midi / 12) - 1;

                    // Priority: matched (green) > active-only (red) > highlighted-only (blue) > default (white)
                    let bgColor = '#f8f8f8';
                    let borderColor = '#ccc';
                    let shadow = '0 2px 4px rgba(0, 0, 0, 0.15)';

                    if (isMatched) {
                        bgColor = '#4ade80';
                        borderColor = '#22c55e';
                        shadow = '0 0 14px rgba(34, 197, 94, 0.7)';
                    } else if (isActive) {
                        bgColor = '#ff6b6b';
                        borderColor = '#ff6b6b';
                        shadow = '0 0 12px rgba(255, 107, 107, 0.6)';
                    } else if (isHighlighted) {
                        bgColor = '#60a5fa';
                        borderColor = '#3b82f6';
                        shadow = '0 0 12px rgba(59, 130, 246, 0.5)';
                    }

                    return (
                        <div
                            key={midi}
                            onPointerDown={(e) => handlePointerDown(midi, e)}
                            onPointerUp={(e) => handlePointerUp(midi, e)}
                            onPointerLeave={(e) => handlePointerLeave(midi, e)}
                            onPointerCancel={(e) => handlePointerUp(midi, e)}
                            className="absolute cursor-pointer transition-all duration-50"
                            style={{
                                left: idx * WHITE_KEY_WIDTH,
                                width: WHITE_KEY_WIDTH,
                                height: WHITE_KEY_HEIGHT,
                                background: bgColor,
                                border: `1px solid ${borderColor}`,
                                boxShadow: shadow,
                                zIndex: 1,
                            }}
                        >
                            {isC && (
                                <span
                                    className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-bold pointer-events-none"
                                    style={{ color: (isHighlighted || isMatched) && !isActive ? '#fff' : isMatched ? '#166534' : '#999' }}
                                >
                                    C{octave}
                                </span>
                            )}
                        </div>
                    );
                })}

                {/* Black keys */}
                {blackKeys.map(({ midi, left }) => {
                    const isActive = activeNotes.includes(midi);
                    const isHighlighted = highlightedNotes.includes(midi);
                    const isMatched = isActive && isHighlighted; // Pressed AND in selected chord
                    const pc = midi % 12;

                    // Color-coded black keys: pair (C#/D#) = brown, trio (F#/G#/A#) = purple
                    const isPair = pc === 1 || pc === 3;
                    const defaultColors = isPair
                        ? { bg: 'linear-gradient(to bottom, #8b6b50, #5c4033)', border: '#9a7a60' }  // brown
                        : { bg: 'linear-gradient(to bottom, #7a6a90, #5a4a6a)', border: '#8a7a9a' }; // lighter purple

                    // Priority: matched (green) > active-only (red) > highlighted-only (blue) > default
                    let bgColor = defaultColors.bg;
                    let borderColor = defaultColors.border;
                    let shadow = '0 3px 6px rgba(0, 0, 0, 0.5)';

                    if (isMatched) {
                        bgColor = 'linear-gradient(to bottom, #22c55e, #15803d)';
                        borderColor = '#4ade80';
                        shadow = '0 0 14px rgba(34, 197, 94, 0.7)';
                    } else if (isActive) {
                        bgColor = '#e85555';
                        borderColor = '#ff6b6b';
                        shadow = '0 0 12px rgba(255, 107, 107, 0.6)';
                    } else if (isHighlighted) {
                        bgColor = 'linear-gradient(to bottom, #3b82f6, #1d4ed8)';
                        borderColor = '#60a5fa';
                        shadow = '0 0 12px rgba(59, 130, 246, 0.6)';
                    }

                    return (
                        <div
                            key={midi}
                            onPointerDown={(e) => handlePointerDown(midi, e)}
                            onPointerUp={(e) => handlePointerUp(midi, e)}
                            onPointerLeave={(e) => handlePointerLeave(midi, e)}
                            onPointerCancel={(e) => handlePointerUp(midi, e)}
                            className="absolute cursor-pointer transition-all duration-50"
                            style={{
                                left,
                                width: BLACK_KEY_WIDTH,
                                height: BLACK_KEY_HEIGHT,
                                background: bgColor,
                                border: `1px solid ${borderColor}`,
                                boxShadow: shadow,
                                zIndex: 2,
                            }}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default function MidiApp() {
    const [activeNotes, setActiveNotes] = useState<number[]>([]);
    const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
    const [status, setStatus] = useState<string>('Checking MIDI...');

    // Game State
    const [gameMode, setGameMode] = useState<'free' | 'training'>('free');
    const [targetChord, setTargetChord] = useState<TargetChord | null>(null);
    const [score, setScore] = useState<number>(0);
    const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);

    // Prevent re-triggering on same correct chord
    const hasMatchedRef = useRef<boolean>(false);

    // Phrase Printing State
    const [history, setHistory] = useState<PhraseSegment[]>([]);
    const [isPedalDown, setIsPedalDown] = useState<boolean>(false);
    const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);
    const noteBufferRef = useRef<{ note: number; time: number }[]>([]);
    const activeNotesRef = useRef<number[]>([]);

    // --- MIDI ENGINE ---
    const isPedalDownRef = useRef(false);
    const clusterTimerRef = useRef<number | null>(null);
    const PEDAL_CLUSTER_GAP_MS = 220;
    const CHORD_IOI_THRESHOLD_MS = 110;

    const clearClusterTimer = useCallback(() => {
        if (clusterTimerRef.current !== null) {
            window.clearTimeout(clusterTimerRef.current);
            clusterTimerRef.current = null;
        }
    }, []);

    const addSegmentToHistory = useCallback((segment: PhraseSegment) => {
        setHistory(prev => [...prev, segment]);
    }, []);

    const buildSegmentsFromEvents = useCallback((events: { note: number; time: number }[]) => {
        if (events.length === 0) return;

        const sortedEvents = [...events].sort((a, b) => a.time - b.time);
        const clusters: { note: number; time: number }[][] = [];
        let currentCluster: { note: number; time: number }[] = [sortedEvents[0]];

        for (let i = 1; i < sortedEvents.length; i++) {
            const ev = sortedEvents[i];
            const prev = sortedEvents[i - 1];
            if (ev.time - prev.time > PEDAL_CLUSTER_GAP_MS) {
                clusters.push(currentCluster);
                currentCluster = [ev];
            } else {
                currentCluster.push(ev);
            }
        }
        clusters.push(currentCluster);

        clusters.forEach(clusterEvents => {
            const uniqueNotes = Array.from(new Set(clusterEvents.map(e => e.note))).sort((a, b) => a - b);
            if (uniqueNotes.length === 0) return;

            let totalIOI = 0;
            for (let i = 1; i < clusterEvents.length; i++) {
                totalIOI += clusterEvents[i].time - clusterEvents[i - 1].time;
            }
            const avgIOI = clusterEvents.length > 1 ? totalIOI / (clusterEvents.length - 1) : 0;
            const timeSpan = clusterEvents[clusterEvents.length - 1].time - clusterEvents[0].time;
            const isChord = avgIOI < CHORD_IOI_THRESHOLD_MS || timeSpan < PEDAL_CLUSTER_GAP_MS * 0.6;

            const segment: PhraseSegment = {
                type: isChord ? 'chord' : 'scale',
                notes: uniqueNotes,
                timestamp: Date.now(),
                analysis: isChord ? analyzeChord(uniqueNotes) || undefined : undefined
            };

            addSegmentToHistory(segment);
        });
    }, [addSegmentToHistory]);

    const flushBuffer = useCallback(() => {
        if (noteBufferRef.current.length === 0) return;
        const events = noteBufferRef.current;
        noteBufferRef.current = [];
        clearClusterTimer();
        buildSegmentsFromEvents(events);
    }, [buildSegmentsFromEvents, clearClusterTimer]);

    const scheduleIdleFlush = useCallback(() => {
        if (!isPedalDownRef.current || noteBufferRef.current.length === 0) return;
        clearClusterTimer();
        clusterTimerRef.current = window.setTimeout(() => {
            flushBuffer();
        }, PEDAL_CLUSTER_GAP_MS);
    }, [clearClusterTimer, flushBuffer]);

    // Track MIDI access for cleanup
    const midiAccessRef = useRef<MIDIAccess | null>(null);

    useEffect(() => {
        const nav = navigator as NavigatorWithMIDI;
        if (!nav.requestMIDIAccess) {
            setStatus('Web MIDI API not supported in this browser');
            return;
        }

        let isMounted = true;

        const onMidiMessage = (msg: MIDIMessageEvent) => {
            if (!isMounted) return;
            const [command, data1, data2] = msg.data;

            // Note On
            if (command >= 144 && command <= 159 && data2 > 0) {
                const note = data1;
                setActiveNotes(prev => {
                    const next = [...new Set([...prev, note])];
                    activeNotesRef.current = next;
                    return next;
                });

                if (isPedalDownRef.current) {
                    noteBufferRef.current.push({ note, time: performance.now() });
                    scheduleIdleFlush();
                }
            }
            // Note Off
            else if ((command >= 128 && command <= 143) || (command >= 144 && command <= 159 && data2 === 0)) {
                const note = data1;
                setActiveNotes(prev => {
                    const next = prev.filter(n => n !== note);
                    activeNotesRef.current = next;
                    return next;
                });
            }
            // Control Change
            else if (command >= 176 && command <= 191) {
                const controller = data1;
                const value = data2;
                if (controller === 64) {
                    const pedalDown = value >= 64;
                    setIsPedalDown(pedalDown);

                    if (pedalDown) {
                        // Pedal down: start recording current chord snapshot or upcoming chord(s)
                        clearClusterTimer();
                        noteBufferRef.current = [];
                        const now = performance.now();
                        const snapshot = activeNotesRef.current;
                        if (snapshot.length > 0) {
                            noteBufferRef.current = snapshot.map(note => ({ note, time: now }));
                        }
                        isPedalDownRef.current = true;
                        scheduleIdleFlush();
                    } else {
                        // Pedal up: flush anything we collected (single tap or held-record mode)
                        isPedalDownRef.current = false;
                        clearClusterTimer();
                        flushBuffer();
                    }
                }
            }
        };

        const handleStateChange = (e: MIDIConnectionEvent) => {
            if (!isMounted) return;
            if (e.port.state === 'connected' && e.port.type === 'input') {
                (e.port as MIDIInput).onmidimessage = onMidiMessage;
            }
        };

        nav.requestMIDIAccess()
            .then((access) => {
                if (!isMounted) return;

                midiAccessRef.current = access;
                setMidiAccess(access);
                setStatus('Ready');

                for (const input of access.inputs.values()) {
                    input.onmidimessage = onMidiMessage;
                }

                access.onstatechange = handleStateChange;
            })
            .catch((err) => {
                if (!isMounted) return;
                console.error('MIDI access error:', err);
                if (err.name === 'SecurityError') {
                    setStatus('MIDI access denied - check permissions');
                } else if (err.name === 'AbortError') {
                    setStatus('MIDI access request was aborted');
                } else {
                    setStatus(`MIDI error: ${err.message || 'Unknown error'}`);
                }
            });

        return () => {
            isMounted = false;
            clearClusterTimer();

            // Clean up MIDI handlers
            const access = midiAccessRef.current;
            if (access) {
                access.onstatechange = null;
                for (const input of access.inputs.values()) {
                    input.onmidimessage = null;
                }
            }
        };
    }, [clearClusterTimer, flushBuffer, scheduleIdleFlush]);

    useEffect(() => {
        activeNotesRef.current = activeNotes;
    }, [activeNotes]);

    // --- CHORD ANALYSIS ---
    const currentChord = useMemo(() => analyzeChord(activeNotes), [activeNotes]);

    // Get selected chord from history (only chord segments)
    const chordHistory = useMemo(() => history.filter(s => s.type === 'chord'), [history]);
    const selectedSegment = useMemo(() => {
        if (selectedCardIndex === null || selectedCardIndex >= chordHistory.length) return null;
        return chordHistory[selectedCardIndex];
    }, [selectedCardIndex, chordHistory]);

    // Determine which chord to display: selected card or current playing
    const displayChord = useMemo(() => {
        if (selectedSegment?.analysis) return selectedSegment.analysis;
        return currentChord;
    }, [selectedSegment, currentChord]);

    // Notes to highlight on keyboard (from selected card)
    const highlightedNotes = useMemo(() => {
        if (!selectedSegment) return [];
        return selectedSegment.notes;
    }, [selectedSegment]);

    // --- GAME LOGIC ---
    // Target chord types using analyzer's exact quality names
    const TRAINING_CHORD_TYPES: { quality: string; displayName: string }[] = [
        { quality: '', displayName: 'Major' },
        { quality: 'm', displayName: 'Minor' },
        { quality: 'Maj7', displayName: 'Maj7' },
        { quality: 'min7', displayName: 'min7' },
        { quality: '7', displayName: 'Dom7' },
        { quality: 'dim', displayName: 'dim' },
        { quality: 'sus2', displayName: 'sus2' },
        { quality: 'sus4', displayName: 'sus4' },
    ];

    const generateTarget = useCallback(() => {
        // Use all 12 pitch classes, spelled consistently with analyzer output
        const roots = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
        const r = roots[Math.floor(Math.random() * roots.length)];
        const chordType = TRAINING_CHORD_TYPES[Math.floor(Math.random() * TRAINING_CHORD_TYPES.length)];
        setTargetChord({
            root: r,
            quality: chordType.quality,
            display: `${r}${chordType.quality ? chordType.quality : ''} (${chordType.displayName})`
        });
        setFeedback(null);
        hasMatchedRef.current = false;
    }, []);

    useEffect(() => {
        if (gameMode === 'training' && !targetChord) {
            generateTarget();
        }
    }, [gameMode, targetChord, generateTarget]);

    // Convert root name to pitch class for enharmonic-safe comparison
    const rootToPitchClass = useCallback((root: string): number => {
        const map: Record<string, number> = {
            'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
            'E': 4, 'Fb': 4, 'E#': 5, 'F': 5, 'F#': 6, 'Gb': 6,
            'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10,
            'B': 11, 'Cb': 11, 'B#': 0
        };
        return map[root] ?? -1;
    }, []);

    useEffect(() => {
        if (gameMode !== 'training' || !targetChord || !currentChord || hasMatchedRef.current) {
            return;
        }

        // Compare pitch classes (handles C# vs Db) and exact quality match
        const targetPitchClass = rootToPitchClass(targetChord.root);
        const currentPitchClass = rootToPitchClass(currentChord.root);
        const isMatch = targetPitchClass === currentPitchClass &&
                        currentChord.quality === targetChord.quality;

        if (isMatch) {
            hasMatchedRef.current = true;
            setFeedback('correct');
            setScore(s => s + 1);
            setTimeout(() => {
                generateTarget();
            }, 1000);
        }
    }, [currentChord, targetChord, gameMode, generateTarget, rootToPitchClass]);

    // --- HANDLERS ---
    const handleVirtualNoteOn = useCallback((note: number) => {
        setActiveNotes(prev => {
            const next = [...new Set([...prev, note])];
            activeNotesRef.current = next;
            return next;
        });

        if (isPedalDownRef.current) {
            noteBufferRef.current.push({ note, time: performance.now() });
            scheduleIdleFlush();
        }
    }, [scheduleIdleFlush]);

    const handleVirtualNoteOff = useCallback((note: number) => {
        setActiveNotes(prev => {
            const next = prev.filter(n => n !== note);
            activeNotesRef.current = next;
            return next;
        });
    }, []);

    const resetGame = useCallback(() => {
        setScore(0);
        setGameMode('training');
        setTargetChord(null);
        hasMatchedRef.current = false;
    }, []);

    const skipChord = useCallback(() => {
        generateTarget();
    }, [generateTarget]);

    // Memoize sorted notes for the interval display
    const sortedActiveNotes = useMemo(() => [...activeNotes].sort((a, b) => a - b), [activeNotes]);

    return (
        <div className="min-h-screen bg-stone-100 text-stone-800 font-sans selection:bg-amber-200">
            {/* Header - Compact */}
            <header className="bg-white border-b border-stone-200 px-4 py-2 shadow-sm sticky top-0 z-50">
                <div className="max-w-6xl mx-auto flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <div className="bg-amber-500 text-white p-1.5 rounded-md">
                            <Music size={18} />
                        </div>
                        <h1 className="text-lg font-bold tracking-tight text-stone-900">Midi Master</h1>
                        <span className={`flex items-center gap-1 text-xs ${midiAccess ? 'text-emerald-600' : 'text-amber-600'}`}>
                            <Cable size={10} />
                            {status}
                        </span>
                        {isPedalDown && (
                            <span className="bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full text-[10px] font-bold animate-pulse">
                                REC
                            </span>
                        )}
                    </div>
                    <div className="flex bg-slate-900 rounded-md p-0.5 border border-slate-700">
                        <button
                            onClick={() => setGameMode('free')}
                            className={`px-2 py-1 rounded text-xs font-medium transition-all ${gameMode === 'free' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                            Free Play
                        </button>
                        <button
                            onClick={resetGame}
                            className={`px-2 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${gameMode === 'training' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                            <Trophy size={12} /> Training
                        </button>
                    </div>
                </div>
            </header>

            {/* MAIN CONTENT */}
            <main className="flex-1 flex flex-col max-w-6xl mx-auto w-full px-4 py-3 gap-3">
                {/* TOP SECTION: Compact horizontal bar */}
                <div className={`rounded-xl px-4 py-3 border shadow-lg flex items-center justify-between gap-4 flex-wrap transition-all ${
                    selectedSegment
                        ? 'bg-slate-800 border-blue-500/50 ring-1 ring-blue-400/30'
                        : 'bg-slate-800 border-slate-700'
                }`}>
                    {/* Detected Chord - Main Display */}
                    <div className="flex items-center gap-4">
                        <div>
                            <span className={`text-[10px] uppercase tracking-wider ${selectedSegment ? 'text-blue-400' : 'text-slate-500'}`}>
                                {selectedSegment ? 'Selected' : 'Chord'}
                            </span>
                            <div className={`text-3xl md:text-4xl font-black tracking-tight transition-all ${
                                selectedSegment
                                    ? 'text-blue-300'
                                    : gameMode === 'training' && feedback === 'correct'
                                        ? 'text-green-400'
                                        : 'text-white'
                            }`}>
                                {displayChord ? displayChord.display : <span className="text-slate-600">...</span>}
                            </div>
                        </div>
                        {displayChord?.quality && (
                            <span className={`text-sm font-medium hidden sm:block ${selectedSegment ? 'text-blue-400' : 'text-blue-400'}`}>
                                {displayChord.quality}
                            </span>
                        )}
                    </div>

                    {/* Notes & Intervals - Inline */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {(selectedSegment ? [...selectedSegment.notes].sort((a, b) => a - b) : sortedActiveNotes).map((note, noteIndex) => {
                            const notePitchClass = note % 12;
                            const rootPitchClass = displayChord?.detectedRootPitchClass ?? (sortedActiveNotes[0] % 12);
                            const interval = (notePitchClass - rootPitchClass + 12) % 12;
                            const isRoot = notePitchClass === rootPitchClass;
                            const intervalName = isRoot ? 'R' : (INTERVALS[interval]?.split(' ')[0] || '?');
                            // Use tension-aware spelling based on detected chord quality
                            // Pass actual interval when available for accurate #/b disambiguation
                            const patternName = displayChord?.quality || '';
                            const actualInterval = displayChord?.actualIntervals?.[noteIndex];
                            const noteName = getChordToneWithTension(notePitchClass, rootPitchClass, patternName, actualInterval);

                            return (
                                <div key={note} className={`flex flex-col items-center px-2 py-1 rounded ${
                                    selectedSegment
                                        ? 'bg-blue-900/50 border border-blue-500/50'
                                        : 'bg-slate-900 border border-slate-600'
                                }`}>
                                    <span className="text-sm font-bold text-white">{noteName}</span>
                                    <span className="text-[8px] text-slate-400 uppercase">{intervalName}</span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Theory Info - Compact */}
                    <div className="flex items-center gap-3 text-xs">
                        <div className="hidden md:flex items-center gap-1">
                            <span className="text-slate-500">Root:</span>
                            <span className={`font-mono font-bold ${selectedSegment ? 'text-blue-300' : 'text-blue-300'}`}>
                                {displayChord?.root || '-'}
                            </span>
                        </div>
                        <div className="hidden md:flex items-center gap-1">
                            <span className="text-slate-500">Bass:</span>
                            <span className="text-purple-300 font-mono font-bold">{displayChord?.bass || '-'}</span>
                        </div>
                        <div className="hidden lg:flex items-center gap-1">
                            <span className="text-slate-500">Intervals:</span>
                            <span className="text-slate-300 font-mono">{displayChord?.intervals.join('-') || '-'}</span>
                        </div>
                    </div>

                    {/* Training Mode Target */}
                    {gameMode === 'training' && (
                        <div className="flex items-center gap-3 bg-slate-900/80 border border-slate-600 rounded-lg px-3 py-2">
                            <div className="text-center">
                                <span className="text-[10px] text-slate-400 uppercase block">Target</span>
                                <span className="text-lg font-bold text-amber-400">{targetChord?.display}</span>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-slate-300">
                                <Trophy size={12} className="text-yellow-500" />
                                {score}
                            </div>
                            <button onClick={skipChord} className="text-slate-400 hover:text-white">
                                <SkipForward size={14} />
                            </button>
                        </div>
                    )}
                </div>

                {/* BOTTOM SECTION: VISUALIZATION */}
                <div className="bg-slate-800 rounded-xl p-3 md:p-4 border border-slate-700 shadow-xl flex-1 flex flex-col gap-4">
                    {/* Card-based Chord History */}
                    <ChordCardHistory
                        activeNotes={activeNotes}
                        history={history}
                        selectedIndex={selectedCardIndex}
                        onSelectCard={setSelectedCardIndex}
                    />

                    {/* Keyboard View */}
                    <VirtualKeyboard
                        activeNotes={activeNotes}
                        highlightedNotes={highlightedNotes}
                        onNoteOn={handleVirtualNoteOn}
                        onNoteOff={handleVirtualNoteOff}
                    />
                </div>
            </main>
        </div>
    );
}
