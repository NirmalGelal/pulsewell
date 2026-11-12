import type { LlmClient } from './types';

/** M01 placeholder; M03 replaces its use with `createLlmClient(config)`. Every method throws. */
export class NotImplementedLlmClient implements LlmClient {
  readonly mode = 'mock' as const;
  private fail(): never {
    throw new Error('LLM client not implemented (M03)');
  }
  complete(): never {
    return this.fail();
  }
  completeJson(): never {
    return this.fail();
  }
  stream(): never {
    return this.fail();
  }
  transcribe(): never {
    return this.fail();
  }
}
