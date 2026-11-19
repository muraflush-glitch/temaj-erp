import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DB } from '../database/database.module';
import { Db } from '../database/db';
import { OutboxService } from './outbox.service';

export const NOTIFICATION_TOPIC = 'notification.send';

/**
 * SIMULIM — vetëm Development/Staging.
 * Shkruan njoftimet në tabelën `dev_notification_sink` në vend që t'i dërgojë.
 * Ofruesi real i email/SMS/WhatsApp pret OPEN-18 dhe OPEN-19; në Production ky modul refuzon të ngarkohet,
 * kështu që njoftimet mbeten në outbox dhe dalin si dead-letter, jo si "të dërguara" në mënyrë të rreme.
 */
@Injectable()
export class DevNotificationSink implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Db, private readonly outbox: OutboxService) {}

  onModuleInit(): void {
    if (process.env.APP_ENV === 'production') return;
    this.outbox.on(NOTIFICATION_TOPIC, async (e) => {
      const p = e.payload as { channel?: string; recipient?: string; subject?: string; body?: string };
      if (!p.recipient || !p.subject) throw new Error('Njoftim pa marrës ose subjekt');
      await this.db.query(
        `INSERT INTO dev_notification_sink(channel, recipient, subject, body, event_id) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event_id) DO NOTHING`,
        [p.channel ?? 'email', p.recipient, p.subject, p.body ?? '', e.id]);
    });
  }
}
