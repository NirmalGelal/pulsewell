const OPEN = '<think>';
const CLOSE = '</think>';

/** Removes `<think>…</think>` blocks (and a dangling `…</think>` prefix) and trims. */
export function stripThink(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const open = out.indexOf(OPEN);
  if (open !== -1) out = out.slice(0, open); // unterminated block
  const close = out.indexOf(CLOSE);
  if (close !== -1) out = out.slice(close + CLOSE.length); // opening tag was in the template
  return out.trim();
}

/** Incremental think-block stripper that also trims leading/trailing whitespace of the whole output. */
export class ThinkStripper {
  private buf = '';
  private inThink = false;
  private started = false;
  private pendingWs = '';

  push(chunk: string): string {
    this.buf += chunk;
    let out = '';
    for (;;) {
      if (this.inThink) {
        const i = this.buf.indexOf(CLOSE);
        if (i === -1) {
          this.buf = this.buf.slice(Math.max(0, this.buf.length - (CLOSE.length - 1)));
          break;
        }
        this.buf = this.buf.slice(i + CLOSE.length);
        this.inThink = false;
        continue;
      }
      const i = this.buf.indexOf(OPEN);
      if (i !== -1) {
        out += this.buf.slice(0, i);
        this.buf = this.buf.slice(i + OPEN.length);
        this.inThink = true;
        continue;
      }
      const c = this.buf.indexOf(CLOSE);
      if (c !== -1 && !this.started && out.trim() === '') {
        // Opening tag lived in the chat template: drop everything before the close tag.
        this.buf = this.buf.slice(c + CLOSE.length);
        continue;
      }
      // Hold back a possible partial tag at the end.
      let keep = 0;
      for (let n = Math.min(CLOSE.length - 1, this.buf.length); n > 0; n--) {
        const tail = this.buf.slice(this.buf.length - n);
        if (OPEN.startsWith(tail) || CLOSE.startsWith(tail)) {
          keep = n;
          break;
        }
      }
      out += this.buf.slice(0, this.buf.length - keep);
      this.buf = this.buf.slice(this.buf.length - keep);
      break;
    }
    return this.emit(out);
  }

  /** Call at end of stream; returns any remaining safe text (partial tags are dropped if in think). */
  flush(): string {
    const rest = this.inThink ? '' : this.buf;
    this.buf = '';
    return this.emit(rest, true);
  }

  private emit(text: string, final = false): string {
    let t = this.pendingWs + text;
    this.pendingWs = '';
    if (!this.started) {
      t = t.replace(/^\s+/, '');
      if (t === '') return '';
    }
    const trimmed = t.replace(/\s+$/, '');
    if (!final) this.pendingWs = t.slice(trimmed.length);
    if (trimmed !== '') this.started = true;
    return trimmed;
  }
}
