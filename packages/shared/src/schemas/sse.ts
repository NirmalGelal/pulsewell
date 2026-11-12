import { z } from 'zod';
import { RISK_CATEGORIES } from '../enums';
import { ErrorCodeSchema } from './errors';
import {
  CrisisResourceSchema,
  MessageDtoSchema,
  PendingItemDtoSchema,
  ProgressDtoSchema,
  SessionDtoSchema,
} from './dto';
import { RISK_LEVELS } from '../enums';

export const SSE_EVENT_NAMES = [
  'patient_message',
  'safety',
  'crisis',
  'token',
  'companion_message',
  'done',
  'error',
] as const;
export type SseEventName = (typeof SSE_EVENT_NAMES)[number];

export const MessageStreamEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('patient_message'), data: z.object({ message: MessageDtoSchema }) }),
  z.object({
    event: z.literal('safety'),
    data: z.object({
      level: z.enum(RISK_LEVELS),
      categories: z.array(z.enum(RISK_CATEGORIES)),
      showResources: z.boolean(),
    }),
  }),
  z.object({
    event: z.literal('crisis'),
    data: z.object({
      level: z.literal('imminent'),
      message: z.string(),
      resources: z.array(CrisisResourceSchema),
      session: SessionDtoSchema,
    }),
  }),
  z.object({ event: z.literal('token'), data: z.object({ delta: z.string() }) }),
  z.object({
    event: z.literal('companion_message'),
    data: z.object({ message: MessageDtoSchema }),
  }),
  z.object({
    event: z.literal('done'),
    data: z.object({ progress: ProgressDtoSchema, pendingItem: PendingItemDtoSchema.nullable() }),
  }),
  z.object({
    event: z.literal('error'),
    data: z.object({ code: ErrorCodeSchema, message: z.string() }),
  }),
]);
export type MessageStreamEvent = z.infer<typeof MessageStreamEventSchema>;
