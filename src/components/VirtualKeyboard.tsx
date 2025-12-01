import React, { useCallback, useRef } from 'react';

export interface VirtualKeyboardProps {
    activeNotes: number[];
    highlightedNotes?: number[];
    onNoteOn: (note: number) => void;
    onNoteOff: (note: number) => void;
}

export const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({ activeNotes, highlightedNotes = [], onNoteOn, onNoteOff }) => {
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
