import type { AppDeps } from '../../deps';
import { toJson } from '../../lib/json';

export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'session.create'
  | 'session.resume'
  | 'message.create'
  | 'safety.event'
  | 'alert.create'
  | 'alert.ack'
  | 'report.generate'
  | 'report.edit'
  | 'report.approve'
  | 'report.view'
  | 'report.review'
  | 'note.create'
  | 'assistant.ask'
  | 'followup.create'
  | 'speech.transcribe';

export interface AuditEntry {
  actorId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  meta?: Record<string, string | number | boolean>;
}

const MAX_META_STRING = 200;

/** Appends an audit row. Never throws. Meta strings over 200 chars are dropped (PHI guard). */
export async function audit(
  deps: Pick<AppDeps, 'prisma' | 'logger' | 'clock'>,
  entry: AuditEntry,
): Promise<void> {
  try {
    let meta: Record<string, string | number | boolean> | undefined;
    if (entry.meta) {
      meta = {};
      for (const [k, v] of Object.entries(entry.meta)) {
        if (typeof v === 'string' && v.length > MAX_META_STRING) {
          deps.logger.warn('audit_meta_dropped', { action: entry.action, key: k });
          continue;
        }
        meta[k] = v;
      }
    }
    await deps.prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        meta: meta ? toJson(meta) : null,
        createdAt: deps.clock.now(),
      },
    });
  } catch {
    deps.logger.warn('audit_failed', { action: entry.action });
  }
}
