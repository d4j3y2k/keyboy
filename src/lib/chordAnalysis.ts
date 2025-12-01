/**
 * Chord Analysis Library
 *
 * Core music theory logic for analyzing MIDI notes into chord names.
 * Handles complex jazz voicings, rootless chords, tensions, and enharmonic spelling.
 */

import type { ChordAnalysis, ChordPattern } from '../types';

// =============================================================================
// MUSIC THEORY CONSTANTS
// =============================================================================

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const INTERVALS = [
    'Root', 'min 2nd', 'Maj 2nd', 'min 3rd', 'Maj 3rd', 'Perf 4th',
    'Tritone', 'Perf 5th', 'min 6th', 'Maj 6th', 'min 7th', 'Maj 7th'
];

// =============================================================================
// NOTE DETAILS
// =============================================================================

export interface NoteDetails {
    note: string;
    octave: number;
    name: string;
    midi: number;
}

/** Convert MIDI number to note details (e.g., 60 -> { note: 'C', octave: 4, name: 'C4', midi: 60 }) */
export const getNoteDetails = (midi: number): NoteDetails => {
    const note = NOTES[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return { note, octave, name: `${note}${octave}`, midi };
};

// =============================================================================
// ENHARMONIC SPELLING
// =============================================================================

/** Get note name with optional flat preference */
export const getNoteName = (pitchClass: number, preferFlat: boolean = false): string => {
    return preferFlat ? NOTES_FLAT[pitchClass] : NOTES[pitchClass];
};

/**
 * Root-based scale spelling: determines how chord tones are spelled based on root.
 * Each root has a preferred spelling for its scale degrees.
 * Sharp roots (C#, F#, G#) use sharps; Flat roots (Db, Eb, Gb, Ab, Bb) use flats.
 */
export const ROOT_SPELLING: { [key: number]: { useFlat: boolean; scale: string[] } } = {
    0:  { useFlat: false, scale: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] },
    1:  { useFlat: false, scale: ['C#', 'D', 'D#', 'E', 'E#', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'B#'] },
    2:  { useFlat: false, scale: ['D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B', 'C', 'C#'] },
    3:  { useFlat: true,  scale: ['Eb', 'Fb', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'Cb', 'C', 'Db', 'D'] },
    4:  { useFlat: false, scale: ['E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B', 'C', 'C#', 'D', 'D#'] },
    5:  { useFlat: true,  scale: ['F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E'] },
    6:  { useFlat: false, scale: ['F#', 'G', 'G#', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'E#'] },
    7:  { useFlat: false, scale: ['G', 'Ab', 'A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#'] },
    8:  { useFlat: true,  scale: ['Ab', 'A', 'Bb', 'Cb', 'C', 'Db', 'D', 'Eb', 'Fb', 'F', 'Gb', 'G'] },
    9:  { useFlat: false, scale: ['A', 'Bb', 'B', 'C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#'] },
    10: { useFlat: true,  scale: ['Bb', 'Cb', 'C', 'Db', 'D', 'Eb', 'Fb', 'F', 'Gb', 'G', 'Ab', 'A'] },
    11: { useFlat: false, scale: ['B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#'] },
};

/**
 * Get root name based on common usage and context.
 * Handles all enharmonic pitch classes: C#/Db, D#/Eb, F#/Gb, G#/Ab, A#/Bb.
 */
export const getRootSpelling = (rootPitchClass: number, bassContext?: number[]): string => {
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
        if (hasFlatIndicators && !hasSharpIndicators) return 'Db';
        return 'C#';
    }

    // D#/Eb (pitch class 3)
    if (rootPitchClass === 3) {
        if (hasSharpIndicators && !hasFlatIndicators) {
            if (bassContext && (bassContext.includes(4) || bassContext.includes(11) || bassContext.includes(6))) {
                return 'D#';
            }
        }
        return 'Eb';
    }

    // F#/Gb (pitch class 6)
    if (rootPitchClass === 6) {
        if (hasFlatIndicators && bassContext &&
            (bassContext.includes(1) || bassContext.includes(8)) &&
            !bassContext.includes(4) && !bassContext.includes(11)) {
            return 'Gb';
        }
        return 'F#';
    }

    // G#/Ab (pitch class 8)
    if (rootPitchClass === 8) {
        if (hasSharpIndicators && !hasFlatIndicators) {
            if (bassContext && (bassContext.includes(4) || bassContext.includes(9) || bassContext.includes(11))) {
                return 'G#';
            }
        }
        return 'Ab';
    }

    // A#/Bb (pitch class 10)
    if (rootPitchClass === 10) {
        if (hasSharpIndicators && !hasFlatIndicators) {
            if (bassContext && (bassContext.includes(11) || bassContext.includes(6))) {
                return 'A#';
            }
        }
        return 'Bb';
    }

    return ROOT_SPELLING[rootPitchClass].scale[0];
};

