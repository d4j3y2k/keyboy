# Chorduroy Roadmap

## Current State

A MIDI chord analyzer and trainer with:

- **Real-time chord detection** via Web MIDI API
  - Chord quality recognition (maj7, m7, dom7, dim, aug, sus, etc.)
  - Tension handling (#9, #11, b13)
  - Smart enharmonic spelling based on context
  - Rootless voicing detection
  - Interval display per note
- **Two modes**: Free Play and Training (match target chords for score)
- **Chord history** as interactive cards
- **Virtual keyboard** showing active/highlighted notes
- **Sustain pedal support** (REC mode)

---

## Next Milestone: Card-Based Composition

The core idea: **cards become the source of truth for a live staff renderer**. You play chords, they appear as cards, and a staff below renders them as real sheet music. Edit the cards, the notation updates.

### Phase 0: Foundation (Do This First)

Before building features, set up the architecture to support everything that follows.

- [ ] **Refactor `chorduroy.tsx`**
  - Extract MIDI handling → `hooks/useMIDI.ts`
  - Extract chord analysis → `lib/chordAnalysis.ts`
  - Extract components → `components/VirtualKeyboard.tsx`, `components/ChordCard.tsx`, etc.
  - Keep the main app file as orchestration only

- [ ] **Define the Card schema**
  ```ts
  interface Card {
    id: string;              // Stable ID for undo/redo, drag-drop
    notes: number[];         // MIDI note numbers
    duration: Duration;      // '1n' | '2n' | '4n' | '8n' | '16n'
    isRest: boolean;         // Rest card flag
    analysis?: ChordAnalysis; // Cached chord analysis
    enharmonicPrefs?: {};    // Optional spelling overrides
  }
  ```

- [ ] **Set up track-based data structure**
  - Even with one track, structure for future:
  ```ts
  interface Sequence {
    tempo: number;
    timeSignature: [number, number]; // [beats, beatUnit]
    tracks: {
      master: Card[];  // Phase 1-2: single track
      // rightHand: Card[];  // Phase 3: split
      // leftHand: Card[];
    }
  }
  ```

- [ ] **Integrate VexFlow**
  - Install and confirm it renders basic notation
  - Create `components/StaffRenderer.tsx` wrapper
  - Test: render a few hardcoded chords as quarter notes

- [ ] **Set up timeline clock**
  - Single source of truth for time/position
  - Tick-based or beat-based (e.g., PPQ - pulses per quarter note)
  - Playback, rendering, and scoring all reference this

### Phase 1: Freeform Foundation

- [ ] **Staff renderer component**
  - Render treble + bass clef
  - Display chords from card history as notation
  - Default duration: quarter note

- [ ] **Duration control per card**
  - Whole, half, quarter, eighth, sixteenth
  - UI to select/change duration on a card
  - Staff updates to reflect duration

- [ ] **Rest cards**
  - Insert rest cards into the sequence
  - Render as proper rest symbols on staff

- [ ] **Card editing**
  - Insert cards (between existing or at end)
  - Delete cards
  - Reorder cards (drag and drop?)
  - Edit notes within a card

- [ ] **Basic playback**
  - Play through the card sequence
  - Respect durations
  - Visual indicator of current position

### Phase 2: Formalized Notation

- [ ] **Time signature**
  - Selector (4/4, 3/4, 6/8, etc.)
  - Affects measure grouping

- [ ] **Measure grouping**
  - Automatic bar lines based on time signature
  - Cards fill measures based on their durations

- [ ] **Beat alignment algorithm**
  - Snap cards to proper beats
  - Handle overflow (card durations exceeding measure)

- [ ] **Transpose controls**
  - Transpose selected card(s) by semitone
  - Transpose by octave
  - Transpose entire sequence?

### Phase 3: Advanced Notation

- [ ] **Independent hand timing**
  - Left hand and right hand as separate tracks
  - Different rhythms per hand
  - This is a significant architectural change

- [ ] **Voice separation**
  - Melody vs accompaniment
  - Multiple voices per staff

- [ ] **Complex rhythmic notation**
  - Ties across bar lines
  - Dotted notes
  - Triplets

---

## Future Ideas

### Training Mode Evolution
- Training on chord progressions (not just single chords)
- Rhythm training (play the progression with correct timing)
- Sight-reading mode (staff shows what to play)
- Difficulty levels / progression unlocks

### Export
- MIDI file export
- MusicXML export (for notation software)
- PDF sheet music generation

### Other Ideas
- Tempo control (BPM)
- Metronome
- Loop sections
- Chord voicing suggestions
- Scale/key context awareness
- Undo/redo for edits
- Save/load progressions

---

## Notes

- The card-based workflow is intentionally more intuitive than traditional notation software
- Freeform first, formalization later — don't over-constrain early
- The staff is a *view* of the cards, not the other way around

### Technical Decisions (Incorporated into Phase 0)

- **Rendering:** VexFlow for notation (standard for web, handles beaming/accidentals/engraving)
- **Data:** Track-based structure from day one to avoid Phase 3 migration pain
- **Time:** Single timeline clock drives playback, rendering, and scoring
- **State:** Consider `useReducer` or Zustand for card operations (insert/delete/reorder/undo)
- **Playback:** MIDI output to existing device, or Tone.js as fallback for no-hardware users

### Persistence & Interop

- Autosave sequences to localStorage
- Keep schema exportable to MIDI/MusicXML from the start
- Add fixture progressions for regression testing

## Notes from Antigravity

- **State Management**: Strongly recommend `Zustand` (or `Jotai`) over `useReducer` for this level of complexity. The "Card-Based Composition" model implies a lot of cross-component state access (staff renderer needs cards, playback needs cards, UI needs cards). Avoiding prop-drilling early will pay off.
- **Accessibility (a11y)**: Since "Cards" are the source of truth, ensure they are keyboard accessible. If using drag-and-drop for reordering, ensure there are keyboard alternatives (e.g., "Move Left/Right" actions).
- **Performance**: VexFlow is powerful but can be heavy if re-rendered too frequently. Consider memoizing the Staff component or debouncing the render updates during rapid state changes (like dragging a slider).
- **Mobile/Touch**: If this is intended for use on tablets (common for music apps), ensure the drag-and-drop implementation supports touch events from the start.

### Additional Notes

- Nail a canonical tick resolution up front (e.g., PPQ) and map the `Duration` strings to both VexFlow durations and playback timing so measure math, rendering, and training scoring share one source of truth.
- Keep `Card` ids stable and drive undo/redo from card-level operations; use this to support both drag reorder and keyboard move-left/right to satisfy a11y without special cases.
- For the staff renderer, prefer incremental updates (diff by card id) rather than full reflow; cache beaming/accidentals where possible to avoid jitter during edits.
- While integrating Training mode later, treat target progressions as the same `Card` schema to avoid a second data model—just add metadata for prompts/expected timing and reuse the renderer.
