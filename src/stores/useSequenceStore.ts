/**
 * Zustand store for sequence state management
 *
 * Central source of truth for cards, playback, and editing.
 * Supports undo/redo via temporal middleware.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import type {
    Card,
    Sequence,
    Duration,
    TimeSignature,
    PlaybackState,
    PlaybackPosition,
    ChordAnalysis,
} from '../types';
import { createCard, createRestCard, createSequence, generateId } from '../types';

// =============================================================================
// STATE INTERFACE
// =============================================================================

/** Selection mode for click handling */
export type SelectionMode = 'replace' | 'toggle' | 'range';

interface SequenceState {
    // --- Sequence Data ---
    sequence: Sequence;

    // --- UI State ---
    selectedCardIds: string[];  // Multi-selection: array preserves selection order
    selectionAnchor: string | null;  // For shift+click range selection
    recordingDuration: Duration;

    // --- Playback State ---
    playbackState: PlaybackState;
    playbackPosition: PlaybackPosition;

    // --- Card CRUD Actions ---
    addCard: (notes: number[], analysis?: ChordAnalysis) => void;
    addRestCard: () => void;
    insertCard: (index: number, notes: number[], analysis?: ChordAnalysis) => void;
    removeCard: (id: string) => void;
    updateCard: (id: string, updates: Partial<Omit<Card, 'id'>>) => void;
    updateCardDuration: (id: string, duration: Duration) => void;
    reorderCards: (fromIndex: number, toIndex: number) => void;
    clearCards: () => void;

    // --- Selection ---
    selectCard: (id: string, mode?: SelectionMode) => void;
    selectCards: (ids: string[]) => void;
    clearSelection: () => void;
    selectAll: () => void;
    selectCardByIndex: (index: number, mode?: SelectionMode) => void;

    // --- Batch Operations ---
    updateSelectedCardsDuration: (duration: Duration) => void;
    deleteSelectedCards: () => void;

    // --- Recording ---
    setRecordingDuration: (duration: Duration) => void;

    // --- Sequence Settings ---
    setTempo: (tempo: number) => void;
    setTimeSignature: (timeSignature: TimeSignature) => void;
    setSequenceName: (name: string) => void;

    // --- Playback Controls ---
    play: () => void;
    pause: () => void;
    stop: () => void;
    setPlaybackPosition: (position: Partial<PlaybackPosition>) => void;

    // --- Persistence ---
    loadSequence: (sequence: Sequence) => void;
    resetSequence: () => void;

    // --- Computed Helpers ---
    getCards: () => Card[];
    getCardById: (id: string) => Card | undefined;
    getCardByIndex: (index: number) => Card | undefined;
    getSelectedCards: () => Card[];
    getCardIndex: (id: string) => number;
    isCardSelected: (id: string) => boolean;
    getSelectionCount: () => number;
}

// =============================================================================
// INITIAL STATE
// =============================================================================

const initialPlaybackPosition: PlaybackPosition = {
    cardIndex: 0,
    tick: 0,
    beat: 0,
    measure: 0,
};

// =============================================================================
// STORE IMPLEMENTATION
// =============================================================================

