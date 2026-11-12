import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  CRISIS_RESOURCES,
  DOMAINS,
  ELEVATED_RESOURCES_TEXT,
  PatientReportDtoSchema,
  SUMMARY_SECTIONS,
  SUMMARY_SECTION_LABELS,
  SessionDtoSchema,
  describeBand,
  riskRank,
  type AnnotatableSection,
  type EditableSection,
  type EvidenceItem,
  type InstrumentResult,
  type PatientReportDto,
  type ReportContent,
  type ReportEditInput,
} from '@pvc/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { cn } from '@/lib/utils';
import { formatDate } from './labels';

const CliniciansSchema = z.object({
  clinicians: z.array(z.object({ id: z.string(), displayName: z.string() })),
});
const ApproveResponseSchema = z.object({
  report: PatientReportDtoSchema,
  session: SessionDtoSchema,
});

export default function Review() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [sentNow, setSentNow] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  const reportQuery = useQuery({
    queryKey: queryKeys.report(id),
    queryFn: () => api.get<PatientReportDto>(`/api/sessions/${id}/report`, PatientReportDtoSchema),
    retry: false,
  });
  const clinicians = useQuery({
    queryKey: queryKeys.clinicians,
    queryFn: () => api.get('/api/patient/clinicians', CliniciansSchema),
  });

  const edit = useMutation({
    mutationFn: (e: ReportEditInput) =>
      api.patch<PatientReportDto>(
        `/api/sessions/${id}/report`,
        { edits: [e] },
        PatientReportDtoSchema,
      ),
    onSuccess: (r) => qc.setQueryData(queryKeys.report(id), r),
    onError: () => toast.error("That change didn't save. Please try again."),
  });

  const approve = useMutation({
    mutationFn: () =>
      api.post(`/api/sessions/${id}/report/approve`, undefined, ApproveResponseSchema),
    onSuccess: (r) => {
      qc.setQueryData(queryKeys.report(id), r.report);
      void qc.invalidateQueries({ queryKey: queryKeys.sessions });
      void qc.invalidateQueries({ queryKey: queryKeys.session(id) });
      setConfirmSend(false);
      setSentNow(true);
    },
    onError: () => {
      setConfirmSend(false);
      toast.error("We couldn't send your summary. Please try again.");
    },
  });

  if (reportQuery.isPending)
    return (
      <div role="status" className="mx-auto w-full max-w-[42rem] space-y-4 px-4 pt-14">
        <Skeleton className="h-9 w-4/5" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-3/4" />
        <span className="sr-only">Loading your summary…</span>
      </div>
    );
  if (reportQuery.isError || !reportQuery.data)
    return (
      <div className="mx-auto w-full max-w-[42rem] px-4 pt-14">
        <div role="alert">
          <p className="font-serif text-[1.4375rem] leading-snug">Your summary isn't ready yet.</p>
          <Link
            to={`/patient/session/${id}`}
            className={cn(buttonVariants({ size: 'lg' }), 'mt-5 h-12')}
          >
            Go back to your conversation
          </Link>
        </div>
      </div>
    );

  const report = reportQuery.data;
  const c = report.content;
  const approved = report.status === 'APPROVED';
  const readOnly = approved;
  const names =
    clinicians.data?.clinicians.map((x) => x.displayName).join(' and ') || 'your clinician';
  const send = (e: ReportEditInput) =>
    edit.mutateAsync(e).then(
      () => true,
      () => false,
    );

  if (sentNow)
    return (
      <div className="mx-auto w-full max-w-[42rem] px-4 pb-16 pt-14">
        <div role="status">
          <h1 className="text-[2.125rem] leading-tight">Sent.</h1>
          <p className="mt-3 text-[1.1875rem] text-muted-foreground">
            Your clinician will see this before your visit.
          </p>
        </div>
        <Link
          to="/patient"
          className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'mt-8 h-12')}
        >
          Back to home
        </Link>
        <Footer />
      </div>
    );

  const visibleSections = SUMMARY_SECTIONS.filter((s) => c.summary[s].length > 0);
  const notes = (section: AnnotatableSection) =>
    c.patientAnnotations.filter((a) => a.section === section);

  return (
    <div className="mx-auto w-full max-w-[42rem] space-y-10 px-4 pb-20 pt-10 sm:pt-14">
      <header>
        <h1 className="text-[2.125rem] leading-tight">Here's what we'll share with {names}</h1>
        {approved ? (
          <p className="mt-3 text-[1.1875rem] font-medium text-ok">
            Sent{report.approvedAt ? ` on ${formatDate(report.approvedAt)}` : ''}. This summary is
            now read-only.
          </p>
        ) : (
          <p className="mt-3 text-[1.1875rem] leading-relaxed text-muted-foreground">
            Read it through. This is written from what you said. You can fix anything that isn't
            right, add a note, or choose not to share a part.
          </p>
        )}
      </header>

      {riskRank(c.risk.level) >= riskRank('elevated') && (
        <Section title="Your safety" id="safety" tone="danger">
          <p className="text-[1.0625rem]">
            You shared something about your safety. We've marked it so your clinician sees it first.
          </p>
          <p className="mt-2">{ELEVATED_RESOURCES_TEXT}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {CRISIS_RESOURCES.map((r) => (
              <li key={r.id}>
                <a
                  href={r.href}
                  className="inline-block rounded-lg bg-danger px-4 py-3 font-medium text-danger-foreground"
                >
                  {r.name}: {r.action}
                </a>
              </li>
            ))}
          </ul>
          <NoteArea
            section="risk"
            notes={notes('risk')}
            readOnly={readOnly}
            onSave={(text) => send({ kind: 'annotate', section: 'risk', text })}
          />
        </Section>
      )}

      <Section title="What matters most to you" id="priorities">
        {c.priorities.length === 0 && (
          <p className="text-muted-foreground">Nothing was noted here.</p>
        )}
        <ul className="space-y-3">
          {c.priorities.map((it) => (
            <ItemRow key={it.id} item={it} section="priorities" readOnly={readOnly} send={send} />
          ))}
        </ul>
        <NoteArea
          section="priorities"
          notes={notes('priorities')}
          readOnly={readOnly}
          onSave={(text) => send({ kind: 'annotate', section: 'priorities', text })}
        />
      </Section>

      <Section title="Your check-in answers" id="screening">
        <ul className="space-y-3 text-[1.0625rem]">
          <li>
            <strong>Mood check-in:</strong> {screeningText('phq9', c.screening.phq9, 9)}
          </li>
          <li>
            <strong>Worry check-in:</strong> {screeningText('gad7', c.screening.gad7, 7)}
          </li>
        </ul>
        <NoteArea
          section="screening"
          notes={notes('screening')}
          readOnly={readOnly}
          onSave={(text) => send({ kind: 'annotate', section: 'screening', text })}
        />
      </Section>

      {visibleSections.length > 0 && (
        <section aria-labelledby="summary-h" className="space-y-8">
          <h2 id="summary-h" className="border-t pt-6 text-[1.75rem]">
            Summary
          </h2>
          {visibleSections.map((s) => (
            <Section key={s} title={SUMMARY_SECTION_LABELS[s].plainLabel} id={s} level={3}>
              <ul className="space-y-3">
                {c.summary[s].map((it) => (
                  <ItemRow key={it.id} item={it} section={s} readOnly={readOnly} send={send} />
                ))}
              </ul>
              <NoteArea
                section={s}
                notes={notes(s)}
                readOnly={readOnly}
                onSave={(text) => send({ kind: 'annotate', section: s, text })}
              />
            </Section>
          ))}
        </section>
      )}

      {c.quotes.length > 0 && (
        <Section title="In your words" id="quotes">
          <ul className="space-y-3">
            {c.quotes.map((q) => (
              <QuoteRow key={q.id} quote={q} readOnly={readOnly} send={send} />
            ))}
          </ul>
          <NoteArea
            section="quotes"
            notes={notes('quotes')}
            readOnly={readOnly}
            onSave={(text) => send({ kind: 'annotate', section: 'quotes', text })}
          />
        </Section>
      )}

      {c.notDiscussed.length > 0 && (
        <Section title="Not discussed" id="not-discussed">
          <ul className="list-disc space-y-1 pl-6 text-[1.0625rem]">
            {c.notDiscussed.map((k) => (
              <li key={k}>{DOMAINS.find((d) => d.key === k)?.plainLabel ?? k}</li>
            ))}
          </ul>
        </Section>
      )}

      <section aria-labelledby="send-h" className="border-t-2 border-primary pt-6">
        <h2 id="send-h" className="text-[1.75rem]">
          {readOnly ? 'What your clinician can see' : 'Ready to send?'}
        </h2>
        <p className="mt-3 text-[1.0625rem] leading-relaxed">
          Your clinician will also be able to read your conversation, except the parts you choose
          not to share.
        </p>
        {!readOnly && (
          <>
            <p className="mt-2 text-muted-foreground">
              Nothing goes to {names} until you press the button below. You can still fix or hide
              things above first.
            </p>
            <Button
              size="lg"
              className="mt-6 h-14 w-full text-[1.1875rem]"
              onClick={() => setConfirmSend(true)}
            >
              Send to my clinician
            </Button>
          </>
        )}
      </section>
      <Footer />

      {confirmSend && (
        <ConfirmDialog
          title="Send to your clinician?"
          confirmLabel="Send"
          cancelLabel="Not yet"
          busy={approve.isPending}
          onConfirm={() => approve.mutate()}
          onCancel={() => setConfirmSend(false)}
        >
          {names} will be able to read this summary and your conversation, except anything you chose
          not to share.
        </ConfirmDialog>
      )}
    </div>
  );
}

