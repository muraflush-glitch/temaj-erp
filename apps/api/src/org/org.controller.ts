import { Controller, Get, Inject } from '@nestjs/common';
import { RequirePermission } from '../common/request';
import { DB } from '../database/database.module';
import { Db } from '../database/db';

@Controller('org')
export class OrgController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('branches')
  @RequirePermission('org.read')
  async branches() {
    const res = await this.db.query(
      `SELECT b.id, b.code, b.name, b.city, b.is_active, e.code AS legal_entity_code, e.name AS legal_entity_name, e.verified AS legal_entity_verified
         FROM branch b JOIN legal_entity e ON e.id = b.legal_entity_id ORDER BY b.code`);
    return res.rows;
  }

  @Get('warehouses')
  @RequirePermission('org.read')
  async warehouses() {
    const res = await this.db.query('SELECT id, branch_id, code, name, is_active FROM warehouse ORDER BY code');
    return res.rows;
  }

  @Get('roles')
  @RequirePermission('org.read')
  async roles() {
    const res = await this.db.query(
      `SELECT r.code, r.name, array_agg(rp.permission_code ORDER BY rp.permission_code) AS permissions
         FROM role r LEFT JOIN role_permission rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.code`);
    return res.rows;
  }
}
