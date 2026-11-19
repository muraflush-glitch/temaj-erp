import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module';
import { Db, Tx, withTransaction } from '../database/db';

export interface OutboxEvent { id: number; topic: string; payload: Record<string, unknown>; attempts: number }
export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

const LOCK_SECONDS = 60;

/**
 * Transactional outbox. Ngjarja shkruhet në të njëjtin transaksion me veprimin e biznesit
 * (enqueue merr `tx`), kështu që asnjë njoftim nuk humbet dhe asnjë nuk dërgohet për veprim të anuluar.
 * Thirrjet e jashtme bëhen JASHTË transaksionit të databazës.
 */
@Injectable()
export class OutboxService {
  private readonly handlers = new Map<string, OutboxHandler>();

  constructor(@Inject(DB) private readonly db: Db) {}

  on(topic: string, handler: OutboxHandler): void {
    if (this.handlers.has(topic)) throw new Error(`Handler-i për ${topic} ekziston`);
    this.handlers.set(topic, handler);
  }

  async enqueue(tx: Tx | Db, topic: string, payload: Record<string, unknown>, idempotencyKey: string): Promise<void> {
    await tx.query(
      `INSERT INTO outbox_event(topic, payload, idempotency_key) VALUES ($1, $2, $3) ON CONFLICT (idempotency_key) DO NOTHING`,
      [topic, JSON.stringify(payload), idempotencyKey]);
  }

  /**
   * `now` përdoret vetëm në teste; në punë normale përdoret ora e databazës (mikrosekonda),
   * jo ora e Node-it (milisekonda), që ngjarjet e sapokrijuara të mos duken "në të ardhmen".
   */
  /** Merr një grup ngjarjesh gati, i përpunon dhe kthen sa u përpunuan. I sigurt me disa punëtorë paralelë. */
  async processBatch(limit = 20, now?: Date): Promise<{ done: number; retried: number; dead: number }> {
    // 1) Rezervim i shkurtër: SKIP LOCKED që dy punëtorë të mos marrin të njëjtën ngjarje.
    const claimed = await withTransaction(this.db, async (tx) => {
      const res = await tx.query<{ id: string; topic: string; payload: Record<string, unknown>; attempts: number }>(
        `UPDATE outbox_event SET status = 'PROCESSING', attempts = attempts + 1, locked_until = COALESCE($2::timestamptz, now()) + make_interval(secs => $3)
          WHERE id IN (
            SELECT id FROM outbox_event
             WHERE (status = 'PENDING' AND next_attempt_at <= COALESCE($2::timestamptz, now()))
                OR (status = 'PROCESSING' AND locked_until < COALESCE($2::timestamptz, now()))
             ORDER BY next_attempt_at, id LIMIT $1 FOR UPDATE SKIP LOCKED)
          RETURNING id, topic, payload, attempts`,
        [limit, now?.toISOString() ?? null, LOCK_SECONDS]);
      return res.rows;
    });

    const stats = { done: 0, retried: 0, dead: 0 };
    // 2) Përpunimi jashtë transaksionit; 3) rezultati regjistrohet në një transaksion të ri.
    for (const row of claimed) {
      const handler = this.handlers.get(row.topic);
      try {
        if (!handler) throw new Error(`Nuk ka handler për temën ${row.topic}`);
        await handler({ id: Number(row.id), topic: row.topic, payload: row.payload, attempts: row.attempts });
        await this.db.query(`UPDATE outbox_event SET status = 'DONE', completed_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1`, [row.id]);
        stats.done++;
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
        // Backoff eksponencial: 30s, 60s, 120s ... deri në 1 orë.
        const delaySec = Math.min(3600, 30 * 2 ** (row.attempts - 1));
        const res = await this.db.query<{ status: string }>(
          `UPDATE outbox_event
              SET status = CASE WHEN attempts >= max_attempts THEN 'DEAD'::outbox_status ELSE 'PENDING'::outbox_status END,
                  next_attempt_at = COALESCE($2::timestamptz, now()) + make_interval(secs => $3), locked_until = NULL, last_error = $4
            WHERE id = $1 RETURNING status`,
          [row.id, now?.toISOString() ?? null, delaySec, msg]);
        if (res.rows[0]?.status === 'DEAD') stats.dead++; else stats.retried++;
      }
    }
    return stats;
  }

  /** Ngjarjet e vdekura kërkojnë ndërhyrje njerëzore; nuk fshihen kurrë automatikisht. */
  async deadLetters(): Promise<unknown[]> {
    const res = await this.db.query(`SELECT id, topic, attempts, last_error, created_at FROM outbox_event WHERE status = 'DEAD' ORDER BY id`);
    return res.rows;
  }

  async requeueDead(id: number): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE outbox_event SET status = 'PENDING', attempts = 0, next_attempt_at = now(), last_error = NULL WHERE id = $1 AND status = 'DEAD'`, [id]);
    return (res.rowCount ?? 0) > 0;
  }
}
