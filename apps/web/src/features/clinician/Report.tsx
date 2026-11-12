import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CircleSlash, EyeOff, Info } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  ANSWER_OPTIONS,
  ClinicianReportDtoSchema,
  DOMAINS,
  GAD7_ITEMS,
  INSTRUMENT_ATTRIBUTION,
  PHQ9_ITEMS,
  SUMMARY_SECTIONS,
  SUMMARY_SECTION_LABELS,
  describeBand,
  domainDef,
  type ClinicianNoteDto,
  type ClinicianReportDto,
  type EvidenceItem,
  type InstrumentResult,
  type ReportContent,
} from '@pvc/shared';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { clinicianKeys, EvidenceChip, formatDateTime, formatShortDate, RiskBadge } from './common';
import { AskPanel, FollowUpDialog, NotesPanel, TranscriptPanel } from './panels';

export const REPORT_BANNER =
  'AI-generated summary of a patient-approved conversation. Not a diagnosis. Verify against the transcript.';
const NOT_SHARED_ITEM = 'Patient chose not to share this item.';
const NOT_SHARED_QUOTE = 'Patient chose not to share this quote.';

type Jump = (turnId: number) => void;

function Section({
  title,
  children,
  id,
  tone,
}: {
  title: string;
  children: ReactNode;
  id?: string;
  tone?: 'danger';
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        tone === 'danger'
          ? 'rounded-lg border border-danger-border bg-danger-soft p-4'
          : 'border-t pt-5',
      )}
    >
      <h2 id={id} className={cn('mb-3 text-[1.1875rem]', tone === 'danger' && 'text-danger')}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Chips({ turnIds, onJump }: { turnIds: number[]; onJump: Jump }) {
  return (
    <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
      {turnIds.map((t) => (
        <EvidenceChip key={t} turnId={t} onJump={onJump} />
      ))}
    </span>
  );
}

/** A patient's words: serif italic with a highlighter behind the text. */
function Marked({ children }: { children: ReactNode }) {
  return (
    <span className="font-serif italic">
      <mark className="rounded-sm bg-mark px-0.5 text-mark-foreground [box-decoration-break:clone]">
        {children}
      </mark>
    </span>
  );
}

function NotShared({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <EyeOff className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="italic">{children}</span>
    </span>
  );
}

