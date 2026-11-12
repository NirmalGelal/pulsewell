import { describe, expect, it } from 'vitest';
import { LlmUnavailableError } from './types';
import { AppError } from '../../lib/errors';
import { chatBody, makeLive } from './test-utils';

describe('transcribe', () => {
  it('should send input_audio base64 with format wav; should reject audio/webm with VALIDATION_ERROR', async () => {
    const { client, requests } = makeLive([
      { status: 200, body: chatBody('I feel tired.') },
      { status: 200, body: chatBody('mp3 ok') },
    ]);
    const audio = Buffer.from('RIFFfakewav');
    const r = await client.transcribe(audio, 'audio/wav', { cacheSalt: 'c2FsdA==' });
    expect(r).toEqual({ text: 'I feel tired.', model: 'gemma-small' });
    const content = requests[0].messages[0].content;
    expect(content[0].type).toBe('text');
    expect(content[1]).toEqual({
      type: 'input_audio',
      input_audio: { data: audio.toString('base64'), format: 'wav' },
    });
    expect(requests[0].model).toBe('gemma-small');
    expect(requests[0].cache_salt).toBe('c2FsdA==');

    await client.transcribe(audio, 'audio/mpeg');
    expect(requests[1].messages[0].content[1].input_audio.format).toBe('mp3');

    const err = await client.transcribe(audio, 'audio/webm').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('should not use a fallback model and throw LlmUnavailableError after retries', async () => {
    const { client, requests } = makeLive([{ status: 500 }, { status: 500 }, { status: 500 }]);
    await expect(client.transcribe(Buffer.from('x'), 'audio/wav')).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
    expect(requests.map((r) => r.model)).toEqual(['gemma-small', 'gemma-small', 'gemma-small']);
  });
});
