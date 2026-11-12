import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import {
  GAD7_KEYS,
  PHQ9_KEYS,
  ReportContentSchema,
  buildEvidenceItem,
  buildReportContent,
  scoreInstrument,
  type ChecklistItemLike,
  type DeepPartial,
  type DomainKey,
  type EvidenceItem,
  type InstrumentItemKey,
  type ReportContent,
  type RiskFlag,
  type RiskLevel,
  type SummarySection,
} from '@pvc/shared';
import { toJson } from '../src/lib/json';
import { computeRedactedTurns } from '../src/modules/reports/redaction';
import { hashPassword } from '../src/modules/auth/auth.service';
import { runSeed } from './seed';

const PASSWORD = 'demo1234';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

type Turn = [sender: 'COMPANION' | 'PATIENT', text: string];
type Item = { text: string; patientText: string; turnIds: number[] };

interface Scenario {
  patientEmail: string;
  startedAt: Date;
  state: 'CLINICIAN_REVIEWED' | 'SUBMITTED' | 'CRISIS_PAUSED';
  riskLevel: RiskLevel;
  turns: Turn[];
  phq9?: number[];
  gad7?: number[];
  domainNotes?: Partial<
    Record<DomainKey, { status: 'answered' | 'declined'; note: string | null; turn: number }>
  >;
  events?: {
    turnId: number;
    level: RiskLevel;
    evidence: string;
    source: 'keyword' | 'model' | 'instrument';
    category: RiskFlag['category'];
  }[];
  alert?: { evidence: string; createdAt: Date };
  report?: {
    approvedAt: Date;
    reviewed?: boolean;
    priorities: Item[];
    summary: Partial<Record<SummarySection, Item[]>>;
    quotes: { text: string; turnId: number }[];
    notDiscussed: DomainKey[];
    declinedTopics: DomainKey[];
    /** Patient edits applied after the draft was generated. */
    corrections?: { section: SummarySection; index: number; text: string }[];
    removals?: { section: SummarySection; index: number }[];
    annotations?: { section: 'screening' | 'risk' | SummarySection; text: string }[];
  };
}