function Items({ items, onJump }: { items: EvidenceItem[]; onJump: Jump }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((it) => (
        <li key={it.id} className="max-w-[65ch] text-[0.9375rem] leading-relaxed">
          {it.removedByPatient ? (
            <NotShared>{NOT_SHARED_ITEM}</NotShared>
          ) : it.patientCorrection ? (
            <>
              <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                {it.text}
              </span>
              <Chips turnIds={it.turnIds} onJump={onJump} />
              <div className="mt-1 rounded bg-surface-strong px-2.5 py-1.5">
                <strong className="font-semibold">Patient correction:</strong>{' '}
                {it.patientCorrection}
              </div>
            </>
          ) : (
            <>
              {it.text}
              <Chips turnIds={it.turnIds} onJump={onJump} />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

const valueLabel = (v: number) => ANSWER_OPTIONS.find((o) => o.value === v)?.label ?? String(v);
const bandWord = (b: string) => b.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function ScreeningBlock({
  kind,
  result,
  history,
}: {
  kind: 'phq9' | 'gad7';
  result: InstrumentResult;
  history: number[];
}) {
  const [open, setOpen] = useState(false);
  const name = kind === 'phq9' ? 'PHQ-9' : 'GAD-7';
  const max = kind === 'phq9' ? 27 : 21;
  const defs = kind === 'phq9' ? PHQ9_ITEMS : GAD7_ITEMS;
  const missing = result.items.length - result.answeredCount;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-3">
        <h3 className="font-sans text-[0.9375rem] font-semibold">{name}</h3>
        {result.total !== null && result.band ? (
          <span className="text-2xl font-semibold tabular-nums">
            {result.total}
            <span className="text-sm font-normal text-muted-foreground">/{max}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-warn">
            <CircleSlash className="size-3.5" aria-hidden="true" />
            Incomplete
          </span>
        )}
      </div>
      {result.total !== null && result.band ? (
        <p className="mt-0.5 text-sm">
          <span className="font-medium">{bandWord(result.band)}</span>
          <span className="text-muted-foreground">
            {' '}
            · {describeBand(kind, result.band).clinical}
          </span>
        </p>
      ) : (
        <p className="mt-0.5 text-sm text-muted-foreground">
          Incomplete (partial sum {result.partialSum}; {missing} missing)
        </p>
      )}
      {history.length > 0 && (
        <p className="mt-1 text-[0.8125rem] tabular-nums text-muted-foreground">
          Earlier totals (newest first): {history.join(' → ')}
        </p>
      )}
      <button
        type="button"
        className="mt-1.5 rounded-sm text-[0.8125rem] font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide' : 'Show'} {name} items
      </button>
      {open && (
        <table className="mt-2 w-full text-sm" aria-label={`${name} items`}>
          <tbody>
            {result.items.map((it, i) => {
              const flag = it.key === 'phq9_9' && (it.value ?? 0) >= 1;
              return (
                <tr
                  key={it.key}
                  data-flag={flag ? 'true' : undefined}
                  className={cn('border-t', flag && 'bg-danger-soft font-semibold text-danger')}
                >
                  <td className="px-1 py-1 pr-3">{defs[i]?.shortLabel ?? it.key}</td>
                  <td className="py-1 tabular-nums">
                    {it.value !== null ? `${it.value} · ${valueLabel(it.value)}` : it.status}
                    {flag && ' (safety item)'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReportBody({
  report,
  content,
  onJump,
  onReview,
  reviewing,
  onFollowUp,
}: {
  report: ClinicianReportDto;
  content: ReportContent;
  onJump: Jump;
  onReview: () => void;
  reviewing: boolean;
  onFollowUp: () => void;
}) {
  const annotationSections = [...new Set(content.patientAnnotations.map((a) => a.section))];
  const sectionLabel = (s: string) =>
    SUMMARY_SECTION_LABELS[s as keyof typeof SUMMARY_SECTION_LABELS]?.label ??
    (s === 'priorities'
      ? 'Priorities'
      : s === 'quotes'
        ? 'Quotes'
        : s === 'risk'
          ? 'Risk'
          : 'Screening');
  const p = content.provenance;
  return (
    <article className="flex min-w-0 max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[2.125rem] leading-tight">{report.patient.displayName}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums text-muted-foreground">
            <span>
              {formatDateTime(content.session.startedAt)} · {content.session.durationMinutes} min
            </span>
            <RiskBadge level={content.risk.level} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {report.reviewedAt ? (
            <Button disabled>Reviewed {formatShortDate(report.reviewedAt)}</Button>
          ) : (
            <Button onClick={onReview} disabled={reviewing}>
              Mark reviewed
            </Button>
          )}
          <Button variant="outline" onClick={onFollowUp}>
            Send follow-up questions
          </Button>
        </div>
      </header>

      {content.risk.flags.length > 0 && (
        <Section title="Risk flags" id="sec-risk" tone="danger">
          <ul className="flex flex-col divide-y divide-danger-border">
            {content.risk.flags.map((f, i) => (
              <li key={i} className="py-2.5 first:pt-0 last:pb-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.9375rem]">
                  <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden="true" />
                  <strong className="font-semibold capitalize">
                    {f.category.replace(/_/g, ' ')}
                  </strong>
                  <span className="font-semibold capitalize text-danger">{f.level}</span>
                  <span className="text-[0.8125rem] text-muted-foreground">Source: {f.source}</span>
                </p>
                {f.evidence && (
                  <p className="mt-1 max-w-[65ch] pl-6 leading-relaxed">
                    <Marked>&ldquo;{f.evidence}&rdquo;</Marked>
                    <Chips turnIds={[f.turnId]} onJump={onJump} />
                  </p>
                )}
                {!f.evidence && (
                  <p className="mt-1 pl-6">
                    <Chips turnIds={[f.turnId]} onJump={onJump} />
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Patient priorities" id="sec-priorities">
        {content.priorities.length ? (
          <Items items={content.priorities} onJump={onJump} />
        ) : (
          <p className="text-sm text-muted-foreground">None recorded.</p>
        )}
      </Section>

      <Section title="Screening" id="sec-screening">
        <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
          <ScreeningBlock
            kind="phq9"
            result={content.screening.phq9}
            history={report.history.map((h) => h.phq9Total).filter((x): x is number => x !== null)}
          />
          <ScreeningBlock
            kind="gad7"
            result={content.screening.gad7}
            history={report.history.map((h) => h.gad7Total).filter((x): x is number => x !== null)}
          />
        </div>
      </Section>

      <Section title="Clinical summary" id="sec-summary">
        <div className="flex flex-col gap-4">
          {SUMMARY_SECTIONS.map((s) => (
            <div key={s}>
              <h3 className="mb-1 font-sans text-sm font-semibold">
                {SUMMARY_SECTION_LABELS[s].label}
              </h3>
              {content.summary[s].length ? (
                <Items items={content.summary[s]} onJump={onJump} />
              ) : (
                <p className="text-sm text-muted-foreground">Nothing recorded.</p>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="In the patient's words" id="sec-quotes">
        {content.quotes.length ? (
          <ul className="flex flex-col gap-3">
            {content.quotes.map((q) => (
              <li key={q.id} className="max-w-[65ch] text-lg leading-relaxed">
                {q.removedByPatient ? (
                  <span className="font-sans text-[0.9375rem]">
                    <NotShared>{NOT_SHARED_QUOTE}</NotShared>
                  </span>
                ) : (
                  <>
                    <Marked>
                      <q>{q.text}</q>
                    </Marked>
                    <Chips turnIds={[q.turnId]} onJump={onJump} />
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No quotes.</p>
        )}
      </Section>

      <Section title="Patient notes, gaps and declined topics" id="sec-notes">
        <div className="flex flex-col gap-4 text-[0.9375rem]">
          <div>
            <h3 className="mb-1 font-sans text-sm font-semibold">Patient notes</h3>
            {annotationSections.length === 0 ? (
              <p className="text-muted-foreground">None.</p>
            ) : (
              annotationSections.map((s) => (
                <div key={s} className="mb-1.5">
                  <p className="text-[0.8125rem] text-muted-foreground">{sectionLabel(s)}</p>
                  <ul className="list-disc pl-5">
                    {content.patientAnnotations
                      .filter((a) => a.section === s)
                      .map((a) => (
                        <li key={a.id}>{a.text}</li>
                      ))}
                  </ul>
                </div>
              ))
            )}
          </div>
          <div>
            <h3 className="mb-1 font-sans text-sm font-semibold">Not discussed</h3>
            <p>
              {content.notDiscussed.length
                ? content.notDiscussed.map((d) => domainDef(d).label).join(', ')
                : 'Nothing flagged.'}
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-sans text-sm font-semibold">Declined by patient</h3>
            <p>
              {content.declinedTopics.length
                ? content.declinedTopics
                    .map((d) => DOMAINS.find((x) => x.key === d)?.label ?? d)
                    .join(', ')
                : 'Nothing declined.'}
            </p>
          </div>
        </div>
      </Section>

      <footer className="border-t pt-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
        <p>
          Writer model: {p.writerModel} · Verifier: {p.verifierModel ?? 'not run'} · Claims checked{' '}
          {p.verification.claimsChecked}, removed {p.verification.claimsRemoved}; quotes removed{' '}
          {p.verification.quotesRemoved}
          {p.verification.regenerated ? '; regenerated once' : ''} · Generated{' '}
          {formatDateTime(p.generatedAt)}
        </p>
        <p className="mt-1">{INSTRUMENT_ATTRIBUTION}</p>
      </footer>
    </article>
  );
}

type Tab = 'transcript' | 'ask' | 'notes';

export default function Report() {
  const { reportId = '' } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('transcript');
  const [highlight, setHighlight] = useState<number | null>(null);
  const [jumpSeq, setJumpSeq] = useState(0);
  const [followUp, setFollowUp] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key = clinicianKeys.report(reportId);
  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<ClinicianReportDto>(`/api/clinician/reports/${reportId}`, ClinicianReportDtoSchema),
    retry: false,
  });

  const review = useMutation({
    mutationFn: () =>
      api.post<{ reviewedAt: string }>(
        `/api/clinician/reports/${reportId}/review`,
        undefined,
        z.object({ reviewedAt: z.string() }),
      ),
    onSuccess: (r) => {
      qc.setQueryData<ClinicianReportDto>(
        key,
        (old) => old && { ...old, reviewedAt: r.reviewedAt },
      );
      void qc.invalidateQueries({ queryKey: clinicianKeys.queue });
      void qc.invalidateQueries({ queryKey: clinicianKeys.patients });
    },
    onError: () => toast.error("Couldn't mark as reviewed. Please try again."),
  });

  const jump: Jump = (turnId) => {
    setTab('transcript');
    setHighlight(turnId);
    setJumpSeq((n) => n + 1);
  };

  useEffect(() => {
    if (highlight === null) return;
    const el = document.getElementById(`turn-${highlight}`);
    if (el) {
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHighlight(null), 2000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [jumpSeq]);

  if (q.isPending)
    return (
      <div role="status" aria-label="Loading the report" className="mx-auto max-w-3xl p-6">
        <div className="h-9 w-56 animate-pulse rounded bg-surface" />
        <div className="mt-6 h-40 animate-pulse rounded bg-surface" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <p role="alert" className="p-6 text-danger">
        This report isn&apos;t available.
      </p>
    );
  const report = q.data;
  const tabs: [Tab, string][] = [
    ['transcript', 'Transcript'],
    ['ask', 'Ask'],
    ['notes', `Notes (${report.notes.length})`],
  ];

  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-4 sm:px-6">
      <p
        role="note"
        className="mb-5 flex items-start gap-2 rounded-md bg-surface px-3 py-2 text-sm text-muted-foreground"
      >
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{REPORT_BANNER}</span>
      </p>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem] xl:grid-cols-[minmax(0,1fr)_30rem]">
        <ReportBody
          report={report}
          content={report.content}
          onJump={jump}
          onReview={() => review.mutate()}
          reviewing={review.isPending}
          onFollowUp={() => setFollowUp(true)}
        />
        <aside
          aria-label="Transcript, questions and notes"
          className="flex min-w-0 flex-col rounded-lg bg-surface lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:self-start"
        >
          <div role="tablist" aria-label="Record tools" className="flex gap-1 border-b px-2 pt-2">
            {tabs.map(([k, label]) => (
              <button
                key={k}
                role="tab"
                id={`tab-${k}`}
                type="button"
                aria-selected={tab === k}
                aria-controls={`panel-${k}`}
                onClick={() => setTab(k)}
                className={cn(
                  '-mb-px rounded-t border-b-2 px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  tab === k
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 max-lg:max-h-[34rem]">
            <div
              role="tabpanel"
              id="panel-transcript"
              aria-labelledby="tab-transcript"
              hidden={tab !== 'transcript'}
            >
              <TranscriptPanel turns={report.transcript} highlight={highlight} />
            </div>
            <div role="tabpanel" id="panel-ask" aria-labelledby="tab-ask" hidden={tab !== 'ask'}>
              <AskPanel
                patientId={report.patient.id}
                currentSessionId={report.session.id}
                onJump={jump}
              />
            </div>
            <div
              role="tabpanel"
              id="panel-notes"
              aria-labelledby="tab-notes"
              hidden={tab !== 'notes'}
            >
              <NotesPanel
                reportId={reportId}
                notes={report.notes}
                onAdded={(n: ClinicianNoteDto) =>
                  qc.setQueryData<ClinicianReportDto>(
                    key,
                    (old) => old && { ...old, notes: [...old.notes, n] },
                  )
                }
              />
            </div>
          </div>
        </aside>
      </div>
      {followUp && (
        <FollowUpDialog patientId={report.patient.id} onClose={() => setFollowUp(false)} />
      )}
    </div>
  );
}
