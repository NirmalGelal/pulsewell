import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export type ConvertFn = (audio: Buffer) => Promise<Buffer>;

const TIMEOUT_MS = 30_000;

/** Converts any ffmpeg-readable audio to 16 kHz mono WAV. stdin -> stdout, no temp files. */
export const convertToWav: ConvertFn = (audio) =>
  new Promise<Buffer>((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg binary not available'));
      return;
    }
    const proc = spawn(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-f',
        'wav',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg timed out'));
    }, TIMEOUT_MS);
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    proc.stdin.on('error', () => undefined); // EPIPE if ffmpeg exits early; surfaced via close
    proc.stdin.end(audio);
  });
