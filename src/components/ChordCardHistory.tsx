import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChordCard } from './ChordCard';
import { analyzeChord } from '../lib/chordAnalysis';
import type { ChordAnalysis, Duration, PhraseSegment } from '../types';

export interface ChordCardHistoryProps {
    activeNotes: number[];
    cards: { id: string; notes: number[]; duration: Duration; analysis?: ChordAnalysis }[];
    selectedCardIds: string[];
    onCardClick: (cardId: string, event: React.MouseEvent) => void;
    onSelectCards: (ids: string[]) => void;
    onClearSelection: () => void;
    recordingDuration: Duration;
}

export const ChordCardHistory: React.FC<ChordCardHistoryProps> = ({
    activeNotes,
    cards,
    selectedCardIds,
    onCardClick,
    onSelectCards,
    onClearSelection,
    recordingDuration
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const cardRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
    const [isHoveringLeft, setIsHoveringLeft] = useState(false);
    const [isHoveringRight, setIsHoveringRight] = useState(false);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const [isBrowsing, setIsBrowsing] = useState(false);
    const scrollIntervalRef = useRef<number | null>(null);

    // Marquee selection state
    const [marquee, setMarquee] = useState<{
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
    } | null>(null);
    const [marqueeSelectedIds, setMarqueeSelectedIds] = useState<string[]>([]);

    // Convert cards to segments for rendering (cards with notes are chord segments)
    const chordCards = useMemo(() => cards.filter(c => c.notes.length > 0), [cards]);

    // Create segment for active notes
    const activeSegment = useMemo((): PhraseSegment | null => {
        if (activeNotes.length === 0) return null;
        return {
            type: 'chord',
            notes: activeNotes,
            timestamp: Date.now(),
            analysis: analyzeChord(activeNotes) || undefined,
            duration: recordingDuration
        };
    }, [activeNotes, recordingDuration]);

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
    }, [updateScrollState, chordCards.length]);

    // Auto-scroll to end when new chords added (unless browsing or cards selected)
    useEffect(() => {
        if (scrollRef.current && !isBrowsing && selectedCardIds.length === 0) {
            requestAnimationFrame(() => {
                if (scrollRef.current) {
                    scrollRef.current.scrollTo({
                        left: scrollRef.current.scrollWidth,
                        behavior: 'smooth'
                    });
                }
            });
        }
    }, [chordCards.length, isBrowsing, selectedCardIds.length]);

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

    const hasContent = chordCards.length > 0 || activeSegment;

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

    // Marquee selection handlers
    const handleMarqueeStart = useCallback((e: React.MouseEvent) => {
        // Only start marquee if clicking on the scrollable container background (not on a card)
        if (e.target === scrollRef.current || e.target === containerRef.current) {
            const rect = scrollRef.current?.getBoundingClientRect();
            if (rect) {
                setMarquee({
                    startX: e.clientX,
                    startY: e.clientY,
                    currentX: e.clientX,
                    currentY: e.clientY,
                });
                setMarqueeSelectedIds([]);
                // Clear existing selection when starting marquee
                onClearSelection();
            }
        }
    }, [onClearSelection]);

    const handleMarqueeMove = useCallback((e: React.MouseEvent) => {
        if (!marquee) return;

        setMarquee(prev => prev ? {
            ...prev,
            currentX: e.clientX,
            currentY: e.clientY,
        } : null);

        // Calculate marquee bounds
        const left = Math.min(marquee.startX, e.clientX);
        const right = Math.max(marquee.startX, e.clientX);
        const top = Math.min(marquee.startY, e.clientY);
        const bottom = Math.max(marquee.startY, e.clientY);

        // Find cards that intersect with the marquee
        const intersectingIds: string[] = [];
        cardRefsMap.current.forEach((element, cardId) => {
            const cardRect = element.getBoundingClientRect();
            // Check if card intersects with marquee
            if (
                cardRect.right >= left &&
                cardRect.left <= right &&
                cardRect.bottom >= top &&
                cardRect.top <= bottom
            ) {
                intersectingIds.push(cardId);
            }
        });

        setMarqueeSelectedIds(intersectingIds);
    }, [marquee]);

    const handleMarqueeEnd = useCallback(() => {
        if (marquee && marqueeSelectedIds.length > 0) {
            onSelectCards(marqueeSelectedIds);
        }
        setMarquee(null);
        setMarqueeSelectedIds([]);
    }, [marquee, marqueeSelectedIds, onSelectCards]);

    // Calculate marquee box position and size
    const marqueeStyle = useMemo(() => {
        if (!marquee) return null;
        const left = Math.min(marquee.startX, marquee.currentX);
        const top = Math.min(marquee.startY, marquee.currentY);
        const width = Math.abs(marquee.currentX - marquee.startX);
        const height = Math.abs(marquee.currentY - marquee.startY);
        return { left, top, width, height };
    }, [marquee]);

    return (
        <div className="w-full bg-gradient-to-b from-stone-100 to-amber-50/50 rounded-xl border border-amber-200/50 shadow-inner relative">
            {/* Card count indicator */}
            {chordCards.length > 0 && (
                <div className="absolute top-2 right-3 z-20 flex items-center gap-2">
                    <span className="text-xs text-amber-600/70 font-medium bg-amber-100/80 px-2 py-0.5 rounded-full">
                        {chordCards.length} chord{chordCards.length !== 1 ? 's' : ''}
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
                onMouseDown={handleMarqueeStart}
                onMouseMove={handleMarqueeMove}
                onMouseUp={handleMarqueeEnd}
                onMouseLeave={handleMarqueeEnd}
            >
                <div ref={containerRef} className="flex gap-3 p-4 pr-8 pl-6 min-w-min items-center">
                    {/* History cards */}
                    {chordCards.map((card) => {
                        // Convert card to PhraseSegment for ChordCard rendering
                        const segment: PhraseSegment = {
                            type: 'chord',
                            notes: card.notes,
                            timestamp: 0,  // Not used for display
                            analysis: card.analysis,
                            duration: card.duration,
                        };
                        const isMarqueeSelected = marqueeSelectedIds.includes(card.id);
                        return (
                            <div
                                key={card.id}
                                ref={(el) => {
                                    if (el) cardRefsMap.current.set(card.id, el);
                                    else cardRefsMap.current.delete(card.id);
                                }}
                            >
                                <ChordCard
                                    cardId={card.id}
                                    segment={segment}
                                    isSelected={selectedCardIds.includes(card.id) || isMarqueeSelected}
                                    onClick={(e) => onCardClick(card.id, e)}
                                />
                            </div>
                        );
                    })}

                    {/* Active chord card - only show when no cards are selected */}
                    {activeSegment && selectedCardIds.length === 0 && (
                        <ChordCard
                            segment={activeSegment}
                            isActive={true}
                            onClick={() => onClearSelection()}
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

            {/* Marquee selection box (fixed position to viewport) */}
            {marquee && marqueeStyle && (
                <div
                    className="fixed pointer-events-none z-50 border-2 border-blue-400 bg-blue-400/20 rounded"
                    style={{
                        left: marqueeStyle.left,
                        top: marqueeStyle.top,
                        width: marqueeStyle.width,
                        height: marqueeStyle.height,
                    }}
                />
            )}
        </div>
    );
};
