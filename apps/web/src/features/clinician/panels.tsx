import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AskResponseSchema,
  ClinicianNoteDtoSchema,
  FollowUpDtoSchema,
  type AskResponse,
  type ClinicianNoteDto,
  type TranscriptTurnDto,
} from '@pvc/shared';
import { ModalShell } from '@/components/ModalShell';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { clinicianKeys, EvidenceChip, formatDateTime, QueueResponseSchema } from './common';

/* ---------------------------------------------------------------- Transcript */

export function TranscriptPanel({
  turns,
  highlight,
}: {
  turns: TranscriptTurnDto[];
  highlight: number | null;
}) {
  return (
    <ol className="flex flex-col" aria-label="Transcript">
      {turns.map((t) => {
        const patient = t.sender === 'PATIENT';
        const on = highlight === t.turnId;
        return (
          <li
            key={t.turnId}
            id={`turn-${t.turnId}`}
            tabIndex={-1}
            data-highlighted={on ? 'true' : undefined}
            className={cn(
              'rounded-md px-2.5 py-2 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring',
              t.hasSafetyEvent && 'bg-danger-soft',
              on && 'bg-mark text-mark-foreground',
            )}
          >
            <div className="mb-0.5 flex items-center gap-2 text-xs">
              <span className="font-semibold tabular-nums">T{t.turnId}</span>
              <span className={on ? 'text-mark-foreground' : 'text-muted-foreground'}>
                {patient ? 'Patient' : 'Companion'}
              </span>
              {t.inputMode !== 'TEXT' && (
                <span className="text-muted-foreground">({t.inputMode.toLowerCase()})</span>
              )}
              {t.hasSafetyEvent && (
                <span className="inline-flex items-center gap-1 font-semibold text-danger">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  Safety flag
                </span>
              )}
            </div>
            {t.redacted || t.text === null ? (
              <p className="italic text-muted-foreground">[Patient chose not to share this part]</p>
            ) : (
              <p
                className={cn(
                  'whitespace-pre-wrap leading-relaxed',
                  patient ? 'font-medium' : on ? '' : 'text-muted-foreground',
                )}
              >
                {t.text}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ----------------------------------------------------------------------- Ask */

interface QA {
  question: string;
  answer?: AskResponse;
  error?: string;
}

/** Maps S<n> labels (1-based, oldest approved report first) to sessions using the queue. */
function useSessionRefs(patientId: string) {
  const q = useQuery({
    queryKey: clinicianKeys.queue,
    queryFn: () => api.get('/api/clinician/queue', QueueResponseSchema),
  });
  const mine = (q.data?.items ?? [])
    .filter((i) => i.patient.id === patientId)
    .sort((a, b) => a.approvedAt.localeCompare(b.approvedAt))
    .slice(-10);
  return mine;
}

function AnswerText({
  text,
  patientId,
  currentSessionId,
  onJump,
}: {
  text: string;
  patientId: string;
  currentSessionId?: string;
  onJump?: (turnId: number) => void;
}) {
  const sessions = useSessionRefs(patientId);
  const parts: ReactNode[] = [];
  const re = /\[S(\d+):T(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const n = Number(m[1]);
    const turn = Number(m[2]);
    const target = sessions[n - 1];
    const label = `S${n}:T${turn}`;
    if (target && target.sessionId === currentSessionId) {
      parts.push(<EvidenceChip key={m.index} turnId={turn} onJump={onJump} />);
    } else if (target) {
      parts.push(
        <Link
          key={m.index}
          to={`/clinician/reports/${target.reportId}`}
          className="inline-flex h-5 items-center rounded-sm px-1 text-xs font-medium tabular-nums text-primary underline underline-offset-2 hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open earlier report, turn ${turn}`}
        >
          {label}
        </Link>,
      );
    } else {
      parts.push(
        <span key={m.index} className="px-1 text-xs tabular-nums text-muted-foreground">
          {label}
        </span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <p className="max-w-[65ch] whitespace-pre-wrap text-[0.9375rem] leading-relaxed">{parts}</p>
  );
}

export function AskPanel({
  patientId,
  currentSessionId,
  onJump,
}: {
  patientId: string;
  currentSessionId?: string;
  onJump?: (turnId: number) => void;
}) {
  const [question, setQuestion] = useState('');
  const [log, setLog] = useState<QA[]>([]);
  const ask = useMutation({
    mutationFn: (q: string) =>
      api.post<AskResponse>(
        `/api/clinician/patients/${patientId}/ask`,
        { question: q },
        AskResponseSchema,
      ),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 3 || ask.isPending) return;
    setQuestion('');
    ask.mutate(q, {
      onSuccess: (answer) => setLog((l) => [{ question: q, answer }, ...l]),
      onError: (err) =>
        setLog((l) => [
          {
            question: q,
            error:
              err instanceof ApiError && err.status === 503
                ? 'The assistant is unavailable right now. Please try again in a moment.'
                : "Couldn't get an answer. Please try again.",
          },
          ...l,
        ]),
    });
  };
  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="ask-q" className="text-sm font-medium">
          Ask about this patient&apos;s record
        </label>
        <Textarea
          id="ask-q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. How has sleep changed?"
          rows={2}
          maxLength={1000}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Answers come only from approved records.</p>
          <Button type="submit" size="sm" disabled={ask.isPending || question.trim().length < 3}>
            {ask.isPending ? 'Asking…' : 'Ask'}
          </Button>
        </div>
      </form>
      <ul className="flex flex-col gap-3" aria-live="polite">
        {log.map((qa, i) => (
          <li key={log.length - i} className="border-t pt-3 text-sm first:border-t-0 first:pt-0">
            <p className="mb-1.5 font-serif text-base font-medium">{qa.question}</p>
            {qa.error ? (
              <p role="alert" className="text-danger">
                {qa.error}
              </p>
            ) : (
              qa.answer && (
                <>
                  <AnswerText
                    text={qa.answer.answer}
                    patientId={patientId}
                    currentSessionId={currentSessionId}
                    onJump={onJump}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    AI answer ({qa.answer.model}). References link to the transcript. Verify before
                    relying on it.
                  </p>
                </>
              )
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------------- Notes */

export function NotesPanel({
  reportId,
  notes,
  onAdded,
}: {
  reportId: string;
  notes: ClinicianNoteDto[];
  onAdded: (n: ClinicianNoteDto) => void;
}) {
  const [text, setText] = useState('');
  const create = useMutation({
    mutationFn: (t: string) =>
      api.post<ClinicianNoteDto>(
        `/api/clinician/reports/${reportId}/notes`,
        { text: t },
        ClinicianNoteDtoSchema,
      ),
    onSuccess: (n) => {
      setText('');
      onAdded(n);
    },
    onError: () => toast.error("Couldn't save the note. Please try again."),
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground">
        Private. Not visible to the patient.
      </p>
      <ul className="flex flex-col gap-2">
        {notes.length === 0 && <li className="text-sm text-muted-foreground">No notes yet.</li>}
        {notes.map((n) => (
          <li key={n.id} className="border-t pt-2.5 text-sm first:border-t-0 first:pt-0">
            <p className="whitespace-pre-wrap">{n.text}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {n.clinicianName} · {formatDateTime(n.createdAt)}
            </p>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) create.mutate(text.trim());
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="note-text" className="text-sm font-medium">
          Add a note
        </label>
        <Textarea
          id="note-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={4000}
        />
        <Button
          type="submit"
          size="sm"
          className="self-end"
          disabled={create.isPending || !text.trim()}
        >
          Save note
        </Button>
      </form>
    </div>
  );
}

/* ----------------------------------------------------------------- Follow-up */

export function FollowUpDialog({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [questions, setQuestions] = useState<string[]>(['']);
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: (qs: string[]) =>
      api.post(
        `/api/clinician/patients/${patientId}/follow-ups`,
        { questions: qs },
        FollowUpDtoSchema,
      ),
    onSuccess: () => {
      toast.success("Sent. The companion will ask these at the patient's next check-in.");
      void qc.invalidateQueries({ queryKey: clinicianKeys.patients });
      onClose();
    },
    onError: () => setError("Couldn't send the questions. Please try again."),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const qs = questions.map((q) => q.trim());
    if (qs.some((q) => q.length === 0)) return setError('Fill in or remove the empty question.');
    if (qs.some((q) => q.length < 3 || q.length > 300))
      return setError('Each question must be 3 to 300 characters.');
    setError(null);
    send.mutate(qs);
  };
  return (
    <ModalShell labelledBy="fu-title" onEscape={onClose} className="max-w-lg">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h2 id="fu-title" className="text-xl">
          Send follow-up questions
        </h2>
        <p className="text-sm text-muted-foreground">
          Up to 3 questions. The companion asks them at the patient&apos;s next check-in.
        </p>
        {questions.map((q, i) => (
          <div key={i} className="flex flex-col gap-1">
            <label htmlFor={`fu-${i}`} className="text-sm font-medium">
              Question {i + 1}
            </label>
            <div className="flex gap-2">
              <input
                id={`fu-${i}`}
                data-autofocus={i === 0 ? true : undefined}
                value={q}
                maxLength={300}
                onChange={(e) =>
                  setQuestions((qs) => qs.map((x, j) => (j === i ? e.target.value : x)))
                }
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {questions.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                  aria-label={`Remove question ${i + 1}`}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        ))}
        {questions.length < 3 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setQuestions((qs) => [...qs, ''])}
          >
            Add another question
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={send.isPending}>
            Send questions
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