export const useSequenceStore = create<SequenceState>()(
    temporal(
        (set, get) => ({
            // --- Initial State ---
            sequence: createSequence(),
            selectedCardIds: [],
            selectionAnchor: null,
            recordingDuration: 'q',
            playbackState: 'stopped',
            playbackPosition: initialPlaybackPosition,

            // --- Card CRUD ---

            addCard: (notes, analysis) => {
                const card = createCard(notes, get().recordingDuration, analysis);
                set((state) => ({
                    sequence: {
                        ...state.sequence,
                        tracks: {
                            ...state.sequence.tracks,
                            master: [...state.sequence.tracks.master, card],
                        },
                        updatedAt: Date.now(),
                    },
                }));
            },

            addRestCard: () => {
                const card = createRestCard(get().recordingDuration);
                set((state) => ({
                    sequence: {
                        ...state.sequence,
                        tracks: {
                            ...state.sequence.tracks,
                            master: [...state.sequence.tracks.master, card],
                        },
                        updatedAt: Date.now(),
                    },
                }));
            },

            insertCard: (index, notes, analysis) => {
                const card = createCard(notes, get().recordingDuration, analysis);
                set((state) => {
                    const cards = [...state.sequence.tracks.master];
                    cards.splice(index, 0, card);
                    return {
                        sequence: {
                            ...state.sequence,
                            tracks: { ...state.sequence.tracks, master: cards },
                            updatedAt: Date.now(),
                        },
                    };
                });
            },

            removeCard: (id) => {
                set((state) => {
                    const cards = state.sequence.tracks.master.filter((c) => c.id !== id);
                    return {
                        sequence: {
                            ...state.sequence,
                            tracks: { ...state.sequence.tracks, master: cards },
                            updatedAt: Date.now(),
                        },
                        // Remove from selection if was selected
                        selectedCardIds: state.selectedCardIds.filter((cid) => cid !== id),
                        selectionAnchor: state.selectionAnchor === id ? null : state.selectionAnchor,
                    };
                });
            },

            updateCard: (id, updates) => {
                set((state) => ({
                    sequence: {
                        ...state.sequence,
                        tracks: {
                            ...state.sequence.tracks,
                            master: state.sequence.tracks.master.map((c) =>
                                c.id === id ? { ...c, ...updates } : c
                            ),
                        },
                        updatedAt: Date.now(),
                    },
                }));
            },

            updateCardDuration: (id, duration) => {
                get().updateCard(id, { duration });
            },

            reorderCards: (fromIndex, toIndex) => {
                set((state) => {
                    const cards = [...state.sequence.tracks.master];
                    const [removed] = cards.splice(fromIndex, 1);
                    if (removed) {
                        cards.splice(toIndex, 0, removed);
                    }
                    return {
                        sequence: {
                            ...state.sequence,
                            tracks: { ...state.sequence.tracks, master: cards },
                            updatedAt: Date.now(),
                        },
                    };
                });
            },

            clearCards: () => {
                set((state) => ({
                    sequence: {
                        ...state.sequence,
                        tracks: { ...state.sequence.tracks, master: [] },
                        updatedAt: Date.now(),
                    },
                    selectedCardIds: [],
                    selectionAnchor: null,
                }));
            },

            // --- Selection ---

            selectCard: (id, mode = 'replace') => {
                set((state) => {
                    const cards = state.sequence.tracks.master;
                    const cardExists = cards.some((c) => c.id === id);
                    if (!cardExists) return state;

                    switch (mode) {
                        case 'replace':
                            // Clear selection, select only this card, set as anchor
                            return {
                                selectedCardIds: [id],
                                selectionAnchor: id,
                            };

                        case 'toggle':
                            // Toggle this card in/out of selection (Ctrl+click)
                            const isSelected = state.selectedCardIds.includes(id);
                            if (isSelected) {
                                const newSelection = state.selectedCardIds.filter((cid) => cid !== id);
                                return {
                                    selectedCardIds: newSelection,
                                    // Keep anchor if it wasn't the toggled card
                                    selectionAnchor: state.selectionAnchor === id
                                        ? (newSelection.length > 0 ? newSelection[newSelection.length - 1] : null)
                                        : state.selectionAnchor,
                                };
                            } else {
                                return {
                                    selectedCardIds: [...state.selectedCardIds, id],
                                    selectionAnchor: id,
                                };
                            }

                        case 'range':
                            // Select range from anchor to clicked card (Shift+click)
                            const anchor = state.selectionAnchor;
                            if (!anchor) {
                                // No anchor, just select this card
                                return {
                                    selectedCardIds: [id],
                                    selectionAnchor: id,
                                };
                            }
                            const anchorIndex = cards.findIndex((c) => c.id === anchor);
                            const targetIndex = cards.findIndex((c) => c.id === id);
                            if (anchorIndex === -1 || targetIndex === -1) {
                                return { selectedCardIds: [id], selectionAnchor: id };
                            }
                            const startIdx = Math.min(anchorIndex, targetIndex);
                            const endIdx = Math.max(anchorIndex, targetIndex);
                            const rangeIds = cards.slice(startIdx, endIdx + 1).map((c) => c.id);
                            return {
                                selectedCardIds: rangeIds,
                                // Keep anchor unchanged for range selection
                            };

                        default:
                            return state;
                    }
                });
            },

            selectCards: (ids) => {
                set((state) => {
                    const cards = state.sequence.tracks.master;
                    const validIds = ids.filter((id) => cards.some((c) => c.id === id));
                    return {
                        selectedCardIds: validIds,
                        selectionAnchor: validIds.length > 0 ? validIds[validIds.length - 1] : null,
                    };
                });
            },

            clearSelection: () => {
                set({ selectedCardIds: [], selectionAnchor: null });
            },

            selectAll: () => {
                set((state) => {
                    const cards = state.sequence.tracks.master;
                    return {
                        selectedCardIds: cards.map((c) => c.id),
                        selectionAnchor: cards.length > 0 ? cards[0].id : null,
                    };
                });
            },

            selectCardByIndex: (index, mode = 'replace') => {
                const cards = get().sequence.tracks.master;
                const card = cards[index];
                if (card) {
                    get().selectCard(card.id, mode);
                }
            },

            // --- Batch Operations ---

            updateSelectedCardsDuration: (duration) => {
                set((state) => {
                    const { selectedCardIds } = state;
                    if (selectedCardIds.length === 0) return state;

                    return {
                        sequence: {
                            ...state.sequence,
                            tracks: {
                                ...state.sequence.tracks,
                                master: state.sequence.tracks.master.map((c) =>
                                    selectedCardIds.includes(c.id) ? { ...c, duration } : c
                                ),
                            },
                            updatedAt: Date.now(),
                        },
                    };
                });
            },

            deleteSelectedCards: () => {
                set((state) => {
                    const { selectedCardIds } = state;
                    if (selectedCardIds.length === 0) return state;

                    return {
                        sequence: {
                            ...state.sequence,
                            tracks: {
                                ...state.sequence.tracks,
                                master: state.sequence.tracks.master.filter(
                                    (c) => !selectedCardIds.includes(c.id)
                                ),
                            },
                            updatedAt: Date.now(),
                        },
                        selectedCardIds: [],
                        selectionAnchor: null,
                    };
                });
            },

            // --- Recording ---

            setRecordingDuration: (duration) => {
                set({ recordingDuration: duration });
            },

            // --- Sequence Settings ---

            setTempo: (tempo) => {
                set((state) => ({
                    sequence: {
                        ...state.sequence,
                        tempo: Math.max(20, Math.min(400, tempo)),
                        updatedAt: Date.now(),
                    },
                }));
            },

            setTimeSignature: (timeSignature) => {
                set((state) => ({
                    sequence: {
                        ...state.sequence,
                        timeSignature,
                        updatedAt: Date.now(),
                    },
                }));
            },

            setSequenceName: (name) => {
                set((state) => ({
                    sequence: {
                        ...state.sequence,
                        name,
                        updatedAt: Date.now(),
                    },
                }));
            },

            // --- Playback Controls ---

            play: () => {
                set({ playbackState: 'playing' });
            },

            pause: () => {
                set({ playbackState: 'paused' });
            },

            stop: () => {
                set({
                    playbackState: 'stopped',
                    playbackPosition: initialPlaybackPosition,
                });
            },

            setPlaybackPosition: (position) => {
                set((state) => ({
                    playbackPosition: { ...state.playbackPosition, ...position },
                }));
            },

            // --- Persistence ---

            loadSequence: (sequence) => {
                set({
                    sequence,
                    selectedCardIds: [],
                    selectionAnchor: null,
                    playbackState: 'stopped',
                    playbackPosition: initialPlaybackPosition,
                });
            },

            resetSequence: () => {
                set({
                    sequence: createSequence(),
                    selectedCardIds: [],
                    selectionAnchor: null,
                    playbackState: 'stopped',
                    playbackPosition: initialPlaybackPosition,
                });
            },

            // --- Computed Helpers ---

            getCards: () => get().sequence.tracks.master,

            getCardById: (id) => get().sequence.tracks.master.find((c) => c.id === id),

            getCardByIndex: (index) => get().sequence.tracks.master[index],

            getSelectedCards: () => {
                const { selectedCardIds, sequence } = get();
                if (selectedCardIds.length === 0) return [];
                // Return cards in selection order
                return selectedCardIds
                    .map((id) => sequence.tracks.master.find((c) => c.id === id))
                    .filter((c): c is Card => c !== undefined);
            },

            getCardIndex: (id) => get().sequence.tracks.master.findIndex((c) => c.id === id),

            isCardSelected: (id) => get().selectedCardIds.includes(id),

            getSelectionCount: () => get().selectedCardIds.length,
        }),
        {
            // Temporal middleware config for undo/redo
            limit: 50, // Keep last 50 states
            equality: (a, b) => JSON.stringify(a.sequence) === JSON.stringify(b.sequence),
        }
    )
);

