import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRISIS_MESSAGE, CRISIS_RESOURCES, type PendingItemDto } from '@pvc/shared';
import { API, sessionDetail, sseResponse } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';
import { pickBestVoice, takeSentences } from './speech';

class FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: ((e: { name: string }) => void) | null = null;
  rate = 1;
  lang = '';
  voice: unknown = null;
  text: string;
  constructor(text: string) {
    this.text = text;
  }
}

const synth = {
  spoken: [] as FakeUtterance[],
  speak: vi.fn((u: FakeUtterance) => void synth.spoken.push(u)),
  cancel: vi.fn(),
  getVoices: () => [] as SpeechSynthesisVoice[],
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};
const spokenTexts = () => synth.spoken.map((u) => u.text);

function installSpeech() {
  synth.spoken = [];
  synth.speak.mockClear();
  synth.cancel.mockClear();
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
}

function installCamera(impl?: () => Promise<unknown>) {
  const stop = vi.fn();
  const getUserMedia = vi.fn(impl ?? (async () => ({ getTracks: () => [{ stop }] })));
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  return { getUserMedia, stop };
}

class FakeRecognition {
  static last: FakeRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((e: { results: { transcript: string }[][] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.last = this;
  }
  say(text: string) {
    this.onresult?.({ results: [[{ transcript: text }]] });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // @ts-expect-error cleanup of stubbed browser APIs
  delete window.speechSynthesis;
  // @ts-expect-error cleanup of stubbed browser APIs
  delete navigator.mediaDevices;
  // @ts-expect-error cleanup of stubbed browser APIs
  delete window.SpeechRecognition;
});
beforeEach(() => installSpeech());

const msg = (turnId: number, sender: 'PATIENT' | 'COMPANION', text: string) => ({
  message: {
    id: `m${turnId}`,
    turnId,
    sender,
    text,
    inputMode: 'TEXT' as const,
    createdAt: '2026-11-11T18:01:00.000Z',
  },
});
const progress = { covered: 3, total: 26, percent: 40, missingRequired: [], canFinish: false };

function serve(detail = sessionDetail()) {
  server.use(http.get(`${API}/api/sessions/s1`, () => HttpResponse.json(detail)));
}

async function joinCall(opts: { withoutCamera?: boolean } = {}) {
  const user = userEvent.setup();
  renderApp('/patient/session/s1/video');
  await user.click(
    await screen.findByRole('button', {
      name: opts.withoutCamera ? 'Join without camera' : 'Join video session',
    }),
  );
  await user.click(await screen.findByRole('button', { name: 'Start the call' }));
  await screen.findByText('Your companion');
  return user;
}

const reply = (extra: [string, unknown][] = [], pending: PendingItemDto | null = null) =>
  sseResponse([
    ['patient_message', msg(2, 'PATIENT', 'x')],
    ['safety', { level: 'none', categories: [], showResources: false }],
    ...extra,
    ['done', { progress, pendingItem: pending }],
  ]);

describe('speech helpers', () => {
  it('should split complete sentences and keep the unfinished tail', () => {
    expect(takeSentences('One. Two! Thr')).toEqual({ sentences: ['One.', 'Two!'], rest: 'Thr' });
    expect(takeSentences('Hello there')).toEqual({ sentences: [], rest: 'Hello there' });
  });

  it('should prefer natural local English voices over novelty ones', () => {
    const v = (name: string, lang: string, localService: boolean) =>
      ({ name, lang, localService, voiceURI: name, default: false }) as SpeechSynthesisVoice;
    const best = pickBestVoice([
      v('Zarvox', 'en-US', true),
      v('Anna', 'de-DE', true),
      v('Microsoft Aria Online (Natural)', 'en-US', false),
      v('Basic', 'en-GB', false),
    ]);
    expect(best?.name).toBe('Microsoft Aria Online (Natural)');
    expect(pickBestVoice([v('Anna', 'de-DE', true)])).toBeNull();
  });
});

describe('Video session', () => {
  it('should not ask for the camera until Join is pressed, and join audio-only when it is denied', async () => {
    const cam = installCamera(async () => {
      throw new DOMException('no', 'NotAllowedError');
    });
    serve();
    const user = userEvent.setup();
    renderApp('/patient/session/s1/video');
    await screen.findByRole('button', { name: 'Join video session' });
    expect(cam.getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByText(/not a clinician/)).toBeInTheDocument();
    expect(
      screen.getByText(/Your video stays on your device and is not recorded/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Join video session' }));
    expect(cam.getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(await screen.findByText(/Camera access is blocked/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start the call' }));
    expect(await screen.findByText('Your companion')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your message' })).toBeEnabled();
  });

  it('should speak the opening message sentence by sentence', async () => {
    installCamera();
    serve();
    await joinCall();
    expect(spokenTexts()).toEqual(['Hi, I am here to listen.', 'How have you been?']);
    expect(screen.getByText('Speaking')).toBeInTheDocument();
  });

  it('should send a typed answer and speak the streamed reply sentence by sentence', async () => {
    installCamera();
    serve();
    let body: unknown;
    server.use(
      http.post(`${API}/api/sessions/s1/messages`, async ({ request }) => {
        body = await request.json();
        return reply([
          ['token', { delta: 'First sente' }],
          ['token', { delta: 'nce. Second sentence' }],
          ['token', { delta: '.' }],
          ['companion_message', msg(3, 'COMPANION', 'First sentence. Second sentence.')],
        ]);
      }),
    );
    const user = await joinCall();
    synth.spoken = [];
    await user.type(screen.getByRole('textbox', { name: 'Your message' }), 'I feel tired');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(spokenTexts()).toEqual(['First sentence.', 'Second sentence.']));
    expect(body).toMatchObject({ text: 'I feel tired', inputMode: 'TEXT' });
    expect(screen.getByRole('log', { name: 'Captions' })).toHaveTextContent(
      'First sentence. Second sentence.',
    );
  });

  it('should dictate with the browser, send as VOICE after a pause, and never upload audio', async () => {
    installCamera();
    serve();
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
    let body: unknown;
    server.use(
      http.post(`${API}/api/sessions/s1/messages`, async ({ request }) => {
        body = await request.json();
        return reply([['companion_message', msg(3, 'COMPANION', 'Thank you.')]]);
      }),
    );
    const user = userEvent.setup();
    renderApp('/patient/session/s1/video');
    await user.click(await screen.findByRole('button', { name: 'Join video session' }));
    await user.click(await screen.findByRole('checkbox', { name: /Speak my answers/ }));
    await user.click(screen.getByRole('button', { name: 'Start the call' }));
    await screen.findByText('Your companion');
    // The opening message finishes, then dictation starts.
    act(() => synth.spoken.forEach((u) => u.onend?.()));
    await waitFor(() => expect(FakeRecognition.last?.start).toHaveBeenCalled());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => FakeRecognition.last?.say('I slept badly'));
    expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveValue('I slept badly');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    vi.useRealTimers();
    await waitFor(() => expect(body).toMatchObject({ text: 'I slept badly', inputMode: 'VOICE' }));
  });

  it('should send a TAP answer from the answer chips', async () => {
    installCamera();
    const pending: PendingItemDto = {
      key: 'phq9_1',
      prompt: 'Little interest or pleasure in doing things?',
      options: [
        { value: 0, label: 'Not at all' },
        { value: 1, label: 'Several days' },
        { value: 2, label: 'More than half the days' },
        { value: 3, label: 'Nearly every day' },
      ],
    };
    serve(sessionDetail({ pendingItem: pending }));
    let body: unknown;
    server.use(
      http.post(`${API}/api/sessions/s1/messages`, async ({ request }) => {
        body = await request.json();
        return reply([['companion_message', msg(3, 'COMPANION', 'Thanks.')]]);
      }),
    );
    const user = await joinCall();
    await user.click(screen.getByRole('button', { name: 'Several days' }));
    await waitFor(() =>
      expect(body).toMatchObject({
        text: 'Several days',
        inputMode: 'TAP',
        answerFor: { key: 'phq9_1', value: 1 },
      }),
    );
  });

  it('should cancel speech and open the crisis overlay on a crisis event, then resume the call', async () => {
    const cam = installCamera();
    serve();
    server.use(
      http.post(`${API}/api/sessions/s1/messages`, () =>
        sseResponse([
          ['patient_message', msg(2, 'PATIENT', 'x')],
          [
            'crisis',
            {
              level: 'imminent',
              session: {
                ...sessionDetail().session,
                state: 'CRISIS_PAUSED',
                riskLevel: 'imminent',
              },
              message: CRISIS_MESSAGE,
              resources: CRISIS_RESOURCES,
            },
          ],
          ['done', { progress, pendingItem: null }],
        ]),
      ),
      http.post(`${API}/api/sessions/s1/resume`, () =>
        HttpResponse.json(
          sessionDetail({ session: { ...sessionDetail().session, riskLevel: 'elevated' } }),
        ),
      ),
    );
    const user = await joinCall();
    synth.cancel.mockClear();
    await user.type(screen.getByRole('textbox', { name: 'Your message' }), 'I want to end it');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(synth.cancel).toHaveBeenCalled();
    expect(spokenTexts().join(' ')).not.toContain('988');
    expect(cam.stop).toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Support resources' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /I'm safe right now/ }));
    await user.click(screen.getByRole('button', { name: /Yes, I'm safe/ }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Your message' })).toBeEnabled();
  });

  it('should stop the companion when the patient starts typing or presses Stop talking', async () => {
    installCamera();
    serve();
    const user = await joinCall();
    synth.cancel.mockClear();
    await user.click(screen.getByRole('button', { name: 'Stop talking' }));
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Stop talking' })).not.toBeInTheDocument();
  });

  it('should cancel speech when the patient types over the companion', async () => {
    installCamera();
    serve();
    await joinCall();
    synth.cancel.mockClear();
    fireEvent.change(screen.getByRole('textbox', { name: 'Your message' }), {
      target: { value: 'h' },
    });
    expect(synth.cancel).toHaveBeenCalled();
  });

  it('should switch to the text chat for the same session', async () => {
    installCamera();
    serve();
    const user = await joinCall();
    await user.click(screen.getByRole('button', { name: 'Switch to text' }));
    expect(await screen.findByRole('log', { name: 'Conversation' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/patient/session/s1');
    expect(screen.getByTestId('location').textContent).not.toContain('video');
    expect(screen.getByText(/Hi, I am here to listen/)).toBeInTheDocument();
    expect(localStorage.getItem('pvc.mode')).toBe('text');
    expect(screen.getByRole('button', { name: /Switch to video/ })).toBeInTheDocument();
  });

  it('should stop camera tracks and cancel speech on unmount', async () => {
    const cam = installCamera();
    serve();
    const user = userEvent.setup();
    const view = renderApp('/patient/session/s1/video');
    await user.click(await screen.findByRole('button', { name: 'Join video session' }));
    await user.click(await screen.findByRole('button', { name: 'Start the call' }));
    await screen.findByText('Your companion');
    synth.cancel.mockClear();
    view.unmount();
    expect(cam.stop).toHaveBeenCalled();
    expect(synth.cancel).toHaveBeenCalled();
  });

  it('should join without touching the camera when the patient skips it', async () => {
    const cam = installCamera();
    serve();
    await joinCall({ withoutCamera: true });
    expect(cam.getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByText('Camera off')).toBeInTheDocument();
  });

  it('should hide video and explain when the browser cannot speak', async () => {
    // @ts-expect-error simulate an unsupported browser
    delete window.speechSynthesis;
    vi.stubGlobal('SpeechSynthesisUtterance', undefined);
    serve();
    renderApp('/patient/session/s1/video');
    expect(await screen.findByText('Video sessions are not available here')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue in text' })).toHaveAttribute(
      'href',
      '/patient/session/s1',
    );
  });

  it('should offer video from Home and Consent when supported, and hide it otherwise', async () => {
    renderApp('/patient');
    const link = await screen.findByRole('link', { name: 'Start a video session' });
    expect(link).toHaveAttribute('href', '/patient/consent?mode=video');
    expect(screen.getByRole('link', { name: 'Start a conversation' })).toHaveAttribute(
      'href',
      '/patient/consent',
    );
  });
});
