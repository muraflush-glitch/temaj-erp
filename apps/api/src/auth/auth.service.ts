import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors';
import { AuthUser } from '../common/request';
import { DB } from '../database/database.module';
import { Db, one, withTransaction } from '../database/db';
import { newSessionToken, newTotpSecret, sha256Hex, verifyPassword, verifyTotp } from './crypto';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const invalidLogin = () => new DomainError('INVALID_LOGIN', 'Email-i ose fjalëkalimi është i pasaktë', 401);

interface UserRow {
  id: string; email: string; display_name: string; password_hash: string;
  mfa_enabled: boolean; mfa_secret: string | null; is_active: boolean; failed_logins: number; locked_until: Date | null;
}

@Injectable()
export class AuthService {
  constructor(@Inject(DB) private readonly db: Db, private readonly audit: AuditService) {}

  private ttlMinutes(): number {
    return Number(process.env.SESSION_TTL_MINUTES ?? 480);
  }

  async login(email: string, password: string, totp?: string): Promise<{ token: string; mfaRequired: boolean }> {
    const user = await one<UserRow>(this.db, 'SELECT * FROM app_user WHERE email = $1', [email]);
    if (!user || !user.is_active) {
      await this.audit.record(this.db, { actorUserId: null, action: 'auth.login_failed', entityType: 'app_user', details: { email, reason: 'unknown_or_inactive' } });
      throw invalidLogin();
    }
    const userId = Number(user.id);
    if (user.locked_until && user.locked_until > new Date()) {
      throw new DomainError('ACCOUNT_LOCKED', 'Llogaria është bllokuar përkohësisht pas tentativave të dështuara', 423);
    }
    const okPassword = await verifyPassword(password, user.password_hash);
    if (!okPassword) {
      await withTransaction(this.db, async (tx) => {
        await tx.query(
          `UPDATE app_user SET failed_logins = failed_logins + 1,
                  locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
            WHERE id = $1`, [userId, MAX_FAILED, LOCK_MINUTES]);
        await this.audit.record(tx, { actorUserId: userId, action: 'auth.login_failed', entityType: 'app_user', entityId: userId, details: { reason: 'bad_password' } });
      });
      throw invalidLogin();
    }
    let mfaPassed = false;
    if (user.mfa_enabled) {
      if (!totp) {
        throw new DomainError('MFA_REQUIRED', 'Shkruani kodin 2FA nga aplikacioni authenticator', 401);
      }
      if (!user.mfa_secret || !verifyTotp(user.mfa_secret, totp)) {
        await this.audit.record(this.db, { actorUserId: userId, action: 'auth.mfa_failed', entityType: 'app_user', entityId: userId });
        throw new DomainError('MFA_INVALID', 'Kodi 2FA është i pasaktë', 401);
      }
      mfaPassed = true;
    }
    const { token, hash } = newSessionToken();
    await withTransaction(this.db, async (tx) => {
      await tx.query('UPDATE app_user SET failed_logins = 0, locked_until = NULL WHERE id = $1', [userId]);
      const s = await one<{ id: string }>(tx,
        `INSERT INTO user_session(user_id, token_hash, mfa_passed, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4)) RETURNING id`,
        [userId, hash, mfaPassed, this.ttlMinutes()]);
      await this.audit.record(tx, { actorUserId: userId, action: 'auth.login', entityType: 'user_session', entityId: s?.id, details: { mfaPassed } });
    });
    return { token, mfaRequired: false };
  }

  async resolveSession(token: string): Promise<AuthUser | null> {
    const row = await one<{ id: string; user_id: string; mfa_passed: boolean }>(this.db,
      `SELECT s.id, s.user_id, s.mfa_passed FROM user_session s JOIN app_user u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active`,
      [sha256Hex(token)]);
    return row ? { id: Number(row.user_id), sessionId: Number(row.id), mfaPassed: row.mfa_passed } : null;
  }

  async logout(user: AuthUser): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      await tx.query('UPDATE user_session SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [user.sessionId]);
      await this.audit.record(tx, { actorUserId: user.id, action: 'auth.logout', entityType: 'user_session', entityId: user.sessionId });
    });
  }

  /** Revokon të gjitha sesionet e një përdoruesi (p.sh. kur largohet nga puna). */
  async revokeAllSessions(actor: AuthUser, userId: number): Promise<number> {
    return withTransaction(this.db, async (tx) => {
      const res = await tx.query('UPDATE user_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await this.audit.record(tx, { actorUserId: actor.id, action: 'auth.sessions_revoked', entityType: 'app_user', entityId: userId, details: { count: res.rowCount } });
      return res.rowCount ?? 0;
    });
  }

  async me(user: AuthUser): Promise<{ id: number; email: string; displayName: string; mfaEnabled: boolean; mfaPassed: boolean }> {
    const u = await one<{ email: string; display_name: string; mfa_enabled: boolean }>(this.db,
      'SELECT email, display_name, mfa_enabled FROM app_user WHERE id = $1', [user.id]);
    if (!u) throw new DomainError('NOT_FOUND', 'Përdoruesi nuk u gjet', 404);
    return { id: user.id, email: u.email, displayName: u.display_name, mfaEnabled: u.mfa_enabled, mfaPassed: user.mfaPassed };
  }

  async mfaSetup(user: AuthUser): Promise<{ secret: string; otpauthUrl: string }> {
    const u = await one<{ email: string; mfa_enabled: boolean }>(this.db, 'SELECT email, mfa_enabled FROM app_user WHERE id = $1', [user.id]);
    if (!u) throw new DomainError('NOT_FOUND', 'Përdoruesi nuk u gjet', 404);
    if (u.mfa_enabled) throw new DomainError('MFA_ALREADY_ENABLED', '2FA është aktivizuar tashmë', 409);
    const secret = newTotpSecret();
    await this.db.query('UPDATE app_user SET mfa_secret = $2 WHERE id = $1', [user.id, secret]);
    const label = encodeURIComponent(`Temaj ERP:${u.email}`);
    return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=Temaj%20ERP&digits=6&period=30` };
  }

  async mfaEnable(user: AuthUser, code: string): Promise<void> {
    const u = await one<{ mfa_secret: string | null }>(this.db, 'SELECT mfa_secret FROM app_user WHERE id = $1', [user.id]);
    if (!u?.mfa_secret || !verifyTotp(u.mfa_secret, code)) throw new DomainError('MFA_INVALID', 'Kodi 2FA është i pasaktë', 400);
    await withTransaction(this.db, async (tx) => {
      await tx.query('UPDATE app_user SET mfa_enabled = TRUE WHERE id = $1', [user.id]);
      await tx.query('UPDATE user_session SET mfa_passed = TRUE WHERE id = $1', [user.sessionId]);
      await this.audit.record(tx, { actorUserId: user.id, action: 'auth.mfa_enabled', entityType: 'app_user', entityId: user.id });
    });
  }
}