function Footer() {
  return (
    <p className="mt-6 text-center text-[0.8125rem] text-muted-foreground">
      AI-prepared summary. Not a diagnosis.
    </p>
  );
}

function screeningText(kind: 'phq9' | 'gad7', r: InstrumentResult, total: number): string {
  if (r.complete && r.band) return describeBand(kind, r.band).plain;
  return `You answered ${r.answeredCount} of ${total} questions.`;
}

function Section({
  title,
  id,
  level = 2,
  tone,
  children,
}: {
  title: string;
  id: string;
  level?: 2 | 3;
  tone?: 'danger';
  children: ReactNode;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section
      aria-labelledby={`h-${id}`}
      className={cn(
        tone === 'danger'
          ? 'rounded-lg border border-danger-border bg-danger-soft p-5'
          : level === 2
            ? 'border-t pt-6'
            : 'border-t border-dashed pt-5',
      )}
    >
      <Heading
        id={`h-${id}`}
        className={cn('mb-4 leading-tight', level === 2 ? 'text-[1.75rem]' : 'text-[1.4375rem]')}
      >
        {title}
      </Heading>
      {children}
    </section>
  );
}

type SendEdit = (e: ReportEditInput) => Promise<boolean>;

function ItemRow({
  item,
  section,
  readOnly,
  send,
}: {
  item: EvidenceItem;
  section: EditableSection;
  readOnly: boolean;
  send: SendEdit;
}) {
  const [fixing, setFixing] = useState(false);
  const [text, setText] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fieldId = useId();
  const shown = item.patientCorrection || item.patientText;

  if (item.removedByPatient)
    return (
      <li className="flex items-baseline justify-between gap-3 text-[1.0625rem] text-muted-foreground">
        <span className="line-through">{item.patientText}</span>
        <span className="shrink-0 rounded-md border px-2 py-0.5 text-[0.8125rem]">Not shared</span>
      </li>
    );

  return (
    <li className="text-[1.0625rem] leading-relaxed">
      <p>
        {shown}
        {item.patientCorrection && (
          <span className="ml-2 text-[0.8125rem] text-muted-foreground">(you corrected this)</span>
        )}
      </p>
      {!readOnly && !fixing && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="h-11 px-4"
            aria-label={`Fix this: ${shown}`}
            onClick={() => {
              setText(shown);
              setFixing(true);
            }}
          >
            Fix this
          </Button>
          <Button
            variant="outline"
            className="h-11 px-4"
            aria-label={`Don't share this: ${shown}`}
            onClick={() => setConfirmRemove(true)}
          >
            Don't share this
          </Button>
        </div>
      )}
      {fixing && (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send({ kind: 'correct', section, itemId: item.id, text: text.trim() }).then(
              (ok) => ok && setFixing(false),
            );
          }}
        >
          <label htmlFor={fieldId} className="block text-base font-medium">
            How should this read?
          </label>
          <Textarea
            id={fieldId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            className="min-h-24 text-[1.0625rem]"
          />
          <div className="flex gap-2">
            <Button type="submit" className="h-11 px-4" disabled={!text.trim()}>
              Save change
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              onClick={() => setFixing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Don't share this?"
          confirmLabel="Don't share"
          cancelLabel="Keep it"
          onConfirm={() => {
            setConfirmRemove(false);
            void send({ kind: 'remove', section, itemId: item.id });
          }}
          onCancel={() => setConfirmRemove(false)}
        >
          “{shown}” will not be shared with your clinician.
        </ConfirmDialog>
      )}
    </li>
  );
}

