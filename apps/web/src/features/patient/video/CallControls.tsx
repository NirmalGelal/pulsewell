import type { ReactNode } from 'react';
import { Captions, CircleStop, Keyboard, Mic, MicOff, Video, VideoOff, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CameraStatus } from './useCamera';

interface Props {
  dictationSupported: boolean;
  speakAnswers: boolean;
  onToggleSpeak: () => void;
  cameraStatus: CameraStatus;
  onToggleCamera: () => void;
  captions: boolean;
  onToggleCaptions: () => void;
  companionSpeaking: boolean;
  onInterrupt: () => void;
  onSwitchToText: () => void;
  onFinish: () => void;
  finishDisabled: boolean;
}

function Control({
  label,
  icon,
  pressed,
  onClick,
  disabled,
  variant,
}: {
  label: string;
  icon: ReactNode;
  pressed?: boolean;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'outline';
}) {
  return (
    <Button
      type="button"
      variant={variant ?? (pressed ? 'default' : 'outline')}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className="h-11 min-w-11 px-3.5"
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}

export function CallControls(p: Props) {
  const cameraOn = p.cameraStatus === 'on';
  return (
    <div role="toolbar" aria-label="Call controls" className="flex flex-wrap items-center gap-2">
      {p.companionSpeaking && (
        <Control
          label="Stop talking"
          icon={<CircleStop aria-hidden="true" />}
          onClick={p.onInterrupt}
        />
      )}
      {p.dictationSupported && (
        <Control
          label="Speak my answers"
          icon={p.speakAnswers ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
          pressed={p.speakAnswers}
          onClick={p.onToggleSpeak}
        />
      )}
      <Control
        label="Camera"
        icon={cameraOn ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}
        pressed={cameraOn}
        onClick={p.onToggleCamera}
        disabled={p.cameraStatus === 'requesting' || p.cameraStatus === 'unavailable'}
      />
      <Control
        label="Captions"
        icon={<Captions aria-hidden="true" />}
        pressed={p.captions}
        onClick={p.onToggleCaptions}
      />
      <Control
        label="Switch to text"
        icon={<Keyboard aria-hidden="true" />}
        onClick={p.onSwitchToText}
      />
      <Control
        label="Finish and review"
        icon={<Check aria-hidden="true" />}
        onClick={p.onFinish}
        disabled={p.finishDisabled}
      />
    </div>
  );
}
