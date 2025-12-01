import React from 'react';
import { MiniVexStaff } from './MiniVexStaff';
import type { PhraseSegment } from '../types';

export interface ChordCardProps {
    segment: PhraseSegment;
    cardId?: string;  // Card ID for selection (undefined for active card)
    isActive?: boolean;
    isSelected?: boolean;
    onClick?: (event: React.MouseEvent) => void;
}

const CARD_WIDTH = 156;

export const ChordCard: React.FC<ChordCardProps> = ({
    segment,
    cardId,
    isActive = false,
    isSelected = false,
    onClick
}) => {
    return (
        <div
            onClick={(e) => onClick?.(e)}
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

            {/* Mini Staff - VexFlow */}
            <div className="px-1 py-2">
                <MiniVexStaff
                    notes={segment.notes}
                    duration={segment.duration || 'q'}
                    isActive={isActive}
                />
            </div>
        </div>
    );
};
