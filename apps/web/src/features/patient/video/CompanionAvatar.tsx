import { useEffect, useId, useRef, useState } from 'react';

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface CompanionAvatarProps {
  state: AvatarState;
  /** 0..1 mouth openness, updated by the caller while speaking (lip-sync). Smoothed internally. */
  mouthOpen?: number;
  /** Sized by the parent (portrait tile, aspect about 4:5). */
  className?: string;
}

const LABELS: Record<AvatarState, string> = {
  idle: 'Your companion, resting',
  listening: 'Your companion, listening',
  thinking: 'Your companion, thinking',
  speaking: 'Your companion, speaking',
};

const SKIN = 'oklch(0.74 0.055 58)';
const SKIN_SHADE = 'oklch(0.67 0.06 55)';
const HAIR = 'oklch(0.3 0.035 50)';
const BROW = 'oklch(0.33 0.035 50)';
const INK = 'oklch(0.27 0.03 40)';
const LIP = 'oklch(0.52 0.08 35)';
const MOUTH_X = 200;
const MOUTH_Y = 281;

/** Mouth outline for openness m (0 closed soft smile, 1 wide open). */
export function mouthPath(m: number): string {
  const v = Math.min(1, Math.max(0, m));
  const half = 19 + 7 * v;
  const l = MOUTH_X - half;
  const r = MOUTH_X + half;
  const top = MOUTH_Y + 4 - 12 * v;
  const bot = MOUTH_Y + 4 + 46 * v;
  const k = 9 + 6 * v; // horizontal inset of the control points
  return `M${l} ${MOUTH_Y} C${l + k} ${top} ${r - k} ${top} ${r} ${MOUTH_Y} C${r - k + 4} ${bot} ${l + k - 4} ${bot} ${l} ${MOUTH_Y} Z`;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

const CSS = `
.pvc-av *{transform-box:view-box}
.pvc-tilt{transform-origin:200px 350px;transition:transform 600ms var(--ease-out,ease-out)}
.pvc-sway{transform-origin:200px 350px;animation:pvc-sway 7s ease-in-out infinite}
.pvc-breath{transform-origin:200px 500px;animation:pvc-breath 5s ease-in-out infinite}
.pvc-nod{transform-origin:200px 330px}
.pvc-nod[data-nod="true"]{animation:pvc-nod 900ms ease-in-out 1}
.pvc-lid{transform-box:fill-box;transform-origin:50% 0;transition:transform 90ms ease-out}
.pvc-iris{transition:transform 350ms var(--ease-out,ease-out)}
.pvc-brows{transition:transform 350ms var(--ease-out,ease-out)}
.pvc-dots{transition:opacity 250ms ease-out}
.pvc-dot{animation:pvc-dot 1.8s ease-in-out infinite}
@keyframes pvc-sway{0%,100%{transform:rotate(-0.7deg)}50%{transform:rotate(0.7deg)}}
@keyframes pvc-breath{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
@keyframes pvc-nod{0%,100%{transform:rotate(0)}40%{transform:rotate(2.2deg) translateY(4px)}}
@keyframes pvc-dot{0%,100%{opacity:.3}50%{opacity:.9}}
@media (prefers-reduced-motion:reduce){
.pvc-sway,.pvc-breath,.pvc-dot{animation:none}
.pvc-nod[data-nod="true"]{animation:none}
.pvc-tilt,.pvc-lid,.pvc-iris,.pvc-brows{transition:none}
}
`;

export function CompanionAvatar({ state, mouthOpen = 0, className }: CompanionAvatarProps) {
  const uid = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  const [blink, setBlink] = useState(false);
  const [nod, setNod] = useState(false);
  const mouthRef = useRef<SVGPathElement>(null);
  const innerRef = useRef<SVGPathElement>(null);
  const target = useRef(0);
  const current = useRef(0);
  const speaking = state === 'speaking';
  target.current = speaking ? Math.min(1, Math.max(0, mouthOpen)) : 0;

  // Blink at random 2-6s intervals.
  useEffect(() => {
    if (reduced) return;
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t1 = setTimeout(
        () => {
          setBlink(true);
          t2 = setTimeout(() => {
            setBlink(false);
            schedule();
          }, 140);
        },
        2000 + Math.random() * 4000,
      );
    };
    schedule();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      setBlink(false);
    };
  }, [reduced]);

  // Occasional small nod while listening.
  useEffect(() => {
    if (reduced || state !== 'listening') return;
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t1 = setTimeout(
        () => {
          setNod(true);
          t2 = setTimeout(() => {
            setNod(false);
            schedule();
          }, 950);
        },
        3500 + Math.random() * 4000,
      );
    };
    schedule();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      setNod(false);
    };
  }, [reduced, state]);

  // Smooth the mouth toward its target with rAF easing.
  useEffect(() => {
    let raf = 0;
    const apply = (v: number) => {
      const d = mouthPath(v);
      mouthRef.current?.setAttribute('d', d);
      innerRef.current?.setAttribute('d', d);
      mouthRef.current?.setAttribute('data-mouth', v.toFixed(2));
    };
    const tick = () => {
      const diff = target.current - current.current;
      if (Math.abs(diff) < 0.004) {
        current.current = target.current;
        apply(current.current);
        raf = 0;
        return;
      }
      current.current += diff * 0.35;
      apply(current.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // re-run whenever the target changes
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [state, mouthOpen]);

  const thinking = state === 'thinking';
  const listening = state === 'listening';
  const gaze = thinking
    ? 'translate(-6px,-5px)'
    : listening
      ? 'translate(0,1px)'
      : 'translate(0,0)';
  const brows = thinking
    ? 'translateY(-4px)'
    : listening
      ? 'translateY(-3px)'
      : speaking
        ? `translateY(${(-1.5 - 2.5 * Math.min(1, mouthOpen)).toFixed(1)}px)`
        : 'translateY(0)';
  const tilt = reduced
    ? 'none'
    : listening
      ? 'rotate(-3deg)'
      : thinking
        ? 'rotate(1.5deg)'
        : 'none';
  const initial = mouthPath(0);

  const eye = (cx: number) => (
    <g>
      <clipPath id={`${uid}e${cx}`}>
        <ellipse cx={cx} cy={216} rx={17} ry={12} />
      </clipPath>
      <ellipse cx={cx} cy={216} rx={17} ry={12} fill="oklch(0.97 0.005 80)" />
      <g clipPath={`url(#${uid}e${cx})`}>
        <g className="pvc-iris" style={{ transform: gaze }}>
          <circle cx={cx} cy={216} r={9} fill="oklch(0.38 0.05 55)" />
          <circle cx={cx} cy={216} r={4.2} fill={INK} />
        </g>
        <rect
          className="pvc-lid"
          x={cx - 18}
          y={202}
          width={36}
          height={26}
          fill={SKIN}
          style={{ transform: `scaleY(${blink ? 1 : thinking ? 0.1 : 0.22})` }}
        />
      </g>
      <path
        d={`M${cx - 18} 216 Q${cx} 201 ${cx + 18} 216`}
        fill="none"
        stroke={SKIN_SHADE}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </g>
  );

  return (
    <div
      className={className}
      role="img"
      aria-label={LABELS[state]}
      data-state={state}
      style={{ overflow: 'hidden', background: 'var(--surface)' }}
    >
      <style>{CSS}</style>
      <svg
        className="pvc-av"
        viewBox="30 55 340 425"
        preserveAspectRatio="xMidYMax slice"
        width="100%"
        height="100%"
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block' }}
      >
        <rect x="0" y="0" width="400" height="520" fill="var(--surface)" />
        <g className={reduced ? undefined : 'pvc-breath'}>
          <path d="M163 290 L163 372 L237 372 L237 290 Z" fill={SKIN_SHADE} />
          {/* shoulders */}
          <path
            d="M-20 540 L-20 452 Q0 386 128 364 L272 364 Q400 386 420 452 L420 540 Z"
            fill="var(--primary)"
          />
          <path d="M146 364 Q200 424 254 364 Z" fill={SKIN_SHADE} />
          {/* neck */}
          <path
            d="M165 345 Q200 372 235 345 L235 320 L165 320 Z"
            fill="oklch(0.6 0.06 52)"
            opacity="0.45"
          />
        </g>
        <g className="pvc-tilt" style={{ transform: tilt }}>
          <g className={reduced ? undefined : 'pvc-sway'}>
            <g className="pvc-nod" data-nod={nod ? 'true' : 'false'}>
              {/* back hair */}
              <path
                d="M114 215 Q104 92 200 88 Q296 92 286 215 Q290 276 268 304 Q250 322 232 306 L168 306 Q150 322 132 304 Q110 276 114 215 Z"
                fill={HAIR}
              />
              {/* ears */}
              <ellipse cx={122} cy={226} rx={10} ry={17} fill={SKIN_SHADE} />
              <ellipse cx={278} cy={226} rx={10} ry={17} fill={SKIN_SHADE} />
              {/* head */}
              <ellipse cx={200} cy={216} rx={80} ry={96} fill={SKIN} />
              {/* fringe */}
              <path
                d="M118 196 Q112 112 200 106 Q290 112 282 196 Q268 150 236 140 Q196 160 150 142 Q128 160 118 196 Z"
                fill={HAIR}
              />
              {/* brows */}
              <g className="pvc-brows" style={{ transform: brows }}>
                <path
                  d="M146 188 Q166 177 186 187"
                  fill="none"
                  stroke={BROW}
                  strokeWidth={5}
                  strokeLinecap="round"
                />
                <path
                  d="M214 187 Q234 177 254 188"
                  fill="none"
                  stroke={BROW}
                  strokeWidth={5}
                  strokeLinecap="round"
                />
              </g>
              {eye(166)}
              {eye(234)}
              {/* nose */}
              <path
                d="M197 236 Q191 262 200 266 Q206 267 208 263"
                fill="none"
                stroke={SKIN_SHADE}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* mouth */}
              <path ref={innerRef} d={initial} fill="oklch(0.34 0.06 25)" stroke="none" />
              <path
                ref={mouthRef}
                d={initial}
                data-testid="avatar-mouth"
                data-mouth="0.00"
                fill="none"
                stroke={LIP}
                strokeWidth={4.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          </g>
        </g>
        {/* thinking indicator, outside the face */}
        <g
          className="pvc-dots"
          data-testid="avatar-thinking"
          style={{ opacity: thinking ? 1 : 0 }}
          fill="var(--primary)"
        >
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              className={reduced ? undefined : 'pvc-dot'}
              cx={318 + i * 22}
              cy={84 - i * 8}
              r={6 + i}
              style={{ animationDelay: `${i * 0.3}s`, opacity: reduced ? 0.7 : undefined }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
