import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Music, Cable, Trophy, SkipForward, Undo2, Redo2, Trash2 } from 'lucide-react';
import { useSequenceStore, useSequenceHistory } from './src/stores/useSequenceStore';
import { cardToPhraseSegment } from './src/types';
import type {
    Duration,
    PhraseSegment,
    MIDIAccess,
    MIDIMessageEvent,
    MIDIConnectionEvent,
    NavigatorWithMIDI,
    TargetChord,
} from './src/types';

// Import chord analysis from lib (single source of truth)
import {
    INTERVALS,
    getChordToneWithTension,
    analyzeChord,
} from './src/lib/chordAnalysis';
import { VirtualKeyboard, ChordCardHistory, DurationScrollPicker, SimpleStaff } from './src/components';

export default function ChorduroyApp() {
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

    // === ZUSTAND STORE ===
    const {
        selectedCardIds,
        recordingDuration,
        addCard,
        updateCardDuration,
        selectCard,
        selectCards,
        clearSelection,
        selectAll,
        updateSelectedCardsDuration,
        deleteSelectedCards,
        setRecordingDuration,
        clearCards,
        getCards,
        getCardIndex,
        getSelectionCount,
    } = useSequenceStore();

    // Undo/redo from temporal middleware
    const { undo, redo, pastStates, futureStates } = useSequenceHistory();
    const canUndo = pastStates.length > 0;
    const canRedo = futureStates.length > 0;

    // Derive history (PhraseSegment[]) from cards for backward compatibility
    const cards = getCards();
    const history: PhraseSegment[] = useMemo(() =>
        cards.map(cardToPhraseSegment),
        [cards]
    );

    // Selection count for UI
    const selectionCount = getSelectionCount();

    // Get first selected card index for backward compatibility with single-selection UI
    const selectedCardIndex = useMemo(() => {
        if (selectedCardIds.length === 0) return null;
        const idx = getCardIndex(selectedCardIds[0]);
        return idx >= 0 ? idx : null;
    }, [selectedCardIds, getCardIndex]);

    // Handle card click with modifier keys
    const handleCardClick = useCallback((cardId: string, event: React.MouseEvent) => {
        if (event.shiftKey) {
            selectCard(cardId, 'range');
        } else if (event.ctrlKey || event.metaKey) {
            selectCard(cardId, 'toggle');
        } else {
            // Regular click - if already the only selected card, deselect
            if (selectedCardIds.length === 1 && selectedCardIds[0] === cardId) {
                clearSelection();
            } else {
                selectCard(cardId, 'replace');
            }
        }
    }, [selectCard, selectedCardIds, clearSelection]);

    // Pedal state
    const [isPedalDown, setIsPedalDown] = useState<boolean>(false);
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

    // Add a chord to the store (wraps store.addCard for compatibility)
    const addSegmentToHistory = useCallback((segment: PhraseSegment) => {
        // Only add chord segments to the store (scales are not supported yet)
        if (segment.type === 'chord') {
            addCard(segment.notes, segment.analysis);
        }
    }, [addCard]);

    // Update duration of a card by index
    const updateSegmentDuration = useCallback((chordIndex: number, duration: Duration) => {
        const card = cards[chordIndex];
        if (card) {
            updateCardDuration(card.id, duration);
        }
    }, [cards, updateCardDuration]);

    // Delete selected cards (supports multi-selection)
    const deleteSelectedCard = useCallback(() => {
        if (selectedCardIds.length > 0) {
            deleteSelectedCards();
        }
    }, [selectedCardIds, deleteSelectedCards]);

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
                analysis: isChord ? analyzeChord(uniqueNotes) || undefined : undefined,
                duration: recordingDuration
            };

            addSegmentToHistory(segment);
        });
    }, [addSegmentToHistory, recordingDuration]);

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

    // === KEYBOARD SHORTCUTS ===
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't handle if focus is in an input
            if (document.activeElement?.tagName === 'INPUT') return;

            // Undo: Ctrl+Z / Cmd+Z
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (canUndo) undo();
                return;
            }
            // Redo: Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y
            if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y')) {
                e.preventDefault();
                if (canRedo) redo();
                return;
            }
            // Delete selected cards: Delete or Backspace
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCardIds.length > 0) {
                e.preventDefault();
                deleteSelectedCard();
                return;
            }
            // Escape: clear selection
            if (e.key === 'Escape' && selectedCardIds.length > 0) {
                clearSelection();
                return;
            }
            // Select all: Ctrl+A / Cmd+A
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault();
                selectAll();
                return;
            }

            // Duration shortcuts: 1-5
            const durationMap: { [key: string]: Duration } = {
                '1': 'w',   // Whole
                '2': 'h',   // Half
                '3': 'q',   // Quarter
                '4': '8',   // Eighth
                '5': '16',  // Sixteenth
            };
            if (durationMap[e.key]) {
                e.preventDefault();
                const duration = durationMap[e.key];
                if (selectedCardIds.length > 0) {
                    // Edit mode: update all selected cards' duration
                    updateSelectedCardsDuration(duration);
                } else {
                    // Record mode: set recording duration
                    setRecordingDuration(duration);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [canUndo, canRedo, undo, redo, selectedCardIds, deleteSelectedCard, clearSelection, selectAll, updateSelectedCardsDuration, setRecordingDuration]);

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
            if (!isMounted || !msg.data) return;
            const [command, data1, data2] = msg.data as Uint8Array;

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
            if (!isMounted || !e.port) return;
            if (e.port.state === 'connected' && e.port.type === 'input') {
                (e.port as any).onmidimessage = onMidiMessage;
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
                        <h1 className="text-lg font-bold tracking-tight text-stone-900">Chorduroy</h1>
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

                    {/* Duration Picker - Vertical Scroll Wheel */}
                    <DurationScrollPicker
                        value={selectionCount > 0 ? (selectedSegment?.duration || 'q') : recordingDuration}
                        onChange={(duration) => {
                            if (selectionCount > 0) {
                                // Update all selected cards' duration
                                updateSelectedCardsDuration(duration);
                            } else {
                                setRecordingDuration(duration);
                            }
                        }}
                        mode={selectionCount > 0 ? 'edit' : 'record'}
                        selectionCount={selectionCount}
                    />

                    {/* Edit Controls: Undo/Redo/Delete/Clear */}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => undo()}
                            disabled={!canUndo}
                            title="Undo (Ctrl+Z)"
                            className={`p-2 rounded-md transition-all ${
                                canUndo
                                    ? 'text-slate-300 hover:bg-slate-700 hover:text-white'
                                    : 'text-slate-600 cursor-not-allowed'
                            }`}
                        >
                            <Undo2 size={16} />
                        </button>
                        <button
                            onClick={() => redo()}
                            disabled={!canRedo}
                            title="Redo (Ctrl+Shift+Z)"
                            className={`p-2 rounded-md transition-all ${
                                canRedo
                                    ? 'text-slate-300 hover:bg-slate-700 hover:text-white'
                                    : 'text-slate-600 cursor-not-allowed'
                            }`}
                        >
                            <Redo2 size={16} />
                        </button>
                        {selectedCardIds.length > 0 && (
                            <button
                                onClick={deleteSelectedCard}
                                title={`Delete ${selectionCount} selected (Del)`}
                                className="p-2 rounded-md text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-all flex items-center gap-1"
                            >
                                <Trash2 size={16} />
                                {selectionCount > 1 && <span className="text-xs">{selectionCount}</span>}
                            </button>
                        )}
                        {cards.length > 0 && (
                            <button
                                onClick={() => {
                                    if (confirm('Clear all chords?')) clearCards();
                                }}
                                title="Clear all"
                                className="px-2 py-1 rounded-md text-xs text-slate-400 hover:bg-slate-700 hover:text-white transition-all"
                            >
                                Clear
                            </button>
                        )}
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
                        cards={cards}
                        selectedCardIds={selectedCardIds}
                        onCardClick={handleCardClick}
                        onSelectCards={selectCards}
                        onClearSelection={clearSelection}
                        recordingDuration={recordingDuration}
                    />

                    {/* VexFlow Sheet Music */}
                    <SimpleStaff segments={history} />

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
