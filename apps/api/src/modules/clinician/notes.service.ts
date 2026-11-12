import type { ClinicianNoteDto } from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { audit } from '../audit/audit.service';
import { toNoteDto } from './dto';
import { getVisibleReport } from './report.service';

export async function createNote(
  deps: AppDeps,
  clinician: { id: string; displayName: string },
  reportId: string,
  text: string,
): Promise<ClinicianNoteDto> {
  await getVisibleReport(deps, clinician.id, reportId);
  const note = await deps.prisma.clinicianNote.create({
    data: { reportId, clinicianId: clinician.id, text, createdAt: deps.clock.now() },
  });
  await audit(deps, {
    actorId: clinician.id,
    action: 'note.create',
    resourceType: 'report',
    resourceId: reportId,
  });
  return toNoteDto(note, clinician.displayName);
}