function scenarios(now: Date): Scenario[] {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  return [
    // ------------------------------------------------------------------ Sam, 3 weeks ago
    {
      patientEmail: 'patient@demo.test',
      startedAt: ago(21 * DAY),
      state: 'CLINICIAN_REVIEWED',
      riskLevel: 'none',
      turns: [
        [
          'COMPANION',
          "Hi Sam, I'm here to listen. What's been going on that made you want to talk to someone?",
        ],
        [
          'PATIENT',
          "I started a new job in September and since then I just haven't felt like myself. I'm exhausted but I can't sleep.",
        ],
        ['COMPANION', 'That sounds hard. How has your sleep been?'],
        [
          'PATIENT',
          "I lie awake until two or three in the morning and then I'm up at six. I'm running on fumes.",
        ],
        ['COMPANION', 'How has your mood been lately?'],
        ['PATIENT', "Pretty low most days. I don't enjoy the things I used to, like cycling."],
        ['COMPANION', 'And how about worry or feeling on edge?'],
        ['PATIENT', "I worry constantly about messing up at work. My mind just won't switch off."],
        ['COMPANION', 'What would you most like help with?'],
        ['PATIENT', 'Honestly, sleep. If I could sleep I think everything else would get easier.'],
      ],
      phq9: [2, 2, 3, 3, 2, 2, 1, 1, 0],
      gad7: [2, 2, 2, 2, 1, 2, 1],
      domainNotes: {
        chief_concern: {
          status: 'answered',
          note: 'Low mood and exhaustion since starting a new job.',
          turn: 2,
        },
        sleep_appetite_energy: {
          status: 'answered',
          note: 'Awake until 2-3 am, up at 6.',
          turn: 4,
        },
        mood_anxiety: {
          status: 'answered',
          note: 'Low mood most days; constant work worry.',
          turn: 8,
        },
        priorities: { status: 'answered', note: 'Wants help with sleep.', turn: 10 },
      },
      report: {
        approvedAt: ago(21 * DAY - 40 * MIN),
        reviewed: true,
        priorities: [
          {
            text: 'Wants help sleeping.',
            patientText: 'You want help with your sleep.',
            turnIds: [10],
          },
        ],
        summary: {
          chiefConcern: [
            {
              text: 'Reports feeling unlike himself since starting a new job in September.',
              patientText:
                "You said you haven't felt like yourself since starting a new job in September.",
              turnIds: [2],
            },
          ],
          moodAnxiety: [
            {
              text: 'Reports low mood most days and reduced enjoyment of activities such as cycling.',
              patientText:
                'You said your mood has been low most days and you enjoy things like cycling less.',
              turnIds: [6],
            },
            {
              text: 'Reports constant worry about work performance.',
              patientText: 'You said you worry constantly about messing up at work.',
              turnIds: [8],
            },
          ],
          sleepAppetiteEnergy: [
            {
              text: 'Reports difficulty sleeping, awake until 2-3 am and waking at 6 am; exhausted.',
              patientText:
                'You said you lie awake until two or three and wake at six, and feel exhausted.',
              turnIds: [2, 4],
            },
          ],
        },
        quotes: [
          { text: "I'm running on fumes.", turnId: 4 },
          { text: 'If I could sleep I think everything else would get easier.', turnId: 10 },
        ],
        notDiscussed: ['substance_use', 'history', 'supports', 'goals'],
        declinedTopics: [],
      },
    },
    // ------------------------------------------------------------------ Sam, today
    {
      patientEmail: 'patient@demo.test',
      startedAt: ago(2 * 60 * MIN),
      state: 'SUBMITTED',
      riskLevel: 'none',
      turns: [
        ['COMPANION', 'Welcome back, Sam. How have things been since we last talked?'],
        ['PATIENT', 'A bit better. The new job is settling down but sleep is still rough.'],
        ['COMPANION', 'Tell me more about your sleep.'],
        [
          'PATIENT',
          "I'm getting maybe five hours now, up from three or four. I still wake up at four and can't get back to sleep.",
        ],
        ['COMPANION', 'How has your mood been?'],
        [
          'PATIENT',
          'Better than a month ago. I went cycling last weekend for the first time in ages.',
        ],
        ['COMPANION', 'Any worry or feeling on edge?'],
        ['PATIENT', 'Still some worry about work, mostly on Sunday nights.'],
        ['COMPANION', 'Is there anything in your life that is making things harder right now?'],
        ['PATIENT', "My brother and I had a falling out and I'd rather not get into it here."],
        ['COMPANION', "That's completely okay. What would you most like help with?"],
        ['PATIENT', "Still sleep. I'd like to get back to sleeping through the night."],
      ],
      phq9: [2, 1, 3, 2, 1, 1, 1, 1, 0],
      gad7: [1, 2, 1, 1, 1, 1, 2],
      domainNotes: {
        chief_concern: {
          status: 'answered',
          note: 'Sleep still disrupted; job settling.',
          turn: 2,
        },
        sleep_appetite_energy: {
          status: 'answered',
          note: 'About five hours; early waking.',
          turn: 4,
        },
        mood_anxiety: { status: 'answered', note: 'Mood improving; Sunday-night worry.', turn: 8 },
        supports: {
          status: 'answered',
          note: 'Family conflict (patient prefers not to share).',
          turn: 10,
        },
        priorities: { status: 'answered', note: 'Sleeping through the night.', turn: 12 },
      },
      report: {
        approvedAt: ago(75 * MIN),
        priorities: [
          {
            text: 'Wants help returning to sleeping through the night.',
            patientText: 'You want to get back to sleeping through the night.',
            turnIds: [12],
          },
        ],
        summary: {
          presentConcern: [
            {
              text: 'Reports sleep remains disrupted while work stress is easing.',
              patientText: 'You said work is settling down but sleep is still rough.',
              turnIds: [2],
            },
          ],
          moodAnxiety: [
            {
              text: 'Reports mood has improved compared with a month ago and that he resumed cycling.',
              patientText:
                'You said your mood is better than a month ago and you went cycling last weekend.',
              turnIds: [6],
            },
            {
              text: 'Reports some residual worry about work, mostly on Sunday nights.',
              patientText: 'You said you still worry about work, mostly on Sunday nights.',
              turnIds: [8],
            },
          ],
          sleepAppetiteEnergy: [
            {
              text: 'Reports about five hours of sleep (previously three to four) with early-morning waking at 4 am.',
              patientText: 'You said you now get about five hours and still wake at four.',
              turnIds: [4],
            },
          ],
          supports: [
            {
              text: 'Reports a recent falling-out with his brother.',
              patientText: 'You mentioned a falling out with your brother.',
              turnIds: [10],
            },
          ],
        },
        quotes: [
          { text: 'I went cycling last weekend for the first time in ages.', turnId: 6 },
          { text: "I'd like to get back to sleeping through the night.", turnId: 12 },
        ],
        notDiscussed: ['substance_use', 'history', 'goals'],
        declinedTopics: [],
        corrections: [
          { section: 'moodAnxiety', index: 0, text: 'My mood is better, but only on some days.' },
        ],
        removals: [{ section: 'supports', index: 0 }],
        annotations: [
          {
            section: 'screening',
            text: 'The sleep answer was a bit better than it looks, I had two good nights this week.',
          },
        ],
      },
    },
    // ------------------------------------------------------------------ Alex, today
    {
      patientEmail: 'patient2@demo.test',
      startedAt: ago(90 * MIN),
      state: 'SUBMITTED',
      riskLevel: 'elevated',
      turns: [
        [
          'COMPANION',
          "Hi Alex, I'm here to listen. What's been going on that made you want to talk to someone?",
        ],
        [
          'PATIENT',
          "I've been really low for months. Most days I just get through work and go home to an empty apartment.",
        ],
        ['COMPANION', 'That sounds really heavy. How has your mood been day to day?'],
        [
          'PATIENT',
          "Down nearly every day. I don't enjoy anything anymore and I feel like a burden.",
        ],
        ['COMPANION', 'How has your sleep been?'],
        [
          'PATIENT',
          "I wake at 3am most nights and can't fall back asleep. My mind races about everything.",
        ],
        [
          'COMPANION',
          'Sometimes people who feel this way have thoughts of death or of not wanting to be here. Has that been true for you?',
        ],
        [
          'PATIENT',
          "Sometimes I think everyone would be better off if I just wasn't here. I don't have a plan, it's just a thought that comes up.",
        ],
        ['COMPANION', 'Thank you for telling me. Are you safe right now?'],
        ['PATIENT', "Yes, I'm safe right now. I just wanted to say it out loud."],
        ['COMPANION', 'Who do you have to lean on?'],
        ['PATIENT', 'Nobody really. I live alone and my family is far away.'],
        ['COMPANION', 'What would you most like help with?'],
        [
          'PATIENT',
          "I'd like someone to talk to every week. I'm tired of dealing with this alone.",
        ],
      ],
      phq9: [2, 3, 3, 2, 2, 2, 2, 1, 1],
      gad7: [3, 2, 2, 2, 2, 2, 2],
      domainNotes: {
        chief_concern: { status: 'answered', note: 'Months of low mood; isolated.', turn: 2 },
        sleep_appetite_energy: { status: 'answered', note: 'Early waking at 3 am.', turn: 6 },
        substance_use: { status: 'declined', note: null, turn: 6 },
        safety: {
          status: 'answered',
          note: 'Passive thoughts of death, no plan; reports being safe now.',
          turn: 8,
        },
        supports: { status: 'answered', note: 'Lives alone; family far away.', turn: 12 },
        priorities: {
          status: 'answered',
          note: 'Weekly check-ins with someone to talk to.',
          turn: 14,
        },
      },
      events: [
        {
          turnId: 8,
          level: 'elevated',
          evidence: "everyone would be better off if I just wasn't here",
          source: 'model',
          category: 'suicidal_ideation',
        },
      ],
      report: {
        approvedAt: ago(30 * MIN),
        priorities: [
          {
            text: 'Wants someone to talk to on a weekly basis.',
            patientText: 'You want someone to talk to every week.',
            turnIds: [14],
          },
        ],
        summary: {
          chiefConcern: [
            {
              text: 'Reports months of low mood, getting through work and returning to an empty apartment.',
              patientText:
                'You said you have felt low for months and mostly just get through work.',
              turnIds: [2],
            },
          ],
          moodAnxiety: [
            {
              text: 'Reports low mood nearly every day, loss of enjoyment and feeling like a burden.',
              patientText:
                'You said you feel down nearly every day, enjoy nothing and feel like a burden.',
              turnIds: [4],
            },
          ],
          sleepAppetiteEnergy: [
            {
              text: 'Reports waking at 3 am most nights and being unable to return to sleep, with racing thoughts.',
              patientText: 'You said you wake at 3 am most nights and your mind races.',
              turnIds: [6],
            },
          ],
          supports: [
            {
              text: 'Lives alone; reports family are far away and little current support.',
              patientText: 'You said you live alone and your family is far away.',
              turnIds: [12],
            },
          ],
        },
        quotes: [
          { text: "I'd like someone to talk to every week.", turnId: 14 },
          { text: 'I live alone and my family is far away.', turnId: 12 },
        ],
        notDiscussed: ['history', 'goals', 'functioning'],
        declinedTopics: ['substance_use'],
      },
    },
    // ------------------------------------------------------------------ Riley, crisis
    {
      patientEmail: 'patient3@demo.test',
      startedAt: ago(12 * MIN),
      state: 'CRISIS_PAUSED',
      riskLevel: 'imminent',
      turns: [
        [
          'COMPANION',
          "Hi Riley, I'm here to listen. What's been going on that made you want to talk to someone?",
        ],
        ['PATIENT', "I can't keep doing this. Everything has fallen apart this week."],
        [
          'COMPANION',
          "I'm really sorry it's been so hard. Can you tell me more about what's happened?",
        ],
        ['PATIENT', "I'm going to end it tonight."],
      ],
      events: [
        {
          turnId: 4,
          level: 'imminent',
          evidence: "I'm going to end it tonight",
          source: 'keyword',
          category: 'suicidal_ideation',
        },
      ],
      alert: { evidence: "I'm going to end it tonight", createdAt: ago(10 * MIN) },
    },
  ];
}

