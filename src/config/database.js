const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.resolve(__dirname, '../../data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, 'app.sqlite'));
let resolveReady, rejectReady;
const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS snapchat_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, username)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS score_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES snapchat_profiles(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK(typeof(score) = 'integer' AND score >= 0 AND score <= 9007199254740991),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    submission_key TEXT NOT NULL UNIQUE
  )`);
  db.run('CREATE INDEX IF NOT EXISTS score_entries_profile_order ON score_entries(profile_id, created_at DESC, id DESC)');
  db.run(`CREATE TABLE IF NOT EXISTS streak_milestones (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id INTEGER NOT NULL REFERENCES snapchat_profiles(id) ON DELETE CASCADE,
    milestone INTEGER NOT NULL,
    PRIMARY KEY (user_id, profile_id, milestone)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, action TEXT NOT NULL,
    user_id INTEGER, profile_id INTEGER, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run('CREATE INDEX IF NOT EXISTS audit_logs_date ON audit_logs(created_at DESC, id DESC)');
  db.run("CREATE TRIGGER IF NOT EXISTS audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit-Log ist unveränderlich'); END");
  db.run("CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit-Log ist unveränderlich'); END");
  db.run(`CREATE TABLE IF NOT EXISTS support_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL REFERENCES users(id),
    user_id INTEGER NOT NULL REFERENCES users(id), content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TRIGGER IF NOT EXISTS audit_support_note AFTER INSERT ON support_notes BEGIN
    INSERT INTO audit_logs (admin_id, action, user_id, details) VALUES (NEW.admin_id, 'support_note.create', NEW.user_id, 'Interne Notiz hinzugefügt');
  END`);
  db.all('PRAGMA table_info(users)', (error, columns) => {
    if (error) return rejectReady(error);
    const names = new Set(columns.map(column => column.name));
    const changes = [
      ['role', "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin'))"],
      ['status', "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','disabled'))"],
      ['last_login_at', 'ALTER TABLE users ADD COLUMN last_login_at TEXT'],
      ['session_version', 'ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0'],
      ['force_password_change', 'ALTER TABLE users ADD COLUMN force_password_change INTEGER NOT NULL DEFAULT 0 CHECK(force_password_change IN (0,1))'],
      ['created_by_admin_id', 'ALTER TABLE users ADD COLUMN created_by_admin_id INTEGER REFERENCES users(id)'],
      ['password_policy_bypassed', 'ALTER TABLE users ADD COLUMN password_policy_bypassed INTEGER NOT NULL DEFAULT 0 CHECK(password_policy_bypassed IN (0,1))'],
      ['deleted_at', 'ALTER TABLE users ADD COLUMN deleted_at TEXT'],
      ['deleted_username', 'ALTER TABLE users ADD COLUMN deleted_username TEXT'],
      ['deleted_status', 'ALTER TABLE users ADD COLUMN deleted_status TEXT']
    ].filter(([name]) => !names.has(name));
    const apply = index => {
      if (index === changes.length) return db.exec(`
        CREATE TRIGGER IF NOT EXISTS validate_admin_created_user BEFORE INSERT ON users WHEN NEW.created_by_admin_id IS NOT NULL BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.created_by_admin_id AND role='admin' AND status='active') THEN RAISE(ABORT, 'Administrator nicht aktiv') END;
        END;
        DROP TRIGGER IF EXISTS audit_admin_created_user;
        CREATE TRIGGER audit_admin_created_user AFTER INSERT ON users WHEN NEW.created_by_admin_id IS NOT NULL BEGIN
          INSERT INTO audit_logs(admin_id,action,user_id,details) VALUES(NEW.created_by_admin_id,'user.create',NEW.id,
            'Benutzer erstellt; Passwortänderung erforderlich: ' || CASE WHEN NEW.force_password_change=1 THEN 'ja' ELSE 'nein' END ||
            '; Passwortregeln ignoriert: ' || CASE WHEN NEW.password_policy_bypassed=1 THEN 'ja' ELSE 'nein' END);
        END;
        CREATE INDEX IF NOT EXISTS profiles_active_user_name ON snapchat_profiles(user_id, username COLLATE NOCASE) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS scores_active_profile_time ON score_entries(profile_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
        CREATE TABLE IF NOT EXISTS profile_revisions (profile_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
        CREATE TRIGGER IF NOT EXISTS rev_score_insert AFTER INSERT ON score_entries BEGIN
          INSERT INTO profile_revisions(profile_id,revision) VALUES(NEW.profile_id,1) ON CONFLICT(profile_id) DO UPDATE SET revision=revision+1;
        END;
        CREATE TRIGGER IF NOT EXISTS rev_score_update AFTER UPDATE ON score_entries BEGIN
          INSERT INTO profile_revisions(profile_id,revision) VALUES(NEW.profile_id,1) ON CONFLICT(profile_id) DO UPDATE SET revision=revision+1;
        END;
        CREATE TRIGGER IF NOT EXISTS rev_score_delete AFTER DELETE ON score_entries BEGIN
          INSERT INTO profile_revisions(profile_id,revision) VALUES(OLD.profile_id,1) ON CONFLICT(profile_id) DO UPDATE SET revision=revision+1;
        END;
        CREATE TRIGGER IF NOT EXISTS rev_profile_update AFTER UPDATE ON snapchat_profiles BEGIN
          INSERT INTO profile_revisions(profile_id,revision) VALUES(NEW.id,1) ON CONFLICT(profile_id) DO UPDATE SET revision=revision+1;
        END;
        CREATE TABLE IF NOT EXISTS admin_user_changes (
          id INTEGER PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES users(id),
          user_id INTEGER NOT NULL REFERENCES users(id), new_role TEXT NOT NULL CHECK(new_role IN ('user','admin')),
          new_status TEXT NOT NULL CHECK(new_status IN ('active','suspended','disabled')), reason TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        DROP TRIGGER IF EXISTS validate_admin_user_change;
        CREATE TRIGGER validate_admin_user_change BEFORE INSERT ON admin_user_changes BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.admin_id AND role='admin' AND status='active') THEN RAISE(ABORT, 'Administrator nicht aktiv') END;
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NULL) THEN RAISE(ABORT, 'Nutzer nicht gefunden') END;
          SELECT CASE WHEN EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND role='admin' AND status='active')
            AND (NEW.new_role != 'admin' OR NEW.new_status != 'active')
            AND (SELECT count(*) FROM users WHERE role='admin' AND status='active') <= 1
            THEN RAISE(ABORT, 'Der letzte aktive Administrator muss erhalten bleiben') END;
        END;
        CREATE TABLE IF NOT EXISTS user_deletion_actions (
          id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), user_id INTEGER NOT NULL REFERENCES users(id),
          action TEXT NOT NULL CHECK(action IN ('delete','restore')), new_username TEXT NOT NULL, reason TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TRIGGER IF NOT EXISTS validate_user_deletion_action BEFORE INSERT ON user_deletion_actions BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.actor_id AND status='active' AND deleted_at IS NULL)
            THEN RAISE(ABORT, 'Nutzer nicht aktiv') END;
          SELECT CASE WHEN NEW.action='delete' AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NULL)
            THEN RAISE(ABORT, 'Nutzer nicht gefunden') END;
          SELECT CASE WHEN NEW.action='delete' AND NEW.actor_id != NEW.user_id AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.actor_id AND role='admin' AND status='active' AND deleted_at IS NULL)
            THEN RAISE(ABORT, 'Keine Berechtigung') END;
          SELECT CASE WHEN NEW.action='delete' AND EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND role='admin' AND status='active' AND deleted_at IS NULL)
            AND (SELECT count(*) FROM users WHERE role='admin' AND status='active' AND deleted_at IS NULL) <= 1
            THEN RAISE(ABORT, 'Der letzte aktive Administrator muss erhalten bleiben') END;
          SELECT CASE WHEN NEW.action='restore' AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.actor_id AND role='admin' AND status='active' AND deleted_at IS NULL)
            THEN RAISE(ABORT, 'Keine Berechtigung') END;
          SELECT CASE WHEN NEW.action='restore' AND NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND deleted_at IS NOT NULL)
            THEN RAISE(ABORT, 'Gelöschter Nutzer nicht gefunden') END;
        END;
        CREATE TRIGGER IF NOT EXISTS apply_user_deletion_action AFTER INSERT ON user_deletion_actions BEGIN
          INSERT INTO audit_logs(admin_id,action,user_id,details)
            SELECT CASE WHEN role='admin' THEN NEW.actor_id ELSE NULL END, 'user.' || NEW.action, NEW.user_id, NEW.reason
            FROM users WHERE id=NEW.actor_id;
          UPDATE users SET deleted_username=username,deleted_status=status,deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            username=NEW.new_username,status='disabled',session_version=session_version+1 WHERE id=NEW.user_id AND NEW.action='delete';
          UPDATE users SET username=NEW.new_username,status=COALESCE(deleted_status,'active'),deleted_username=NULL,deleted_status=NULL,deleted_at=NULL
            WHERE id=NEW.user_id AND NEW.action='restore';
        END;
        DROP TRIGGER IF EXISTS apply_admin_user_change;
        CREATE TRIGGER apply_admin_user_change AFTER INSERT ON admin_user_changes BEGIN
          INSERT INTO audit_logs (admin_id, action, user_id, details)
            SELECT NEW.admin_id, 'user.access_change', NEW.user_id,
              'Rolle: ' || role || ' → ' || NEW.new_role || '; Status: ' || status || ' → ' || NEW.new_status || '; Grund: ' || NEW.reason
            FROM users WHERE id=NEW.user_id;
          UPDATE users SET role=NEW.new_role, status=NEW.new_status,
            session_version=session_version + CASE WHEN NEW.new_status != 'active' AND status = 'active' THEN 1 ELSE 0 END
            WHERE id=NEW.user_id;
        END;
        CREATE TABLE IF NOT EXISTS admin_session_revocations (
          id INTEGER PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES users(id),
          user_id INTEGER NOT NULL REFERENCES users(id), reason TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TRIGGER IF NOT EXISTS apply_admin_session_revocation AFTER INSERT ON admin_session_revocations BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.admin_id AND role='admin' AND status='active') THEN RAISE(ABORT, 'Administrator nicht aktiv') END;
          UPDATE users SET session_version=session_version+1 WHERE id=NEW.user_id;
          INSERT INTO audit_logs (admin_id, action, user_id, details) VALUES (NEW.admin_id, 'user.sessions_revoke', NEW.user_id, NEW.reason);
        END;
        CREATE TABLE IF NOT EXISTS admin_data_actions (
          id INTEGER PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES users(id), user_id INTEGER NOT NULL REFERENCES users(id),
          profile_id INTEGER NOT NULL, entry_id INTEGER, action TEXT NOT NULL CHECK(action IN ('restore_profile','restore_score','purge_profile','purge_score')),
          reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TRIGGER IF NOT EXISTS apply_admin_data_action AFTER INSERT ON admin_data_actions BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.admin_id AND role='admin' AND status='active') THEN RAISE(ABORT, 'Administrator nicht aktiv') END;
          SELECT CASE WHEN NEW.action IN ('restore_profile','purge_profile') AND NOT EXISTS
            (SELECT 1 FROM snapchat_profiles WHERE id=NEW.profile_id AND user_id=NEW.user_id AND deleted_at IS NOT NULL)
            THEN RAISE(ABORT, 'Gelöschter Account nicht gefunden') END;
          SELECT CASE WHEN NEW.action IN ('restore_score','purge_score') AND NOT EXISTS
            (SELECT 1 FROM score_entries s JOIN snapchat_profiles p ON p.id=s.profile_id WHERE s.id=NEW.entry_id AND p.id=NEW.profile_id AND p.user_id=NEW.user_id AND s.deleted_at IS NOT NULL AND p.deleted_at IS NULL)
            THEN RAISE(ABORT, 'Gelöschter Eintrag nicht verfügbar') END;
          INSERT INTO audit_logs (admin_id,action,user_id,profile_id,details)
            VALUES(NEW.admin_id, 'data.' || NEW.action, NEW.user_id, NEW.profile_id, 'Eintrag: ' || COALESCE(NEW.entry_id, '-') || '; Grund: ' || NEW.reason);
          UPDATE snapchat_profiles SET deleted_at=NULL,deleted_by=NULL WHERE id=NEW.profile_id AND NEW.action='restore_profile';
          UPDATE score_entries SET deleted_at=NULL,deleted_by=NULL WHERE id=NEW.entry_id AND NEW.action='restore_score';
          DELETE FROM score_entries WHERE id=NEW.entry_id AND NEW.action='purge_score';
          DELETE FROM snapchat_profiles WHERE id=NEW.profile_id AND NEW.action='purge_profile';
        END;
        CREATE TABLE IF NOT EXISTS admin_soft_deletions (
          id INTEGER PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES users(id), user_id INTEGER NOT NULL REFERENCES users(id),
          profile_id INTEGER NOT NULL, entry_id INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TRIGGER IF NOT EXISTS apply_admin_soft_deletion AFTER INSERT ON admin_soft_deletions BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.admin_id AND role='admin' AND status='active') THEN RAISE(ABORT, 'Administrator nicht aktiv') END;
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM score_entries s JOIN snapchat_profiles p ON p.id=s.profile_id WHERE s.id=NEW.entry_id AND p.id=NEW.profile_id AND p.user_id=NEW.user_id AND p.deleted_at IS NULL AND s.deleted_at IS NULL) THEN RAISE(ABORT, 'Eintrag nicht gefunden') END;
          INSERT INTO audit_logs(admin_id,action,user_id,profile_id,details) SELECT NEW.admin_id,'score.delete',NEW.user_id,NEW.profile_id,'Eintrag ' || s.id || ', Score ' || s.score || ', Zeitpunkt ' || s.created_at || '; Grund: ' || NEW.reason FROM score_entries s WHERE s.id=NEW.entry_id;
          UPDATE score_entries SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),deleted_by='admin' WHERE id=NEW.entry_id;
        END;
        CREATE TABLE IF NOT EXISTS streak_exceptions (
          id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL REFERENCES snapchat_profiles(id) ON DELETE CASCADE,
          day TEXT NOT NULL, admin_id INTEGER NOT NULL REFERENCES users(id), reason TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(profile_id, day)
        );
        CREATE TRIGGER IF NOT EXISTS rev_exception_insert AFTER INSERT ON streak_exceptions BEGIN
          INSERT INTO profile_revisions(profile_id,revision) VALUES(NEW.profile_id,1) ON CONFLICT(profile_id) DO UPDATE SET revision=revision+1;
        END;
        CREATE TRIGGER IF NOT EXISTS rev_exception_delete AFTER DELETE ON streak_exceptions BEGIN
          INSERT INTO profile_revisions(profile_id,revision) VALUES(OLD.profile_id,1) ON CONFLICT(profile_id) DO UPDATE SET revision=revision+1;
        END;
        CREATE TABLE IF NOT EXISTS admin_streak_actions (
          id INTEGER PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES users(id), user_id INTEGER NOT NULL REFERENCES users(id),
          profile_id INTEGER NOT NULL, day TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('add','remove')), reason TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TRIGGER IF NOT EXISTS apply_admin_streak_action AFTER INSERT ON admin_streak_actions BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.admin_id AND role='admin' AND status='active') THEN RAISE(ABORT, 'Administrator nicht aktiv') END;
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM snapchat_profiles WHERE id=NEW.profile_id AND user_id=NEW.user_id AND deleted_at IS NULL) THEN RAISE(ABORT, 'Account nicht gefunden') END;
          SELECT CASE WHEN NEW.action='remove' AND NOT EXISTS (SELECT 1 FROM streak_exceptions WHERE profile_id=NEW.profile_id AND day=NEW.day) THEN RAISE(ABORT, 'Ausnahme nicht gefunden') END;
          INSERT INTO audit_logs(admin_id,action,user_id,profile_id,details) VALUES(NEW.admin_id, 'streak.' || NEW.action, NEW.user_id, NEW.profile_id, 'Tag: ' || NEW.day || '; Grund: ' || NEW.reason);
          INSERT INTO streak_exceptions(profile_id,day,admin_id,reason) SELECT NEW.profile_id,NEW.day,NEW.admin_id,NEW.reason WHERE NEW.action='add';
          DELETE FROM streak_exceptions WHERE profile_id=NEW.profile_id AND day=NEW.day AND NEW.action='remove';
        END;
        CREATE TABLE IF NOT EXISTS password_resets (
          id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), admin_id INTEGER NOT NULL REFERENCES users(id),
          token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, session_version INTEGER NOT NULL, used_at INTEGER, new_password_hash TEXT,
          reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TRIGGER IF NOT EXISTS audit_password_reset_created AFTER INSERT ON password_resets BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.admin_id AND role='admin' AND status='active') THEN RAISE(ABORT, 'Administrator nicht aktiv') END;
          INSERT INTO audit_logs(admin_id,action,user_id,details) VALUES(NEW.admin_id,'password_reset.created',NEW.user_id,NEW.reason);
        END;
        CREATE TRIGGER IF NOT EXISTS apply_password_reset AFTER UPDATE OF used_at ON password_resets WHEN OLD.used_at IS NULL AND NEW.used_at IS NOT NULL BEGIN
          UPDATE users SET password_hash=NEW.new_password_hash, session_version=session_version+1, force_password_change=0 WHERE id=NEW.user_id;
          INSERT INTO audit_logs(admin_id,action,user_id,details) VALUES(NEW.admin_id,'password_reset.completed',NEW.user_id,'Einmaliger Reset verwendet');
        END;
        CREATE TABLE IF NOT EXISTS admin_password_requirements (
          id INTEGER PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES users(id), user_id INTEGER NOT NULL REFERENCES users(id),
          reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TRIGGER IF NOT EXISTS apply_password_requirement AFTER INSERT ON admin_password_requirements BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.admin_id AND role='admin' AND status='active') THEN RAISE(ABORT, 'Administrator nicht aktiv') END;
          UPDATE users SET force_password_change=1,session_version=session_version+1 WHERE id=NEW.user_id;
          INSERT INTO audit_logs(admin_id,action,user_id,details) VALUES(NEW.admin_id,'password_change.required',NEW.user_id,NEW.reason);
        END;
        CREATE TABLE IF NOT EXISTS admin_score_corrections (
          id INTEGER PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES users(id), user_id INTEGER NOT NULL REFERENCES users(id),
          profile_id INTEGER NOT NULL, entry_id INTEGER NOT NULL, old_score INTEGER NOT NULL, old_time TEXT NOT NULL,
          new_score INTEGER NOT NULL CHECK(new_score >= 0 AND new_score <= 9007199254740991), new_time TEXT NOT NULL,
          reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TRIGGER IF NOT EXISTS apply_admin_score_correction AFTER INSERT ON admin_score_corrections BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.admin_id AND role='admin' AND status='active') THEN RAISE(ABORT, 'Administrator nicht aktiv') END;
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM score_entries s JOIN snapchat_profiles p ON p.id=s.profile_id
            WHERE s.id=NEW.entry_id AND p.id=NEW.profile_id AND p.user_id=NEW.user_id AND p.deleted_at IS NULL AND s.deleted_at IS NULL AND s.score=NEW.old_score AND s.created_at=NEW.old_time)
            THEN RAISE(ABORT, 'Eintrag wurde zwischenzeitlich geändert') END;
          INSERT INTO audit_logs(admin_id,action,user_id,profile_id,details) VALUES(NEW.admin_id,'score.correct',NEW.user_id,NEW.profile_id,
            'Eintrag ' || NEW.entry_id || ': ' || NEW.old_score || ' @ ' || NEW.old_time || ' → ' || NEW.new_score || ' @ ' || NEW.new_time || '; Grund: ' || NEW.reason);
          UPDATE score_entries SET score=NEW.new_score,created_at=NEW.new_time WHERE id=NEW.entry_id;
        END;
        CREATE TABLE IF NOT EXISTS revoked_sessions (
          session_key TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), admin_id INTEGER NOT NULL REFERENCES users(id),
          expires_at INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TRIGGER IF NOT EXISTS audit_session_revocation AFTER INSERT ON revoked_sessions BEGIN
          SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.admin_id AND role='admin' AND status='active') THEN RAISE(ABORT, 'Administrator nicht aktiv') END;
          INSERT INTO audit_logs(admin_id,action,user_id,details) VALUES(NEW.admin_id,'session.revoke',NEW.user_id,NEW.reason);
        END;
      `, err => err ? rejectReady(err) : resolveReady());
      db.run(changes[index][1], err => err ? rejectReady(err) : apply(index + 1));
    };
    db.all('PRAGMA table_info(snapchat_profiles)', (profileError, profileColumns) => {
      if (profileError) return rejectReady(profileError);
      db.all('PRAGMA table_info(score_entries)', (scoreError, scoreColumns) => {
        if (scoreError) return rejectReady(scoreError);
        for (const [table, cols] of [['snapchat_profiles', profileColumns], ['score_entries', scoreColumns]]) {
          const existing = new Set(cols.map(column => column.name));
          if (!existing.has('deleted_at')) changes.push(['deleted_at', `ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`]);
          if (!existing.has('deleted_by')) changes.push(['deleted_by', `ALTER TABLE ${table} ADD COLUMN deleted_by TEXT`]);
        }
        apply(0);
      });
    });
  });
});

module.exports = { db, dataDir, ready };
