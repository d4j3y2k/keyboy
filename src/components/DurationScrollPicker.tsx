import React, { useState, useEffect, useRef } from 'react';
import type { Duration } from '../types';

export interface DurationScrollPickerProps {
    value: Duration;
    onChange: (duration: Duration) => void;
    mode: 'edit' | 'record';
    selectionCount?: number;  // Number of cards selected (for multi-selection)
}

export const DURATION_OPTIONS: { value: Duration; label: string; shortcut: string }[] = [
    { value: 'w', label: 'Whole', shortcut: '1' },
    { value: 'h', label: 'Half', shortcut: '2' },
    { value: 'q', label: 'Quarter', shortcut: '3' },
    { value: '8', label: 'Eighth', shortcut: '4' },
    { value: '16', label: '16th', shortcut: '5' },
];

const DurationNoteIcon: React.FC<{ duration: Duration; className?: string }> = ({ duration, className = '' }) => {
    const icons: Record<Duration, JSX.Element> = {
        'w': <svg viewBox="0 0 32 40" className={className}><ellipse cx="16" cy="24" rx="10" ry="6" fill="none" stroke="currentColor" strokeWidth="2.5"/></svg>,
        'h': <svg viewBox="0 0 32 40" className={className}><ellipse cx="12" cy="30" rx="9" ry="5.5" fill="none" stroke="currentColor" strokeWidth="2.5" transform="rotate(-20 12 30)"/><line x1="20" y1="27" x2="20" y2="6" stroke="currentColor" strokeWidth="2.5"/></svg>,
        'q': <svg viewBox="0 0 32 40" className={className}><ellipse cx="12" cy="30" rx="9" ry="5.5" fill="currentColor" transform="rotate(-20 12 30)"/><line x1="20" y1="27" x2="20" y2="6" stroke="currentColor" strokeWidth="2.5"/></svg>,
        '8': <svg viewBox="0 0 32 40" className={className}><ellipse cx="12" cy="30" rx="9" ry="5.5" fill="currentColor" transform="rotate(-20 12 30)"/><line x1="20" y1="27" x2="20" y2="6" stroke="currentColor" strokeWidth="2.5"/><path d="M20 6 Q28 12 23 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>,
        '16': <svg viewBox="0 0 32 40" className={className}><ellipse cx="12" cy="30" rx="9" ry="5.5" fill="currentColor" transform="rotate(-20 12 30)"/><line x1="20" y1="27" x2="20" y2="6" stroke="currentColor" strokeWidth="2.5"/><path d="M20 6 Q28 10 23 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><path d="M20 12 Q28 16 23 22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>,
    };
    return icons[duration];
};

const ITEM_HEIGHT = 44;