// =============================================================================
// UNDO/REDO HOOKS
// =============================================================================

/**
 * Access undo/redo functionality
 *
 * Usage:
 *   const { undo, redo, canUndo, canRedo } = useSequenceHistory();
 */
export const useSequenceHistory = () => {
    return useSequenceStore.temporal.getState();
};

// =============================================================================
// SELECTORS
// =============================================================================

/** Select just the cards array (for components that only need cards) */
export const selectCards = (state: SequenceState) => state.sequence.tracks.master;

/** Select the selected card IDs (multi-selection) */
export const selectSelectedCardIds = (state: SequenceState) => state.selectedCardIds;

/** Select the selection anchor */
export const selectSelectionAnchor = (state: SequenceState) => state.selectionAnchor;

/** Select recording duration */
export const selectRecordingDuration = (state: SequenceState) => state.recordingDuration;

/** Select tempo */
export const selectTempo = (state: SequenceState) => state.sequence.tempo;

/** Select time signature */
export const selectTimeSignature = (state: SequenceState) => state.sequence.timeSignature;

/** Select playback state */
export const selectPlaybackState = (state: SequenceState) => state.playbackState;

/** Check if a card is selected */
export const selectIsCardSelected = (id: string) => (state: SequenceState) =>
    state.selectedCardIds.includes(id);

/** Get selection count */
export const selectSelectionCount = (state: SequenceState) => state.selectedCardIds.length;
