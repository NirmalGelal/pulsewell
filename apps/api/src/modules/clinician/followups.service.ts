import type { FollowUpDto } from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { toJson } from '../../lib/json';
import { audit } from '../audit/audit.service';
import { assertLinked } from '../auth/access';

export async function createFollowUp(
  deps: AppDeps,
  clinician: { id: string; displayName: string },
  patientId: string,
  questions: string[],
): Promise<FollowUpDto> {
  await assertLinked(deps.prisma, clinician.id, patientId);
  const row = await deps.prisma.followUp.create({
    data: {
      patientId,
      clinicianId: clinician.id,
      questions: toJson(questions),
      status: 'PENDING',
      createdAt: deps.clock.now(),
    },
  });
  await audit(deps, {
    actorId: clinician.id,
    action: 'followup.create',
    resourceType: 'followup',
    resourceId: row.id,
    meta: { count: questions.length },
  });
  return {
    id: row.id,
    clinician: { id: clinician.id, displayName: clinician.displayName },
    questions,
    status: 'PENDING',
    createdAt: row.createdAt.toISOString(),
  };
}