function QuoteRow({
  quote,
  readOnly,
  send,
}: {
  quote: ReportContent['quotes'][number];
  readOnly: boolean;
  send: SendEdit;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  if (quote.removedByPatient)
    return (
      <li className="flex items-baseline justify-between gap-3 text-[1.0625rem] text-muted-foreground">
        <span className="line-through">“{quote.text}”</span>
        <span className="shrink-0 rounded-md border px-2 py-0.5 text-[0.8125rem]">Not shared</span>
      </li>
    );
  return (
    <li>
      <blockquote className="font-serif text-[1.25rem] leading-snug">“{quote.text}”</blockquote>
      {!readOnly && (
        <Button
          variant="outline"
          className="mt-3 h-11 px-4"
          aria-label={`Don't share this: ${quote.text}`}
          onClick={() => setConfirmRemove(true)}
        >
          Don't share this
        </Button>
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Don't share this?"
          confirmLabel="Don't share"
          cancelLabel="Keep it"
          onConfirm={() => {
            setConfirmRemove(false);
            void send({ kind: 'remove', section: 'quotes', itemId: quote.id });
          }}
          onCancel={() => setConfirmRemove(false)}
        >
          “{quote.text}” will not be shared with your clinician.
        </ConfirmDialog>
      )}
    </li>
  );
}

function NoteArea({
  section,
  notes,
  readOnly,
  onSave,
}: {
  section: AnnotatableSection;
  notes: { id: string; text: string }[];
  readOnly: boolean;
  onSave: (text: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const fieldId = useId();
  return (
    <div className="mt-4 space-y-2">
      {notes.map((n) => (
        <p key={n.id} className="rounded-lg bg-surface-strong px-3 py-2 text-base">
          <span className="font-medium">Your note:</span> {n.text}
        </p>
      ))}
      {!readOnly &&
        (open ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onSave(text.trim()).then((ok) => {
                if (ok) {
                  setText('');
                  setOpen(false);
                }
              });
            }}
          >
            <label htmlFor={fieldId} className="block text-base font-medium">
              Your note
            </label>
            <Textarea
              id={fieldId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              className="min-h-20 text-[1.0625rem]"
            />
            <div className="flex gap-2">
              <Button type="submit" className="h-11 px-4" disabled={!text.trim()}>
                Save note
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 px-4"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="ghost"
            className="-ml-3 h-11 px-3 text-primary"
            data-section={section}
            aria-label={`Add a note to ${sectionName(section)}`}
            onClick={() => setOpen(true)}
          >
            Add a note
          </Button>
        ))}
    </div>
  );
}

function sectionName(s: AnnotatableSection): string {
  if (s === 'risk') return 'your safety section';
  if (s === 'screening') return 'your check-in answers';
  if (s === 'priorities') return 'what matters most to you';
  if (s === 'quotes') return 'in your words';
  return SUMMARY_SECTION_LABELS[s].plainLabel;
}
