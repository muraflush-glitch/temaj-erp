import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { createPool } from './db';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [{
    provide: DB,
    useFactory: (): Pool => {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL mungon');
      return createPool(url);
    },
  }],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly pool: Pool) {}
  async onApplicationShutdown(): Promise<void> { await this.pool.end(); }
}
