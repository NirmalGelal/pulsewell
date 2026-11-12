import { useCallback, useEffect, useRef, useState } from 'react';
import { getVoiceUri, setVoiceUri } from './prefs';
import { pickBestVoice } from './speech';

const RATE = 0.95;
const MOUTH_TICK_MS = 50;
const BOUNDARY_GRACE_MS = 400;

interface Options {
  /** Fires once when `finish()` was called and every queued sentence has been spoken. */
  onDone?: () => void;
}

/**
 * Browser speechSynthesis wrapper for the companion: sentence queue, voice choice and a lip-sync
 * `mouthOpen` value (word boundaries pulse the mouth; a gentle periodic pulse is the fallback).
 */
export function useSpeechOutput({ onDone }: Options = {}) {
  const available = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURIState] = useState<string | null>(getVoiceUri);
  const [speaking, setSpeaking] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(0);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const gen = useRef(0);
  const pending = useRef(0);
  const closed = useRef(false);
  const level = useRef(0);
  const lastBoundary = useRef(0);
  const speakingRef = useRef(false);
  const watchdogs = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (!available) return;
    const synth = window.speechSynthesis;
    const load = () => setVoices(synth.getVoices?.() ?? []);
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, [available]);

  voiceRef.current =
    (voiceURI ? voices.find((v) => v.voiceURI === voiceURI) : undefined) ?? pickBestVoice(voices);

  // Mouth animation runs only while speaking.
  useEffect(() => {
    if (!speaking) {
      level.current = 0;
      setMouthOpen(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      level.current *= 0.7;
      if (now - lastBoundary.current > BOUNDARY_GRACE_MS && now - startedAt > BOUNDARY_GRACE_MS) {
        // No word boundaries from this voice: a soft periodic pulse instead.
        level.current = Math.max(level.current, 0.3 + 0.3 * Math.abs(Math.sin(now / 120)));
      }
      setMouthOpen(Math.min(1, level.current));
    }, MOUTH_TICK_MS);
    return () => clearInterval(id);
  }, [speaking]);

  const check = useCallback(() => {
    if (pending.current === 0) {
      speakingRef.current = false;
      setSpeaking(false);
      if (closed.current) {
        closed.current = false;
        onDoneRef.current?.();
      }
    }
  }, []);

  const enqueue = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean || !available) return;
      const myGen = gen.current;
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = RATE;
      u.lang = voiceRef.current?.lang ?? 'en-US';
      if (voiceRef.current) u.voice = voiceRef.current;
      let ended = false;
      const end = () => {
        if (ended || myGen !== gen.current) return;
        ended = true;
        pending.current = Math.max(0, pending.current - 1);
        check();
      };
      u.onboundary = (e: SpeechSynthesisEvent) => {
        if (e.name && e.name !== 'word') return;
        level.current = 1;
        lastBoundary.current = Date.now();
      };
      u.onend = end;
      u.onerror = end;
      // A voice that never reports its end must not stall the conversation.
      const dog = setTimeout(
        () => {
          watchdogs.current.delete(dog);
          end();
        },
        Math.max(4000, clean.length * 130),
      );
      watchdogs.current.add(dog);
      pending.current += 1;
      if (!speakingRef.current) {
        speakingRef.current = true;
        lastBoundary.current = 0;
        setSpeaking(true);
      }
      window.speechSynthesis.speak(u);
    },
    [available, check],
  );

  /** Marks the end of this reply's sentences; `onDone` fires after the last one is spoken. */
  const finish = useCallback(() => {
    closed.current = true;
    check();
  }, [check]);

  const cancel = useCallback(() => {
    gen.current += 1;
    pending.current = 0;
    closed.current = false;
    speakingRef.current = false;
    watchdogs.current.forEach(clearTimeout);
    watchdogs.current.clear();
    if (available) window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, [available]);

  const setVoiceURI = useCallback((uri: string) => {
    setVoiceUri(uri);
    setVoiceURIState(uri);
  }, []);

  useEffect(
    () => () => {
      gen.current += 1;
      watchdogs.current.forEach(clearTimeout);
      if (available) window.speechSynthesis?.cancel();
    },
    [available],
  );

  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  return {
    supported: available,
    voices: english,
    voiceURI: voiceRef.current?.voiceURI ?? voiceURI ?? '',
    setVoiceURI,
    speaking,
    mouthOpen,
    enqueue,
    finish,
    cancel,
  };
}
export type SpeechOutput = ReturnType<typeof useSpeechOutput>;