/** Spell a chord tone relative to the root */
export const getChordToneSpelling = (pitchClass: number, rootPitchClass: number): string => {
    const interval = ((pitchClass - rootPitchClass) % 12 + 12) % 12;
    return ROOT_SPELLING[rootPitchClass].scale[interval];
};

/** Check if root prefers flats */
export const shouldPreferFlat = (rootPitchClass: number): boolean => {
    return ROOT_SPELLING[rootPitchClass].useFlat;
};

// =============================================================================
// TENSION SPELLING
// =============================================================================

interface TensionSpelling {
    [interval: number]: { natural: string; sharp: string; flat: string };
}

/** Get sharp spelling of a scale degree */
const getSharpSpelling = (rootPitchClass: number, scaleDegree: number): string => {
    const baseNote = ROOT_SPELLING[rootPitchClass].scale[scaleDegree];
    if (baseNote.includes('b')) {
        return baseNote.replace('b', '');
    } else if (baseNote.includes('#')) {
        return baseNote + '#';
    } else {
        return baseNote + '#';
    }
};

/** Get tension spellings for a root pitch class */
const getTensionSpellings = (rootPitchClass: number): TensionSpelling => {
    const spellings: TensionSpelling = {
        1: { // b9
            natural: ROOT_SPELLING[rootPitchClass].scale[1],
            sharp: ROOT_SPELLING[rootPitchClass].scale[1],
            flat: ROOT_SPELLING[rootPitchClass].scale[1]
        },
        3: { // #9 or b3
            natural: ROOT_SPELLING[rootPitchClass].scale[3],
            sharp: getSharpSpelling(rootPitchClass, 2),
            flat: ROOT_SPELLING[rootPitchClass].scale[3]
        },
        6: { // #11 or b5
            natural: ROOT_SPELLING[rootPitchClass].scale[6],
            sharp: getSharpSpelling(rootPitchClass, 5),
            flat: ROOT_SPELLING[rootPitchClass].scale[6]
        },
        8: { // b13 or #5
            natural: ROOT_SPELLING[rootPitchClass].scale[8],
            sharp: getSharpSpelling(rootPitchClass, 7),
            flat: ROOT_SPELLING[rootPitchClass].scale[8]
        }
    };
    return spellings;
};

/**
 * Determine tension quality from pattern name and/or actual interval.
 * When actualInterval is provided, use octave-aware logic for accurate disambiguation.
 */
const getTensionQuality = (
    patternName: string,
    interval: number,
    actualInterval?: number
): 'natural' | 'sharp' | 'flat' => {
    if (actualInterval !== undefined) {
        if (interval === 3) {
            if (actualInterval >= 14) return 'sharp';
            if (patternName.includes('#9')) return 'sharp';
            return 'natural';
        }
        if (interval === 6) {
            if (actualInterval >= 17) return 'sharp';
            if (patternName.includes('#11')) return 'sharp';
            if (patternName.includes('b5')) return 'flat';
            return 'flat';
        }
        if (interval === 8) {
            if (actualInterval >= 19) return 'flat';
            if (patternName.includes('b13')) return 'flat';
            if (patternName.includes('#5') || patternName.includes('aug')) return 'sharp';
            return 'sharp';
        }
    }

    if (interval === 3) {
        if (patternName.includes('#9')) return 'sharp';
        return 'natural';
    }
    if (interval === 6) {
        if (patternName.includes('#11')) return 'sharp';
        if (patternName.includes('b5')) return 'flat';
        return 'natural';
    }
    if (interval === 8) {
        if (patternName.includes('#5') || patternName.includes('aug')) return 'sharp';
        if (patternName.includes('b13')) return 'flat';
        return 'natural';
    }
    if (interval === 1) return 'flat';
    return 'natural';
};

