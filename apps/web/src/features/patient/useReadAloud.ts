import { useCallback, useEffect, useState } from 'react';

const KEY = 'pvc.readAloud';

function synthAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Read-aloud preference (default off, remembered) plus a `speak` that cancels the previous utterance. */
export function useReadAloud() {
  const [enabled, setEnabled] = useState(readStored);
  const supported = synthAvailable();

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      if (!next && synthAvailable()) window.speechSynthesis.cancel();
      return next;
    });
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!enabled || !synthAvailable()) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    },
    [enabled],
  );

  useEffect(
    () => () => {
      if (synthAvailable()) window.speechSynthesis.cancel();
    },
    [],
  );

  return { supported, enabled, toggle, speak };
}