export const DurationScrollPicker: React.FC<DurationScrollPickerProps> = ({ value, onChange, mode, selectionCount = 0 }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // Use refs for drag state to avoid stale closure issues with pointer capture
    const isDraggingRef = useRef(false);
    const dragStartYRef = useRef(0);
    const dragStartIndexRef = useRef(0);

    // State only for triggering re-renders during drag
    const [, forceRender] = useState(0);

    const currentIndex = DURATION_OPTIONS.findIndex(d => d.value === value);

    // Store onChange in a ref to avoid re-attaching wheel listener
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const currentIndexRef = useRef(currentIndex);
    currentIndexRef.current = currentIndex;

    // Non-passive wheel handler (must be added imperatively)
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            // Scroll DOWN (positive deltaY) = move to LOWER index (longer duration)
            const direction = e.deltaY > 0 ? -1 : 1;
            const newIndex = Math.max(0, Math.min(DURATION_OPTIONS.length - 1, currentIndexRef.current + direction));
            if (newIndex !== currentIndexRef.current) {
                onChangeRef.current(DURATION_OPTIONS[newIndex].value);
            }
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, []);

    const handlePointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        isDraggingRef.current = true;
        dragStartYRef.current = e.clientY;
        dragStartIndexRef.current = currentIndex;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        forceRender(n => n + 1);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDraggingRef.current) return;

        const deltaY = e.clientY - dragStartYRef.current;
        // Calculate which index we should be at based on drag distance
        // Drag UP (negative deltaY) = higher index (shorter notes)
        const indexDelta = Math.round(-deltaY / ITEM_HEIGHT);
        const newIndex = Math.max(0, Math.min(DURATION_OPTIONS.length - 1, dragStartIndexRef.current + indexDelta));

        // Update selection in real-time as user drags
        if (newIndex !== currentIndexRef.current) {
            onChangeRef.current(DURATION_OPTIONS[newIndex].value);
        }
    };

    // Just clean up on release - selection already updated during drag
    const handlePointerUp = (e: React.PointerEvent) => {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        forceRender(n => n + 1);
        // Delay resetting isDragging so the subsequent click event is ignored
        // (click fires after pointerup on the original element)
        setTimeout(() => {
            isDraggingRef.current = false;
        }, 0);
    };

    const handleClick = (index: number) => {
        if (!isDraggingRef.current) {
            onChange(DURATION_OPTIONS[index].value);
        }
    };

    return (
        <div className="flex items-center gap-3">
            {/* Mode indicator */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
                mode === 'edit'
                    ? 'bg-blue-500/20 border border-blue-500/50'
                    : 'bg-emerald-500/20 border border-emerald-500/50'
            }`}>
                <div className={`w-2 h-2 rounded-full ${
                    mode === 'edit' ? 'bg-blue-400' : 'bg-emerald-400 animate-pulse'
                }`} />
                <span className={`text-xs font-medium ${
                    mode === 'edit' ? 'text-blue-300' : 'text-emerald-300'
                }`}>
                    {mode === 'edit'
                        ? selectionCount > 1
                            ? `${selectionCount} selected`
                            : 'Editing'
                        : 'Recording'}
                </span>
            </div>

            {/* Vertical scroll picker */}
            <div
                ref={containerRef}
                className={`relative select-none cursor-ns-resize rounded-xl overflow-hidden transition-shadow ${
                    isDraggingRef.current
                        ? mode === 'edit'
                            ? 'shadow-lg shadow-blue-500/30 ring-2 ring-blue-400/50'
                            : 'shadow-lg shadow-emerald-500/30 ring-2 ring-emerald-400/50'
                        : 'shadow-md'
                }`}
                style={{
                    height: ITEM_HEIGHT * 3,
                    width: 140,
                    background: 'linear-gradient(to bottom, rgba(15,23,42,0.95), rgba(30,41,59,0.95), rgba(15,23,42,0.95))'
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
            >
                {/* Fade overlays */}
                <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-slate-900/90 to-transparent z-10 pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-slate-900/90 to-transparent z-10 pointer-events-none" />

                {/* Selection highlight */}
                <div
                    className={`absolute inset-x-2 h-11 rounded-lg pointer-events-none z-0 transition-colors ${
                        mode === 'edit'
                            ? 'bg-blue-500/30 border border-blue-400/50'
                            : 'bg-emerald-500/30 border border-emerald-400/50'
                    }`}
                    style={{ top: ITEM_HEIGHT - 2 }}
                />

                {/* Scrolling content */}
                <div
                    className="relative z-5 transition-transform duration-100"
                    style={{
                        transform: `translateY(${ITEM_HEIGHT - (currentIndex * ITEM_HEIGHT)}px)`,
                    }}
                >
                    {DURATION_OPTIONS.map((option, index) => {
                        const isActive = index === currentIndex;
                        const distance = Math.abs(index - currentIndex);
                        const opacity = isActive ? 1 : distance === 1 ? 0.5 : 0.25;
                        const scale = isActive ? 1 : 0.85;

                        return (
                            <div
                                key={option.value}
                                onClick={() => handleClick(index)}
                                className={`flex items-center justify-between px-3 transition-all duration-150 ${
                                    isActive ? 'cursor-ns-resize' : 'cursor-pointer'
                                }`}
                                style={{
                                    height: ITEM_HEIGHT,
                                    opacity,
                                    transform: `scale(${scale})`,
                                }}
                            >
                                {/* Note icon */}
                                <DurationNoteIcon
                                    duration={option.value}
                                    className={`w-6 h-8 ${
                                        isActive
                                            ? mode === 'edit' ? 'text-blue-300' : 'text-emerald-300'
                                            : 'text-slate-400'
                                    }`}
                                />

                                {/* Label */}
                                <span className={`text-sm font-medium ${
                                    isActive
                                        ? 'text-white'
                                        : 'text-slate-500'
                                }`}>
                                    {option.label}
                                </span>

                                {/* Shortcut */}
                                <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                                    isActive
                                        ? mode === 'edit'
                                            ? 'bg-blue-500/40 text-blue-200'
                                            : 'bg-emerald-500/40 text-emerald-200'
                                        : 'bg-slate-700/50 text-slate-500'
                                }`}>
                                    {option.shortcut}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {/* Drag hint arrows */}
                {!isDraggingRef.current && (
                    <>
                        <div className="absolute top-1 inset-x-0 flex justify-center pointer-events-none z-20">
                            <svg className="w-4 h-4 text-slate-500 animate-bounce" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 15l-6-6-6 6" />
                            </svg>
                        </div>
                        <div className="absolute bottom-1 inset-x-0 flex justify-center pointer-events-none z-20">
                            <svg className="w-4 h-4 text-slate-500 animate-bounce" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M6 9l6 6 6-6" />
                            </svg>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
