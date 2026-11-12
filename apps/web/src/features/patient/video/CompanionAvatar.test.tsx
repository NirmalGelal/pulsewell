import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanionAvatar } from './CompanionAvatar';

function mockReduced(reduced: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  mockReduced(false);
});
afterEach(() => {
  vi.useRealTimers();
});

const mouth = () => screen.getByTestId('avatar-mouth');

describe('CompanionAvatar', () => {
  it('exposes a state-specific accessible label', () => {
    const { rerender } = render(<CompanionAvatar state="speaking" />);
    expect(screen.getByRole('img', { name: 'Your companion, speaking' })).toBeInTheDocument();
    rerender(<CompanionAvatar state="listening" />);
    expect(screen.getByRole('img', { name: 'Your companion, listening' })).toBeInTheDocument();
    rerender(<CompanionAvatar state="thinking" />);
    expect(screen.getByRole('img', { name: 'Your companion, thinking' })).toBeInTheDocument();
  });

  it('smoothly moves the mouth toward mouthOpen while speaking', () => {
    const { rerender } = render(<CompanionAvatar state="speaking" mouthOpen={0} />);
    act(() => void vi.advanceTimersByTime(100));
    const closed = mouth().getAttribute('d');
    rerender(<CompanionAvatar state="speaking" mouthOpen={0.9} />);
    act(() => void vi.advanceTimersByTime(16));
    const mid = Number(mouth().getAttribute('data-mouth'));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.9);
    act(() => void vi.advanceTimersByTime(600));
    expect(Number(mouth().getAttribute('data-mouth'))).toBeCloseTo(0.9, 1);
    expect(mouth().getAttribute('d')).not.toBe(closed);
  });

  it('closes the mouth when not speaking', () => {
    const { rerender } = render(<CompanionAvatar state="speaking" mouthOpen={1} />);
    act(() => void vi.advanceTimersByTime(600));
    rerender(<CompanionAvatar state="listening" mouthOpen={1} />);
    act(() => void vi.advanceTimersByTime(600));
    expect(Number(mouth().getAttribute('data-mouth'))).toBe(0);
  });

  it('shows the thinking indicator only when thinking', () => {
    const { rerender } = render(<CompanionAvatar state="thinking" />);
    expect(screen.getByTestId('avatar-thinking')).toHaveStyle({ opacity: '1' });
    rerender(<CompanionAvatar state="idle" />);
    expect(screen.getByTestId('avatar-thinking')).toHaveStyle({ opacity: '0' });
  });

  it('blinks on a 2-6s timer', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { container } = render(<CompanionAvatar state="idle" />);
    const lid = () => container.querySelector<SVGRectElement>('.pvc-lid')!.style.transform;
    expect(lid()).toBe('scaleY(0.22)');
    act(() => void vi.advanceTimersByTime(2001));
    expect(lid()).toBe('scaleY(1)');
    act(() => void vi.advanceTimersByTime(200));
    expect(lid()).toBe('scaleY(0.22)');
  });

  it('skips sway, blink and nod under reduced motion but still moves the mouth', () => {
    mockReduced(true);
    const { container, rerender } = render(<CompanionAvatar state="listening" mouthOpen={0.8} />);
    expect(container.querySelector('.pvc-sway')).toBeNull();
    expect(container.querySelector('.pvc-breath')).toBeNull();
    act(() => void vi.advanceTimersByTime(20000));
    expect(container.querySelector<SVGRectElement>('.pvc-lid')!.style.transform).toBe(
      'scaleY(0.22)',
    );
    expect(container.querySelector('.pvc-nod')).toHaveAttribute('data-nod', 'false');
    rerender(<CompanionAvatar state="speaking" mouthOpen={0.8} />);
    act(() => void vi.advanceTimersByTime(600));
    expect(Number(mouth().getAttribute('data-mouth'))).toBeCloseTo(0.8, 1);
  });

  it('cancels timers and animation frames on unmount', () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = render(<CompanionAvatar state="listening" mouthOpen={1} />);
    unmount();
    expect(cancel).toHaveBeenCalled();
    expect(clear.mock.calls.length).toBeGreaterThanOrEqual(2); // blink + nod timers
    const before = vi.getTimerCount();
    act(() => void vi.advanceTimersByTime(30000));
    expect(vi.getTimerCount()).toBeLessThanOrEqual(before);
    expect(err).not.toHaveBeenCalled();
  });
});