const clean = (s: Item): EvidenceItem => buildEvidenceItem({ id: '', ...s });

function buildContent(
  sc: Scenario,
  sessionId: string,
  patientName: string,
  endedAt: Date,
  phq: ReturnType<typeof scoreInstrument>,
  gad: ReturnType<typeof scoreInstrument>,
): { draft: ReportContent; current: ReportContent } {
  const r = sc.report!;
  const summary: Record<string, EvidenceItem[]> = {};
  for (const [section, items] of Object.entries(r.summary)) {
    summary[section] = items.map((it, i) => ({ ...clean(it), id: `${section}-${i + 1}` }));
  }
  const flags: RiskFlag[] = (sc.events ?? []).map((e) => ({
    category: e.category,
    level: e.level,
    evidence: e.evidence,
    turnId: e.turnId,
    source: e.source,
  }));
  const over: DeepPartial<ReportContent> = {
    patient: { displayName: patientName },
    session: {
      id: sessionId,
      startedAt: sc.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMinutes: Math.max(1, Math.round((endedAt.getTime() - sc.startedAt.getTime()) / MIN)),
    },
    risk: { level: sc.riskLevel, flags },
    priorities: r.priorities.map((p, i) => ({ ...clean(p), id: `priorities-${i + 1}` })),
    screening: { phq9: phq, gad7: gad },
    summary: summary as ReportContent['summary'],
    quotes: r.quotes.map((q, i) => ({ id: `quotes-${i + 1}`, ...q })),
    notDiscussed: r.notDiscussed,
    declinedTopics: r.declinedTopics,
    provenance: {
      writerModel: 'demo-seed',
      verifierModel: 'demo-seed',
      generatedAt: endedAt.toISOString(),
      verification: {
        claimsChecked: Object.values(summary).flat().length,
        claimsRemoved: 0,
        quotesRemoved: 0,
        regenerated: false,
      },
    },
  };
  const draft = ReportContentSchema.parse(buildReportContent(over));
  const current: ReportContent = structuredClone(draft);
  for (const c of r.corrections ?? [])
    current.summary[c.section][c.index]!.patientCorrection = c.text;
  for (const c of r.removals ?? []) current.summary[c.section][c.index]!.removedByPatient = true;
  current.patientAnnotations = (r.annotations ?? []).map((a, i) => ({
    id: `annotation-${i + 1}`,
    section: a.section,
    text: a.text,
    createdAt: endedAt.toISOString(),
  }));
  return { draft, current: ReportContentSchema.parse(current) };
}