/**
 * Spell a chord tone with tension awareness.
 * When actualInterval is provided (from MIDI octave analysis), use it for accurate #/b disambiguation.
 */
export const getChordToneWithTension = (
    pitchClass: number,
    rootPitchClass: number,
    patternName: string,
    actualInterval?: number
): string => {
    const interval = ((pitchClass - rootPitchClass) % 12 + 12) % 12;

    if (![1, 3, 6, 8].includes(interval)) {
        return ROOT_SPELLING[rootPitchClass].scale[interval];
    }

    const quality = getTensionQuality(patternName, interval, actualInterval);
    const spellings = getTensionSpellings(rootPitchClass);

    if (spellings[interval]) {
        return spellings[interval][quality];
    }

    return ROOT_SPELLING[rootPitchClass].scale[interval];
};

// =============================================================================
// INTERVAL CALCULATIONS
// =============================================================================

/** Normalize intervals to mod 12, sorted, unique */
export const normalizeIntervals = (intervals: number[]): number[] => {
    return Array.from(new Set(intervals.map(i => ((i % 12) + 12) % 12))).sort((a, b) => a - b);
};

interface ActualIntervalInfo {
    pitchClass: number;
    actualInterval: number;
    midi: number;
}

/**
 * Calculate actual intervals from MIDI notes (preserving octave information).
 * This allows distinguishing #9 (interval 15) from b3 (interval 3), etc.
 */
