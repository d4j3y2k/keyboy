/**
 * Web MIDI API Type Definitions
 *
 * Custom types for Web MIDI API to ensure consistent typing across the app.
 * These are used instead of the built-in types to avoid conflicts.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MIDIMessageEvent = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MIDIInput = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MIDIOutput = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MIDIConnectionEvent = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MIDIAccess = any;

/**
 * Navigator with optional requestMIDIAccess method
 */
export interface NavigatorWithMIDI {
    requestMIDIAccess?: () => Promise<MIDIAccess>;
}
