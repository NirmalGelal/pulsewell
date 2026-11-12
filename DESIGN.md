# Design

Mood: a quiet consulting room. Ink on white paper, a highlighter for evidence. Register: product. Strategy: Restrained (tinted neutrals, one ink-blue action color, risk colors only for risk).

## Tokens (see apps/web/src/index.css; use semantic classes, never raw hex)
- Surface: `bg-background` (pure white) for content; `bg-surface` / `bg-surface-strong` for panels, rails, toolbars (second neutral).
- Ink: `text-foreground`; secondary `text-muted-foreground` (already >= 4.5:1).
- Action/selection: `bg-primary text-primary-foreground` (deep ink-blue). Nothing else is saturated.
- Evidence: `bg-mark text-mark-foreground` (highlighter). Used for evidence chips, the transcript turn a chip jumps to, and quotes.
- Risk: `danger` (imminent/red flag), `warn` (elevated/concern), each with `-soft` bg and `-border`. Risk is always also written in words and an icon, never color alone. Strong red appears ONLY for crisis/red flags.
- Good/complete: `ok`, `ok-soft`.
- Radius 0.5rem (8px) default; cards at most 12px; pills only for tags. No 24px+ radius.

## Type
- Public Sans (UI, body, data) + Newsreader (serif: h1-h3, companion speech, patient quotes, report headings). Serif never appears in buttons, labels, tables or data.
- Fixed rem scale, ratio ~1.2: 0.8125 / 0.9375 / 1 / 1.1875 / 1.4375 / 1.75 / 2.125rem. Patient base is 18px (html). Body line length 65ch max.
- Tabular numbers (`tabular-nums`) for all scores and dates.

## Layout and components
- No card-grid-of-identical-tiles; no nested cards; no side-stripe borders (border-left > 1px); no gradient text; no glassmorphism; no hero-metric tiles; no tracked-uppercase eyebrow on every section; no numbered section markers unless a true sequence.
- Prefer rules (1px borders), whitespace and type hierarchy over boxes. One shadow level max, blur <= 8px; do not combine a border with a wide soft shadow.
- Patient: single centered column (max ~42rem), one primary action per screen, generous spacing, companion messages as serif text on the page (not bubbles with avatars); patient messages as a quiet right-aligned block. No emoji. No illustration.
- Clinician: dense, left-aligned, scannable; queue as a real table/list with trend and risk columns; report as a document with a sticky evidence/transcript rail on wide screens, tabs/stacked on narrow.
- Every interactive element: default, hover, focus-visible (2px ring), active, disabled, loading. Skeletons, not spinners. Empty states teach.
- Motion: 150-200ms ease-out (`--ease-out`), state changes only; honor prefers-reduced-motion. No page-load choreography.
- Copy: no em dashes, verb+object buttons, never diagnostic, no marketing words.
- z-index via `--z-*` tokens only.
