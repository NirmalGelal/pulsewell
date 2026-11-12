# PulseWell

A patient-facing voice/text companion that interviews a patient before a visit, produces an evidence-linked
summary the patient reviews and approves, and gives the clinician a triage queue, transcript-linked report,
"ask the record" assistant, and urgent safety alerts. It screens and summarizes; it never diagnoses.

```bash
npm install
cp .env.example .env          # LLM_MODE=demo runs with no models; set NRP_API_KEY and LLM_MODE=live for real models
npm run db:push && npm run seed && npm run seed:demo
npm run dev                   # api :4000, web :5173
npm run verify                # typecheck + lint + all tests
```

Demo accounts (password `demo1234`): `patient@demo.test`, `patient2@demo.test`, `patient3@demo.test`, `clinician@demo.test`.

New patients: a clinician uses Patients > Add patient (email + name). The app shows a temporary password once; the patient must choose their own password at first login. Clinicians can issue a new temporary password from the patient page (Reset password).

- Demo script and fallbacks: [docs/DEMO.md](docs/DEMO.md)
- Specs, contracts and build log: [specs/](specs/README.md)
