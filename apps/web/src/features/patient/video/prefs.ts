/** Preferences and capability checks for the video-call presentation of the interview. */

export type SessionMode = 'video' | 'text';

const MODE_KEY = 'pvc.mode';
const SPEAK_KEY = 'pvc.speakAnswers';
const VOICE_KEY = 'pvc.voice';

/** The call only needs the browser's speech output; camera and dictation are optional extras. */
export function videoSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: preference lasts until reload */
  }
}

export function getMode(): SessionMode | null {
  const v = read(MODE_KEY);
  return v === 'video' || v === 'text' ? v : null;
}
export function setMode(mode: SessionMode): void {
  write(MODE_KEY, mode);
}
export function getSpeakAnswers(): boolean {
  return read(SPEAK_KEY) === '1';
}
export function setSpeakAnswers(on: boolean): void {
  write(SPEAK_KEY, on ? '1' : '0');
}
export function getVoiceUri(): string | null {
  return read(VOICE_KEY);
}
export function setVoiceUri(uri: string): void {
  write(VOICE_KEY, uri);
}

export const videoPath = (id: string) => `/patient/session/${id}/video`;
export const textPath = (id: string) => `/patient/session/${id}`;
