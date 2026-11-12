import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Mic, Send, Square } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { recordingSupported, useRecorder } from './useRecorder';

const TranscribeSchema = z.object({ text: z.string() });

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const join = (a: string, b: string) => (a.trim() ? `${a.trimEnd()} ${b}` : b);

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Mark the pending message as voice-entered. */
  onVoice: () => void;
  onSend: () => void;
  disabled: boolean;
}

export function Composer({ value, onChange, onVoice, onSend, disabled }: ComposerProps) {
  const [transcribing, setTranscribing] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [preferDictation, setPreferDictation] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      recognitionRef.current?.stop();
    },
    [],
  );

  const canRecord = recordingSupported();
  const Recognition = getSpeechRecognition();
  const micAvailable = canRecord || !!Recognition;

  const startDictation = () => {
    if (!Recognition) return;
    const rec = new Recognition();
    const base = valueRef.current;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i]![0]!.transcript;
      onChange(join(base, text.trim()));
      onVoice();
    };
    rec.onend = () => {
      recognitionRef.current = null;
      if (mounted.current) setDictating(false);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setBlocked(true);
    };
    recognitionRef.current = rec;
    setDictating(true);
    rec.start();
  };

  const recorder = useRecorder({
    onStop: (audio) => {
      void (async () => {
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append('audio', audio, 'recording.webm');
          const { text } = await api.upload('/api/speech/transcribe', form, TranscribeSchema);
          if (!mounted.current) return;
          if (!text.trim()) {
            toast("I couldn't hear that. Try again or type instead.");
            return;
          }
          onChange(join(valueRef.current, text.trim()));
          onVoice();
        } catch {
          if (!mounted.current) return;
          if (Recognition) {
            setPreferDictation(true);
            toast.error(
              "Voice transcription isn't available right now. Tap the microphone to dictate instead.",
            );
          } else
            toast.error("Voice transcription isn't available right now. You can type instead.");
        } finally {
          if (mounted.current) setTranscribing(false);
        }
      })();
    },
  });

  const recording = recorder.state === 'recording';

  const toggleMic = async () => {
    setBlocked(false);
    if (dictating) {
      recognitionRef.current?.stop();
      return;
    }
    if (recording) {
      recorder.stop();
      return;
    }
    if (canRecord && !preferDictation) {
      const result = await recorder.start();
      if (result === 'denied') setBlocked(true);
      else if (result !== 'ok') {
        if (Recognition) startDictation();
        else toast.error("The microphone isn't working. You can type instead.");
      }
      return;
    }
    startDictation();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!disabled && value.trim()) onSend();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  };

  const listening = recording || dictating;
  return (
    <form onSubmit={submit} className="space-y-2">
      {blocked && (
        <p role="alert" className="text-base text-foreground">
          Microphone access is blocked. You can type instead.
        </p>
      )}
      {recording && (
        <p role="status" className="flex items-center gap-2 text-base text-muted-foreground">
          <span
            aria-hidden="true"
            className="inline-block size-3 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
            style={{ transform: `scale(${1 + recorder.level})` }}
          />
          Recording… {clock(recorder.elapsed)}
        </p>
      )}
      {dictating && (
        <p role="status" className="text-base text-muted-foreground">
          Listening… speak now, then review before sending.
        </p>
      )}
      {transcribing && (
        <p role="status" className="text-base text-muted-foreground">
          Turning your voice into text…
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <textarea
          aria-label="Your message"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={1}
          maxLength={4000}
          placeholder="Type your answer here"
          className="min-h-14 w-full flex-1 basis-full resize-none sm:basis-0 rounded-lg border border-input bg-background px-4 py-3 text-[1.0625rem] leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:bg-surface disabled:opacity-60"
        />
        {micAvailable && (
          <Button
            type="button"
            variant={listening ? 'default' : 'outline'}
            aria-pressed={listening}
            aria-label="Record your answer"
            onClick={() => void toggleMic()}
            disabled={disabled || transcribing}
            className="size-14"
          >
            {listening ? (
              <Square aria-hidden="true" className="size-6" />
            ) : (
              <Mic aria-hidden="true" className="size-6" />
            )}
          </Button>
        )}
        <Button
          type="submit"
          aria-label="Send message"
          disabled={disabled || !value.trim() || transcribing}
          className="h-14 flex-1 px-5 text-base sm:flex-none"
        >
          <Send aria-hidden="true" className="size-5" />
          <span aria-hidden="true">Send</span>
        </Button>
      </div>
    </form>
  );
}
