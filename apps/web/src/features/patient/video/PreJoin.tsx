import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Volume2 } from 'lucide-react';
import { CRISIS_RESOURCES } from '@pvc/shared';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PRIVACY_LINE, SelfView } from './SelfView';
import { textPath } from './prefs';
import type { Camera } from './useCamera';
import { useSpeechOutput } from './useSpeechOutput';

interface Props {
  sessionId: string;
  camera: Camera;
  dictationSupported: boolean;
  speakAnswers: boolean;
  onSpeakAnswers: (on: boolean) => void;
  onStart: () => void;
}

const CAMERA_NOTES: Record<string, string> = {
  denied: 'Camera access is blocked, so you will join without video. That is fine.',
  unavailable: 'No camera was found, so you will join without video. That is fine.',
};

/** Device check. No permission prompt appears until the patient presses a join button. */
export function PreJoin({
  sessionId,
  camera,
  dictationSupported,
  speakAnswers,
  onSpeakAnswers,
  onStart,
}: Props) {
  const speech = useSpeechOutput();
  const [checked, setChecked] = useState(false);
  const call988 = CRISIS_RESOURCES.find((r) => r.id === '988')?.href ?? 'tel:988';

  const join = async () => {
    await camera.enable();
    setChecked(true);
  };

  const testVoice = () => {
    speech.cancel();
    speech.enqueue(
      'Hello. I am your companion. I will ask you some questions, and you can answer whenever you are ready.',
    );
    speech.finish();
  };

  return (
    <div className="mx-auto w-full max-w-[42rem] px-4 pb-16 pt-10 sm:pt-14">
      <h1 className="text-[2.125rem] leading-tight">
        {checked ? 'Check your setup' : 'Join a video session'}
      </h1>
      <p className="mt-3 text-[1.1875rem] leading-relaxed text-muted-foreground">
        Your companion will join and ask the questions out loud. You can answer by typing, or by
        speaking if your browser supports it.
      </p>

      <ul className="mt-6 border-t text-[1.0625rem] leading-relaxed">
        <li className="border-b py-3">
          This is an AI companion, not a clinician. It cannot diagnose you or give medical advice.
        </li>
        <li className="border-b py-3">
          It is not for emergencies. If you are in danger, call or text{' '}
          <a href={call988} className="font-medium underline underline-offset-4">
            988
          </a>{' '}
          now.
        </li>
        <li className="border-b py-3">
          {PRIVACY_LINE} Only the words you type or say are turned into text.
        </li>
      </ul>

      {checked && (
        <section aria-label="Device check" className="mt-8 grid gap-6 sm:grid-cols-[14rem_1fr]">
          <div>
            {camera.stream ? (
              <SelfView stream={camera.stream} className="aspect-[4/3] w-full rounded-lg" />
            ) : (
              <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-surface-strong px-3 text-center text-[0.9375rem] text-muted-foreground">
                Audio only
              </div>
            )}
            {CAMERA_NOTES[camera.status] && (
              <p role="status" className="mt-2 text-[0.9375rem] text-muted-foreground">
                {CAMERA_NOTES[camera.status]}
              </p>
            )}
          </div>
          <div className="space-y-5">
            <div>
              <label htmlFor="voice-select" className="block text-[0.9375rem] font-medium">
                Companion voice
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                {speech.voices.length > 0 && (
                  <select
                    id="voice-select"
                    value={speech.voiceURI}
                    onChange={(e) => speech.setVoiceURI(e.target.value)}
                    className="h-11 min-w-0 basis-full rounded-lg sm:basis-0 sm:flex-1 border border-input bg-background px-3 text-base"
                  >
                    {speech.voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                )}
                <Button type="button" variant="outline" className="h-11" onClick={testVoice}>
                  <Volume2 aria-hidden="true" />
                  Test companion voice
                </Button>
              </div>
            </div>
            {dictationSupported && (
              <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[1.0625rem]">
                <input
                  type="checkbox"
                  checked={speakAnswers}
                  onChange={(e) => onSpeakAnswers(e.target.checked)}
                  className="mt-1 size-5 shrink-0 accent-[var(--primary)]"
                />
                <span>
                  Speak my answers
                  <span className="block text-[0.9375rem] text-muted-foreground">
                    Your browser turns your speech into text. You can always type instead.
                  </span>
                </span>
              </label>
            )}
          </div>
        </section>
      )}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {checked ? (
          <Button className="h-14 text-[1.1875rem] sm:flex-1" onClick={onStart}>
            Start the call
          </Button>
        ) : (
          <>
            <Button
              className="h-14 text-[1.1875rem] sm:flex-1"
              disabled={camera.status === 'requesting'}
              onClick={() => void join()}
            >
              Join video session
            </Button>
            <Button variant="outline" className="h-14 text-base" onClick={() => setChecked(true)}>
              Join without camera
            </Button>
          </>
        )}
      </div>
      <Link
        to={textPath(sessionId)}
        className={cn(buttonVariants({ variant: 'ghost' }), 'mt-3 h-11 w-full sm:w-auto')}
      >
        Use text chat instead
      </Link>
    </div>
  );
}
