import { sql, type SQL } from "drizzle-orm";

export type ExecuteSql = (query: SQL) => PromiseLike<unknown>;

type PosActorAuditInput = {
  enotaId: number;
  natakarId: number | null;
  actorClerkUserId: string | null;
  action: string;
  metadata?: Record<string, unknown>;
};

export async function writePosActorAudit(
  execute: ExecuteSql,
  input: PosActorAuditInput,
): Promise<void> {
  await execute(sql`
    INSERT INTO pos_actor_audit (
      enota_id,
      natakar_id,
      actor_user_id,
      actor_clerk_user_id,
      action,
      metadata
    ) VALUES (
      ${input.enotaId},
      ${input.natakarId},
      NULL,
      ${input.actorClerkUserId},
      ${input.action},
      ${JSON.stringify(input.metadata ?? {})}::jsonb
    )
  `);
}