const calculateActualIntervals = (
    sortedMidiNotes: number[],
    rootPitchClass: number
): ActualIntervalInfo[] => {
    if (sortedMidiNotes.length === 0) return [];

    let rootMidi: number;
    const rootInstances = sortedMidiNotes.filter(n => n % 12 === rootPitchClass);

    if (rootInstances.length > 0) {
        rootMidi = Math.min(...rootInstances);
    } else {
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

const getActualIntervalForPitchClass = (
    actualIntervals: ActualIntervalInfo[],
    targetPitchClass: number,
    rootPitchClass: number
): number => {
    const expectedMod12 = ((targetPitchClass - rootPitchClass) % 12 + 12) % 12;
    const matches = actualIntervals.filter(info => info.pitchClass === targetPitchClass);

    if (matches.length === 0) return expectedMod12;

    const compoundMatch = matches.find(m => m.actualInterval > 12);
    if (compoundMatch) return compoundMatch.actualInterval;

    return Math.min(...matches.map(m => m.actualInterval));
};

interface TensionDisambiguation {
    interval3IsSharp9: boolean;
    interval6IsSharp11: boolean;
    interval8IsSharp5: boolean;
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

    // #9 vs b3 disambiguation
    const pitchClass3 = ((rootPitchClass + 3) % 12);
    const interval3Actual = getActualIntervalForPitchClass(actualIntervals, pitchClass3, rootPitchClass);

    if (interval3Actual >= 14) {
        result.interval3IsSharp9 = true;
    } else if (hasMaj3) {
        const maj3PitchClass = (rootPitchClass + 4) % 12;
        const maj3Instances = actualIntervals.filter(i => i.pitchClass === maj3PitchClass);
        const pc3Instances = actualIntervals.filter(i => i.pitchClass === pitchClass3);

        if (maj3Instances.length > 0 && pc3Instances.length > 0) {
            const lowestMaj3 = Math.min(...maj3Instances.map(i => i.midi));
            const lowestPc3 = Math.min(...pc3Instances.map(i => i.midi));
            if (lowestPc3 > lowestMaj3) {
                result.interval3IsSharp9 = true;
            }
        } else if (has7th && pc3Instances.length > 0) {
            result.interval3IsSharp9 = true;
        }
    }

    // #11 vs b5 disambiguation
    const pitchClass6 = ((rootPitchClass + 6) % 12);
    const interval6Actual = getActualIntervalForPitchClass(actualIntervals, pitchClass6, rootPitchClass);

    if (interval6Actual >= 17) {
        result.interval6IsSharp11 = true;
    } else if (hasPerfect5 && hasMaj3) {
        result.interval6IsSharp11 = true;
    } else if (has7th && hasMaj3 && !hasPerfect5) {
        const hasMaj7 = actualIntervals.some(i => ((i.pitchClass - rootPitchClass + 12) % 12) === 11);
        if (hasMaj7) {
            result.interval6IsSharp11 = true;
        }
    }

    // #5 vs b13 disambiguation
    const pitchClass8 = ((rootPitchClass + 8) % 12);
    const interval8Actual = getActualIntervalForPitchClass(actualIntervals, pitchClass8, rootPitchClass);

    if (interval8Actual >= 19) {
        result.interval8IsSharp5 = false;
    } else if (hasPerfect5) {
        result.interval8IsSharp5 = false;
    } else if (!hasPerfect5 && !has7th) {
        result.interval8IsSharp5 = true;
    }

    return result;
};

// =============================================================================
// CHORD PATTERNS
// =============================================================================

const COMMON_EXTENSIONS = new Set([2, 5, 9]);

const calculateExtraNotesPenalty = (extraIntervals: number[], patternIntervals: number[]): number => {
    let penalty = 0;
    const patternHas7th = patternIntervals.some(i => i === 10 || i === 11);

    for (const interval of extraIntervals) {
        if (COMMON_EXTENSIONS.has(interval)) {
            penalty += patternHas7th ? 3 : 6;
        } else {
            penalty += 18;
        }
    }
    return penalty;
};

export const CHORD_PATTERNS: ChordPattern[] = [
    // 13th chords
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

    // Altered dominants with multiple alterations
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
    { name: '7#5#9', intervals: normalizeIntervals([0, 4, 8, 10, 15]), priority: 56 },
    { name: '7#5b9', intervals: normalizeIntervals([0, 4, 8, 10, 13]), priority: 56 },
    { name: '7b5b9', intervals: normalizeIntervals([0, 4, 6, 10, 13]), priority: 56 },
    { name: '7b5#9', intervals: normalizeIntervals([0, 4, 6, 10, 15]), priority: 56 },
    { name: '7b13', intervals: normalizeIntervals([0, 4, 7, 10, 20]), priority: 53 },

    // Half-diminished extensions
    { name: 'm9b5', intervals: normalizeIntervals([0, 3, 6, 10, 14]), priority: 56 },
    { name: 'm11b5', intervals: normalizeIntervals([0, 3, 6, 10, 14, 17]), priority: 58 },
    { name: 'm7b5(11)', intervals: normalizeIntervals([0, 3, 6, 10, 17]), priority: 54 },

    // #11 chords (Lydian)
    { name: 'Maj7#11', intervals: normalizeIntervals([0, 4, 7, 11, 18]), priority: 52, allowOmit5th: true },
    { name: '7#11', intervals: normalizeIntervals([0, 4, 7, 10, 18]), priority: 52, allowOmit5th: true },

    // 6/9 chords
    { name: '6/9', intervals: normalizeIntervals([0, 4, 7, 9, 14]), priority: 52, allowOmit5th: true },
    { name: 'min6/9', intervals: normalizeIntervals([0, 3, 7, 9, 14]), priority: 52, allowOmit5th: true },

    // Sus7 chords
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
    { name: 'Maj7#5', intervals: [0, 4, 8, 11], priority: 46 },
    { name: '7#5', intervals: [0, 4, 8, 10], priority: 46 },
    { name: '7b5', intervals: [0, 4, 6, 10], priority: 46 },

    // Sixth chords
    { name: '6', intervals: [0, 4, 7, 9], priority: 42, allowOmit5th: true },
    { name: 'min6', intervals: [0, 3, 7, 9], priority: 42, allowOmit5th: true },

    // Add chords
    { name: 'add9', intervals: normalizeIntervals([0, 4, 7, 14]), priority: 40, allowOmit5th: true },
    { name: 'madd9', intervals: normalizeIntervals([0, 3, 7, 14]), priority: 40, allowOmit5th: true },
    { name: 'add11', intervals: normalizeIntervals([0, 4, 7, 17]), priority: 40, allowOmit5th: true },
    { name: 'madd11', intervals: normalizeIntervals([0, 3, 7, 17]), priority: 40, allowOmit5th: true },
    { name: 'add#11', intervals: normalizeIntervals([0, 4, 7, 18]), priority: 40 },
    { name: 'add#9', intervals: normalizeIntervals([0, 4, 7, 15]), priority: 41, allowOmit5th: true },
    { name: 'madd#9', intervals: normalizeIntervals([0, 3, 7, 15]), priority: 41, allowOmit5th: true },
    { name: '(add b3)', intervals: [0, 3, 4, 7], priority: 40 },
    { name: 'm(add 3)', intervals: [0, 3, 4, 7], priority: 39 },

    // Triads
    { name: '', intervals: [0, 4, 7], priority: 35 },
    { name: 'm', intervals: [0, 3, 7], priority: 35 },
    { name: 'dim', intervals: [0, 3, 6], priority: 35 },
    { name: 'aug', intervals: [0, 4, 8], priority: 35 },
    { name: 'sus2', intervals: [0, 2, 7], priority: 33 },
    { name: 'sus4', intervals: [0, 5, 7], priority: 33 },

    // Lydian triad fragment
    { name: '(#11)', intervals: [0, 4, 6], priority: 34 },
    { name: '(b5)', intervals: [0, 4, 6], priority: 33 },

    // Quartal voicings
    { name: 'quartal', intervals: normalizeIntervals([0, 5, 10]), priority: 22 },
    { name: 'quartal4', intervals: normalizeIntervals([0, 5, 10, 15]), priority: 23 },

    // Power chord
    { name: '5', intervals: [0, 7], priority: 20 },
];

// =============================================================================
// MAIN ANALYSIS FUNCTION
// =============================================================================

/**
 * Analyze active MIDI notes to determine the chord name with fuzzy matching.
 * Handles rootless voicings, tensions, inversions, and omitted 5ths.
 */
export const analyzeChord = (activeNotes: number[]): ChordAnalysis | null => {
    if (activeNotes.length < 1) return null;

    const sorted = [...activeNotes].sort((a, b) => a - b);
    const bassMidi = sorted[0];
    const bassPitchClass = bassMidi % 12;
    const uniquePitchClasses = Array.from(new Set(sorted.map(n => n % 12))).sort((a, b) => a - b);

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

            // Exact match
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

            // Superset match
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

            // Match with omitted 5th
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

    // Try rootless detection
    for (let potentialRoot = 0; potentialRoot < 12; potentialRoot++) {
        if (uniquePitchClasses.includes(potentialRoot)) continue;

        const intervals = uniquePitchClasses
            .map(n => (n - potentialRoot + 12) % 12)
            .sort((a, b) => a - b);
        const intervalSet = new Set(intervals);

        for (const pattern of CHORD_PATTERNS) {
            if (pattern.intervals.length < 4) continue;
            if (!pattern.intervals.includes(0)) continue;

            const patternWithoutRoot = pattern.intervals.filter(i => i !== 0);
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

    matches.sort((a, b) => b.score - a.score);
    let best = matches[0];

    // Calculate actual intervals for disambiguation
    const actualIntervals = calculateActualIntervals(sorted, best.root);

    // Check chord context
    const candidateIntervals = uniquePitchClasses.map(n => (n - best.root + 12) % 12);
    const hasMaj3 = candidateIntervals.includes(4);
    const hasMin3 = candidateIntervals.includes(3);
    const hasMaj7 = candidateIntervals.includes(11);
    const hasDom7 = candidateIntervals.includes(10);
    const has7th = hasMaj7 || hasDom7;
    const hasTritone = candidateIntervals.includes(6);
    const hasNatural5 = candidateIntervals.includes(7);
    const hasPitchClass8 = candidateIntervals.includes(8);

    const tensionInfo = disambiguateTensions(
        actualIntervals,
        best.root,
        hasMaj3,
        hasMin3,
        has7th,
        hasNatural5
    );

    // #9 vs b3 disambiguation
    if (hasMin3 && hasMaj3) {
        if (tensionInfo.interval3IsSharp9) {
            const sharp9Match = matches.find(m =>
                m.pattern.name.includes('#9') &&
                m.root === best.root &&
                m.score > best.score - 150
            );
            if (sharp9Match && !best.pattern.name.includes('#9')) {
                best = sharp9Match;
            } else if (!best.pattern.name.includes('#9') && !best.pattern.name.includes('m')) {
                if (best.pattern.name === '' || best.pattern.name.startsWith('add') ||
                    best.pattern.name.startsWith('Maj') || best.pattern.name === '7') {
                    const originalPattern = best.pattern;
                    let newName = originalPattern.name;
                    if (newName === '') newName = 'add#9';
                    else if (!newName.includes('#9')) newName = newName + '(#9)';
                    best = { ...best, pattern: { ...originalPattern, name: newName } };
                }
            }
        } else {
            if (best.pattern.name.includes('#9')) {
                if (!best.pattern.name.includes('7')) {
                    const clusterMatch = matches.find(m =>
                        (m.pattern.name === '(add b3)' || m.pattern.name === 'm(add 3)') &&
                        m.root === best.root
                    );
                    if (clusterMatch) {
                        best = clusterMatch;
                    } else {
                        const originalPattern = best.pattern;
                        let newName = originalPattern.name.replace('#9', 'b3').replace('add', '(add ').replace('madd', 'm(add ');
                        if (newName.includes('(add ') && !newName.endsWith(')')) newName += ')';
                        best = { ...best, pattern: { ...originalPattern, name: newName } };
                    }
                } else {
                    const originalPattern = best.pattern;
                    const newName = originalPattern.name.replace('#9', '(add b3)');
                    best = { ...best, pattern: { ...originalPattern, name: newName } };
                }
            }
        }
    }

    // #11 vs b5 disambiguation
    if (hasTritone) {
        if (tensionInfo.interval6IsSharp11) {
            const sharp11Match = matches.find(m =>
                m.pattern.name.includes('#11') &&
                m.root === best.root &&
                m.score > best.score - 150
            );
            if (sharp11Match && !best.pattern.name.includes('#11')) {
                best = sharp11Match;
            } else if (best.pattern.name.includes('b5')) {
                const originalPattern = best.pattern;
                best = { ...best, pattern: { ...originalPattern, name: originalPattern.name.replace('b5', '#11') } };
            } else if (best.pattern.name === '(b5)') {
                const sharp11Fragment = matches.find(m =>
                    m.pattern.name === '(#11)' && m.root === best.root
                );
                if (sharp11Fragment) best = sharp11Fragment;
            }
        } else {
            if (best.pattern.name === '(#11)') {
                const b5Fragment = matches.find(m =>
                    m.pattern.name === '(b5)' && m.root === best.root
                );
                if (b5Fragment) {
                    best = b5Fragment;
                } else {
                    best = { ...best, pattern: { ...best.pattern, name: '(b5)' } };
                }
            } else if (best.pattern.name.includes('#11') && !hasNatural5) {
                const b5Match = matches.find(m =>
                    m.pattern.name.includes('b5') &&
                    m.root === best.root &&
                    m.score > best.score - 150
                );
                if (b5Match) {
                    best = b5Match;
                } else {
                    const originalPattern = best.pattern;
                    best = { ...best, pattern: { ...originalPattern, name: originalPattern.name.replace('#11', 'b5') } };
                }
            }
        }
    }

    // #5 vs b13 disambiguation
    if (hasPitchClass8 && hasNatural5 && has7th) {
        if (best.pattern.name.includes('#5') && !best.pattern.name.includes('aug')) {
            const b13Match = matches.find(m =>
                m.pattern.name.includes('b13') &&
                m.root === best.root &&
                m.score > best.score - 150
            );
            if (b13Match) best = b13Match;
        }
    }

    const rootName = getRootSpelling(best.root, uniquePitchClasses);
    const bassName = getChordToneSpelling(bassPitchClass, best.root);
    const isInversion = best.root !== bassPitchClass && !best.isRootless;

    let displayName = `${rootName}${best.pattern.name}`;
    if (best.isRootless) displayName += ' (rootless)';
    if (isInversion) displayName += `/${bassName}`;

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
