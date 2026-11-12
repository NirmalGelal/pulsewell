import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API, sessionDetail, sseResponse } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

class FakeRecorder {
  static isTypeSupported = () => true;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function mockMic(getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }))) {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  return getUserMedia;
}

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error cleanup of the stubbed property
  delete navigator.mediaDevices;
  // @ts-expect-error cleanup of optional browser APIs
  delete window.speechSynthesis;
  // @ts-expect-error cleanup of optional browser APIs
  delete window.SpeechRecognition;
});

function open() {
  server.use(http.get(`${API}/api/sessions/s1`, () => HttpResponse.json(sessionDetail())));
  return renderApp('/patient/session/s1');
}

const reply = () =>
  sseResponse([
    [
      'patient_message',
      {
        message: {
          id: 'm2',
          turnId: 2,
          sender: 'PATIENT',
          text: 'x',
          inputMode: 'VOICE',
          createdAt: '2026-11-11T18:01:00.000Z',
        },
      },
    ],
    ['safety', { level: 'none', categories: [], showResources: false }],
    [
      'companion_message',
      {
        message: {
          id: 'm3',
          turnId: 3,
          sender: 'COMPANION',
          text: 'Thank you for sharing.',
          inputMode: 'TEXT',
          createdAt: '2026-11-11T18:01:05.000Z',
        },
      },
    ],
    [
      'done',
      {
        progress: { covered: 1, total: 26, percent: 4, missingRequired: [], canFinish: false },
        pendingItem: null,
      },
    ],
  ]);

describe('Voice', () => {
  it('should put the transcript in the composer without sending, then send as VOICE', async () => {
    mockMic();
    let posted: unknown = null;
    server.use(
      http.post(`${API}/api/speech/transcribe`, () =>
        HttpResponse.json({ text: 'I have slept badly' }),
      ),
      http.post(`${API}/api/sessions/s1/messages`, async ({ request }) => {
        posted = await request.json();
        return reply();
      }),
    );
    open();
    const mic = await screen.findByRole('button', { name: 'Record your answer' });
    expect(mic).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(mic);
    expect(await screen.findByText(/Recording…/)).toBeInTheDocument();
    expect(mic).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(mic);
    const box = screen.getByRole('textbox', { name: 'Your message' });
    await waitFor(() => expect(box).toHaveValue('I have slept badly'));
    expect(posted).toBeNull(); // not auto-sent
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(posted).toEqual({ text: 'I have slept badly', inputMode: 'VOICE' }));
  });

  it('should toast when the transcript is empty', async () => {
    mockMic();
    server.use(http.post(`${API}/api/speech/transcribe`, () => HttpResponse.json({ text: '' })));
    open();
    const mic = await screen.findByRole('button', { name: 'Record your answer' });
    await userEvent.click(mic);
    await userEvent.click(mic);
    expect(
      await screen.findByText("I couldn't hear that. Try again or type instead."),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveValue('');
  });

  it('should explain when microphone access is blocked', async () => {
    mockMic(vi.fn(async () => Promise.reject(new DOMException('no', 'NotAllowedError'))));
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Record your answer' }));
    expect(
      await screen.findByText('Microphone access is blocked. You can type instead.'),
    ).toBeInTheDocument();
  });

  it('should fall back to browser dictation when transcription fails', async () => {
    mockMic();
    const started = vi.fn();
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((e: { results: { transcript: string }[][] }) => void) | null = null;
      onend: (() => void) | null = null;
      onerror = null;
      start = () => {
        started();
        this.onresult?.({ results: [[{ transcript: 'dictated words' }]] });
      };
      stop = vi.fn();
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    server.use(
      http.post(`${API}/api/speech/transcribe`, () =>
        HttpResponse.json({ error: { code: 'LLM_UNAVAILABLE', message: 'x' } }, { status: 503 }),
      ),
    );
    open();
    const mic = await screen.findByRole('button', { name: 'Record your answer' });
    await userEvent.click(mic);
    await userEvent.click(mic);
    expect(await screen.findByText(/Tap the microphone to dictate instead/)).toBeInTheDocument();
    await userEvent.click(mic);
    expect(started).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveValue('dictated words'),
    );
  });

  it('should hide the microphone when no voice input is available', async () => {
    open();
    await screen.findByRole('textbox', { name: 'Your message' });
    expect(screen.queryByRole('button', { name: 'Record your answer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Read aloud/ })).not.toBeInTheDocument();
  });

  it('should speak each completed companion message once when read aloud is on', async () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    class Utterance {
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = { speak, cancel };
    server.use(http.post(`${API}/api/sessions/s1/messages`, reply));
    open();
    const toggle = await screen.findByRole('button', { name: /Read aloud/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('pvc.readAloud')).toBe('1');
    await userEvent.type(screen.getByRole('textbox', { name: 'Your message' }), 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Thank you for sharing.');
    expect(speak).toHaveBeenCalledTimes(1);
    expect((speak.mock.calls[0]![0] as Utterance).text).toBe('Thank you for sharing.');
    expect(cancel).toHaveBeenCalled();
  });

  it('should not speak when read aloud is off', async () => {
    const speak = vi.fn();
    vi.stubGlobal('SpeechSynthesisUtterance', class {});
    (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      speak,
      cancel: vi.fn(),
    };
    server.use(http.post(`${API}/api/sessions/s1/messages`, reply));
    open();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Your message' }), 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Thank you for sharing.');
    expect(speak).not.toHaveBeenCalled();
  });
});