export interface DemoSeedSummary {
  patients: number;
  sessions: number;
  reports: number;
  alerts: number;
}

/** Idempotent: wipes the three demo patients' sessions, then recreates the demo scenarios. */
export async function runSeedDemo(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<DemoSeedSummary> {
  await runSeed(prisma);
  const clinician = await prisma.user.findUniqueOrThrow({
    where: { email: 'clinician@demo.test' },
  });
  const riley = await prisma.user.upsert({
    where: { email: 'patient3@demo.test' },
    update: {
      displayName: 'Riley K.',
      role: 'PATIENT',
      passwordHash: await hashPassword(PASSWORD),
    },
    create: {
      email: 'patient3@demo.test',
      role: 'PATIENT',
      displayName: 'Riley K.',
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  await prisma.careLink.upsert({
    where: { patientId_clinicianId: { patientId: riley.id, clinicianId: clinician.id } },
    update: { active: true },
    create: { patientId: riley.id, clinicianId: clinician.id },
  });

  const emails = ['patient@demo.test', 'patient2@demo.test', 'patient3@demo.test'];
  const patients = await prisma.user.findMany({ where: { email: { in: emails } } });
  const byEmail = new Map(patients.map((p) => [p.email, p]));
  const ids = patients.map((p) => p.id);
  await prisma.session.deleteMany({ where: { patientId: { in: ids } } }); // cascades
  await prisma.followUp.deleteMany({ where: { patientId: { in: ids } } });

  const summary: DemoSeedSummary = { patients: 3, sessions: 0, reports: 0, alerts: 0 };
  for (const sc of scenarios(now)) {
    const patient = byEmail.get(sc.patientEmail)!;
    const msgAt = (i: number) => new Date(sc.startedAt.getTime() + (i + 1) * MIN);
    const endedAt = sc.report
      ? new Date(sc.startedAt.getTime() + (sc.turns.length + 2) * MIN)
      : null;

    const session = await prisma.session.create({
      data: {
        patientId: patient.id,
        state: sc.state,
        consentVersion: 'v1',
        consentedAt: sc.startedAt,
        cacheSalt: 'ZGVtby1zZWVkLW5vdC1hLXJlYWwtc2FsdC0xMjM0NTY3OA==',
        nextTurnId: sc.turns.length + 1,
        riskLevel: sc.riskLevel,
        startedAt: sc.startedAt,
        endedAt,
      },
    });
    summary.sessions++;

    const checklist: ChecklistItemLike[] = [];
    const rows: {
      key: string;
      status: string;
      value: number | null;
      confidence: number;
      note: string | null;
      turnIds: string;
      source: string;
    }[] = [];
    const addInstrument = (keys: readonly InstrumentItemKey[], values: number[] | undefined) => {
      keys.forEach((key, i) => {
        const value = values?.[i];
        if (value === undefined) return;
        const turn = Math.min(sc.turns.length, 2 * (i + 1));
        checklist.push({
          key,
          status: 'answered',
          value,
          confidence: 1,
          source: 'patient_tap',
          turnIds: [turn],
        });
        rows.push({
          key,
          status: 'answered',
          value,
          confidence: 1,
          note: null,
          turnIds: toJson([turn]),
          source: 'patient_tap',
        });
      });
    };
    addInstrument(PHQ9_KEYS, sc.phq9);
    addInstrument(GAD7_KEYS, sc.gad7);
    for (const [key, d] of Object.entries(sc.domainNotes ?? {})) {
      rows.push({
        key,
        status: d.status,
        value: null,
        confidence: 0.9,
        note: d.note,
        turnIds: toJson([d.turn]),
        source: 'tracker',
      });
    }

    const phq = scoreInstrument(
      'phq9',
      checklist.filter((c) => c.key.startsWith('phq9')),
    );
    const gad = scoreInstrument(
      'gad7',
      checklist.filter((c) => c.key.startsWith('gad7')),
    );

    let content: { draft: ReportContent; current: ReportContent } | null = null;
    if (sc.report && endedAt) {
      content = buildContent(sc, session.id, patient.displayName, endedAt, phq, gad);
    }
    const redacted = content
      ? new Set(
          computeRedactedTurns(
            content.current,
            sc.turns.map(([sender], i) => ({ turnId: i + 1, sender })),
            (sc.events ?? []).map((e) => e.turnId),
          ),
        )
      : new Set<number>();

    for (const [i, [sender, text]] of sc.turns.entries()) {
      await prisma.message.create({
        data: {
          sessionId: session.id,
          turnId: i + 1,
          sender,
          text,
          inputMode: 'TEXT',
          redacted: redacted.has(i + 1),
          createdAt: msgAt(i),
        },
      });
    }
    for (const row of rows)
      await prisma.checklistItem.create({ data: { sessionId: session.id, ...row } });

    for (const e of sc.events ?? []) {
      const ev = await prisma.safetyEvent.create({
        data: {
          sessionId: session.id,
          turnId: e.turnId,
          level: e.level,
          categories: toJson([e.category]),
          evidence: e.evidence,
          source: e.source,
          createdAt: msgAt(e.turnId - 1),
        },
      });
      if (sc.alert) {
        await prisma.alert.create({
          data: {
            sessionId: session.id,
            patientId: patient.id,
            safetyEventId: ev.id,
            level: 'imminent',
            evidence: sc.alert.evidence,
            createdAt: sc.alert.createdAt,
          },
        });
        summary.alerts++;
      }
    }

    if (content && sc.report) {
      const r = sc.report;
      const report = await prisma.report.create({
        data: {
          sessionId: session.id,
          status: 'APPROVED',
          draftJson: toJson(content.draft),
          currentJson: toJson(content.current),
          approvedAt: r.approvedAt,
          reviewedAt: r.reviewed ? new Date(r.approvedAt.getTime() + 2 * DAY) : null,
          reviewedById: r.reviewed ? clinician.id : null,
        },
      });
      summary.reports++;
      for (const c of r.corrections ?? []) {
        const it = content.draft.summary[c.section][c.index]!;
        await prisma.reportEdit.create({
          data: {
            reportId: report.id,
            kind: 'correct',
            section: c.section,
            itemId: it.id,
            originalText: it.patientText,
            newText: c.text,
          },
        });
      }
      for (const c of r.removals ?? []) {
        const it = content.draft.summary[c.section][c.index]!;
        await prisma.reportEdit.create({
          data: {
            reportId: report.id,
            kind: 'remove',
            section: c.section,
            itemId: it.id,
            originalText: it.patientText,
          },
        });
      }
      for (const a of r.annotations ?? []) {
        await prisma.reportEdit.create({
          data: { reportId: report.id, kind: 'annotate', section: a.section, newText: a.text },
        });
      }
    }
  }
  return summary;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const s = await runSeedDemo(prisma);
    console.log('Demo data created:');
    console.table([s]);
    console.log(
      [
        'Sam R.   - 2 approved reports (PHQ-9 16 -> 12, GAD-7 12 -> 9); correction + removed item in the latest',
        'Alex M.  - elevated risk (passive thoughts of death), PHQ-9 18, GAD-7 15; top of the queue',
        'Riley K. - session paused in crisis with an OPEN imminent alert (banner on every clinician page)',
        'Login: clinician@demo.test / demo1234 (patients: patient@, patient2@, patient3@demo.test)',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
