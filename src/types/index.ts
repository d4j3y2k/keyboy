/**
 * Core type definitions for Chorduroy
 *
 * Card-based architecture where Cards are the source of truth
 * for notation rendering, playback, and editing.
 */

// Re-export MIDI types
export type {
    MIDIMessageEvent,
    MIDIInput,
    MIDIOutput,
    MIDIConnectionEvent,
    MIDIAccess,
    NavigatorWithMIDI,
} from './midi';

// =============================================================================
// DURATION
// =============================================================================

/** VexFlow-compatible duration values */
export type Duration = 'w' | 'h' | 'q' | '8' | '16';

/** Duration metadata for UI and playback */
export const DURATION_INFO: Record<Duration, { label: string; beats: number; ppq: number }> = {
    'w':  { label: 'Whole',      beats: 4,    ppq: 1920 },
    'h':  { label: 'Half',       beats: 2,    ppq: 960  },
    'q':  { label: 'Quarter',    beats: 1,    ppq: 480  },
    '8':  { label: 'Eighth',     beats: 0.5,  ppq: 240  },
    '16': { label: 'Sixteenth',  beats: 0.25, ppq: 120  },
};

/** Standard PPQ (pulses per quarter note) - matches MIDI standard */
export const PPQ = 480;

// =============================================================================
// CHORD ANALYSIS
// =============================================================================

export interface ChordAnalysis {
    root: string;
    quality: string;
    bass: string;
    display: string;
    intervals: number[];
    detectedRootPitchClass: number;
    isRootless?: boolean;
    /** Actual intervals from MIDI (preserving octave info) for tension disambiguation */
    actualIntervals?: number[];
}

/** Target chord for training mode */
export interface TargetChord {
    root: string;
    quality: string;
    display: string;
}

export interface ChordPattern {
    name: string;
    intervals: number[];
    priority: number;
    allowOmit5th?: boolean;
}

// =============================================================================
// CARD
// =============================================================================

/**
 * A Card represents a single musical event (chord or rest) in the sequence.
 * Cards are the atomic unit of the composition - all rendering, playback,
 * and editing operates on cards.
 */
export interface Card {
    /** Stable unique ID for undo/redo, drag-drop, React keys */
    id: string;

    /** MIDI note numbers (empty for rest cards) */
    notes: number[];

    /** Duration for notation and playback */
    duration: Duration;

    /** True if this is a rest (notes should be empty) */
    isRest: boolean;

    /** Cached chord analysis result */
    analysis?: ChordAnalysis;

    /** Optional overrides for enharmonic spelling per note */
    enharmonicOverrides?: Record<number, string>;

    /** Timestamp when card was created (for history/ordering) */
    createdAt: number;
}

// =============================================================================
// SEQUENCE
// =============================================================================

export type TimeSignature = [number, number]; // [beats, beatUnit] e.g., [4, 4] or [6, 8]

/**
 * A Sequence is the top-level container for a musical piece.
 * Contains tempo, time signature, and one or more tracks of cards.
 */
export interface Sequence {
    /** Unique ID for the sequence */
    id: string;

    /** Display name */
    name: string;

    /** Tempo in BPM */
    tempo: number;

    /** Time signature [beats, beatUnit] */
    timeSignature: TimeSignature;

    /**
     * Track structure - single track for Phase 1-2,
     * will expand to rightHand/leftHand in Phase 3
     */
    tracks: {
        master: Card[];
        // Phase 3:
        // rightHand?: Card[];
        // leftHand?: Card[];
    };

    /** When the sequence was created */
    createdAt: number;

    /** When the sequence was last modified */
    updatedAt: number;
}

// =============================================================================
// PLAYBACK
// =============================================================================

export type PlaybackState = 'stopped' | 'playing' | 'paused';

export interface PlaybackPosition {
    /** Current card index being played */
    cardIndex: number;

    /** Current tick position (in PPQ units) */
    tick: number;

    /** Current beat position */
    beat: number;

    /** Current measure */
    measure: number;
}

// =============================================================================
// LEGACY COMPATIBILITY
// =============================================================================

/**
 * @deprecated Use Card instead. Kept for migration compatibility.
 */
export interface PhraseSegment {
    type: 'chord' | 'scale';
    notes: number[];
    timestamp: number;
    analysis?: ChordAnalysis;
    duration: Duration;
}

/**
 * Convert a legacy PhraseSegment to a Card
 */
export function phraseSegmentToCard(segment: PhraseSegment): Card {
    return {
        id: crypto.randomUUID(),
        notes: segment.notes,
        duration: segment.duration,
        isRest: false,
        analysis: segment.analysis,
        createdAt: segment.timestamp,
    };
}

/**
 * Convert a Card to a legacy PhraseSegment (for gradual migration)
 */
export function cardToPhraseSegment(card: Card): PhraseSegment {
    return {
        type: 'chord',
        notes: card.notes,
        timestamp: card.createdAt,
        analysis: card.analysis,
        duration: card.duration,
    };
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/** Helper to generate unique IDs */
export const generateId = (): string => crypto.randomUUID();

/** Create a new empty card with default values */
export function createCard(
    notes: number[],
    duration: Duration = 'q',
    analysis?: ChordAnalysis
): Card {
    return {
        id: generateId(),
        notes,
        duration,
        isRest: notes.length === 0,
        analysis,
        createdAt: Date.now(),
    };
}

/** Create a rest card */
export function createRestCard(duration: Duration = 'q'): Card {
    return {
        id: generateId(),
        notes: [],
        duration,
        isRest: true,
        createdAt: Date.now(),
    };
}

/** Create a default sequence */
export function createSequence(name: string = 'Untitled'): Sequence {
    return {
        id: generateId(),
        name,
        tempo: 120,
        timeSignature: [4, 4],
        tracks: {
            master: [],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}
