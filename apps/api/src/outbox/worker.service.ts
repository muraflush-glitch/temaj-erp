import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { EscalationService } from '../approvals/escalation.service';
import { DB } from '../database/database.module';
import { Db } from '../database/db';
import { OutboxService } from './outbox.service';

/** Punëtori periodik: aktivizohet vetëm me WORKER_ENABLED=true (një ose më shumë instanca janë të sigurta). */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(@Inject(DB) private readonly db: Db, private readonly outbox: OutboxService, private readonly escalation: EscalationService) {}

  onApplicationBootstrap(): void {
    if (process.env.WORKER_ENABLED !== 'true') return;
    const everyMs = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);
    this.timer = setInterval(() => { void this.tick(); }, everyMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.escalation.escalateOverdue();
      await this.outbox.processBatch();
      await this.db.query(`DELETE FROM login_attempt WHERE attempted_at < now() - interval '30 days'`);
    } catch (e) {
      console.error('Gabim në punëtor', e);
    } finally {
      this.running = false;
    }
  }
}
