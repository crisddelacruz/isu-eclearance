// All table definitions for ISU eClearance.
// Safe to run many times: every statement uses IF NOT EXISTS.

module.exports = `
-- ============ COLLEGES ============
CREATE TABLE IF NOT EXISTS colleges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL UNIQUE,
  dean_name  TEXT,
  email      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1
);

-- ============ PROGRAMS ============
CREATE TABLE IF NOT EXISTS programs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE RESTRICT,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL UNIQUE,
  level      TEXT NOT NULL DEFAULT 'Undergraduate',
  is_active  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_programs_college ON programs(college_id);

-- ============ OFFICES (signatory offices) ============
-- scope tells the system how to find the right signatory:
--   university = one office for the whole university (Library, Cashier...)
--   college    = matched by the student's college (Dean)
--   program    = matched by the student's program (Program Chair)
--   instructor = one line per subject, signed by that subject's instructor
CREATE TABLE IF NOT EXISTS offices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  scope       TEXT NOT NULL CHECK (scope IN ('university','college','program','instructor')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_required INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1
);

-- ============ USERS ============
CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  role                 TEXT NOT NULL CHECK (role IN ('student','signatory','admin')),
  id_number            TEXT UNIQUE,
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT NOT NULL,
  first_name           TEXT NOT NULL,
  middle_name          TEXT,
  last_name            TEXT NOT NULL,
  suffix               TEXT,
  phone                TEXT,
  college_id           INTEGER REFERENCES colleges(id) ON DELETE SET NULL,
  program_id           INTEGER REFERENCES programs(id) ON DELETE SET NULL,
  year_level           INTEGER,
  office_id            INTEGER REFERENCES offices(id) ON DELETE SET NULL,
  position_title       TEXT,
  signature_path       TEXT,
  signature_updated_at TEXT,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','disabled')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_users_role    ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_office  ON users(office_id);
CREATE INDEX IF NOT EXISTS idx_users_college ON users(college_id);
CREATE INDEX IF NOT EXISTS idx_users_program ON users(program_id);

-- ============ ACADEMIC TERMS ============
CREATE TABLE IF NOT EXISTS academic_terms (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  school_year         TEXT NOT NULL,
  semester            TEXT NOT NULL CHECK (semester IN ('1st Semester','2nd Semester','Summer')),
  clearance_open_date TEXT,
  clearance_deadline  TEXT,
  is_current          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (school_year, semester)
);

-- ============ ENROLLMENTS (subjects + instructor) ============
CREATE TABLE IF NOT EXISTS enrollments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term_id       INTEGER NOT NULL REFERENCES academic_terms(id) ON DELETE CASCADE,
  subject_code  TEXT NOT NULL,
  subject_title TEXT NOT NULL,
  instructor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (student_id, term_id, subject_code)
);
CREATE INDEX IF NOT EXISTS idx_enroll_student    ON enrollments(student_id, term_id);
CREATE INDEX IF NOT EXISTS idx_enroll_instructor ON enrollments(instructor_id);

-- ============ CLEARANCE REQUESTS ============
CREATE TABLE IF NOT EXISTS clearance_requests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_no      TEXT NOT NULL UNIQUE,
  verification_code TEXT NOT NULL UNIQUE,
  student_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term_id           INTEGER NOT NULL REFERENCES academic_terms(id) ON DELETE RESTRICT,
  purpose           TEXT NOT NULL CHECK (purpose IN
                      ('End of Semester','Graduation','Transfer','Leave of Absence','Honorable Dismissal')),
  status            TEXT NOT NULL DEFAULT 'in_progress'
                      CHECK (status IN ('in_progress','completed','cancelled')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  completed_at      TEXT,
  UNIQUE (student_id, term_id, purpose)
);
CREATE INDEX IF NOT EXISTS idx_requests_student ON clearance_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_requests_status  ON clearance_requests(status);

-- ============ CLEARANCE ITEMS (one signature line each) ============
-- signed_name, signed_position and signature_path are SNAPSHOTS taken at
-- signing time, so old clearances stay valid even if a signatory later
-- changes their signature or leaves the university.
CREATE TABLE IF NOT EXISTS clearance_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id      INTEGER NOT NULL REFERENCES clearance_requests(id) ON DELETE CASCADE,
  office_id       INTEGER NOT NULL REFERENCES offices(id) ON DELETE RESTRICT,
  enrollment_id   INTEGER REFERENCES enrollments(id) ON DELETE SET NULL,
  signatory_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  remarks         TEXT,
  acted_at        TEXT,
  signed_name     TEXT,
  signed_position TEXT,
  signature_path  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_per_line
  ON clearance_items(request_id, office_id, COALESCE(enrollment_id, 0));
CREATE INDEX IF NOT EXISTS idx_items_request   ON clearance_items(request_id);
CREATE INDEX IF NOT EXISTS idx_items_signatory ON clearance_items(signatory_id, status);

-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  message    TEXT,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

-- ============ AUDIT LOGS ============
CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  details    TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ============ SETTINGS ============
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;