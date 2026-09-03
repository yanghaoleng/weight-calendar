#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from zoneinfo import ZoneInfo

PASSCODE_PATTERN = re.compile(r"^\d{6}$")
THEMES = {"rose", "mint", "sky", "lilac", "peach"}
MAX_BODY_BYTES = 32 * 1024
SESSION_DAYS = 90
ADMIN_SESSION_HOURS = 12
PBKDF2_ITERATIONS = 210_000
SHANGHAI = ZoneInfo("Asia/Shanghai")


class AppError(Exception):
    status = HTTPStatus.BAD_REQUEST
    code = "BAD_REQUEST"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class DuplicatePasscode(AppError):
    status = HTTPStatus.CONFLICT
    code = "PASSCODE_EXISTS"


class InvalidCredentials(AppError):
    status = HTTPStatus.UNAUTHORIZED
    code = "INVALID_CREDENTIALS"


class Unauthorized(AppError):
    status = HTTPStatus.UNAUTHORIZED
    code = "UNAUTHORIZED"


class Forbidden(AppError):
    status = HTTPStatus.FORBIDDEN
    code = "FORBIDDEN"


class Conflict(AppError):
    status = HTTPStatus.CONFLICT
    code = "CONFLICT"


class RateLimited(AppError):
    status = HTTPStatus.TOO_MANY_REQUESTS
    code = "RATE_LIMITED"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat(timespec="seconds")


def local_today() -> date:
    return datetime.now(SHANGHAI).date()


def validate_passcode(passcode: object) -> str:
    if not isinstance(passcode, str) or not PASSCODE_PATTERN.fullmatch(passcode):
        raise AppError("密码必须是六位数字")
    return passcode


def validate_display_name(value: object, *, required: bool = False) -> str | None:
    if value is None:
        if required:
            raise AppError("请输入昵称")
        return None
    if not isinstance(value, str):
        raise AppError("名字格式不正确")
    display_name = value.strip()
    if not display_name:
        if required:
            raise AppError("请输入昵称")
        return None
    if len(display_name) > 10:
        raise AppError("名字最多 10 个字符")
    if any(ord(character) < 32 or ord(character) == 127 for character in display_name):
        raise AppError("名字不能包含控制字符")
    return display_name


def validate_date(value: object) -> str:
    if not isinstance(value, str):
        raise AppError("日期格式不正确")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise AppError("日期格式不正确") from exc
    if parsed > local_today():
        raise AppError("不能记录未来日期")
    return parsed.isoformat()


def validate_weight(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise AppError("体重格式不正确")
    if value < 20_000 or value > 400_000:
        raise AppError("体重需在 20.0 到 400.0 kg 之间")
    return value


class Database:
    def __init__(self, path: str | Path, secret: str):
        if len(secret) < 32:
            raise RuntimeError("WCAL_SECRET must contain at least 32 characters")
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.secret = secret.encode("utf-8")
        self._initialize()

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    passcode_lookup TEXT NOT NULL UNIQUE,
                    passcode_salt TEXT NOT NULL,
                    passcode_hash TEXT NOT NULL,
                    passcode_ciphertext TEXT,
                    display_name TEXT,
                    theme TEXT NOT NULL DEFAULT 'rose',
                    initial_weight_grams INTEGER,
                    initial_date TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    CHECK (theme IN ('rose', 'mint', 'sky', 'lilac', 'peach')),
                    CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 10),
                    CHECK (initial_weight_grams IS NULL OR initial_weight_grams BETWEEN 20000 AND 400000)
                );

                CREATE TABLE IF NOT EXISTS weight_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    record_date TEXT NOT NULL,
                    weight_grams INTEGER NOT NULL CHECK (weight_grams BETWEEN 20000 AND 400000),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (user_id, record_date)
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS archived_accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    original_user_id INTEGER NOT NULL,
                    display_name TEXT,
                    passcode_ciphertext TEXT,
                    theme TEXT NOT NULL,
                    initial_weight_grams INTEGER,
                    initial_date TEXT,
                    account_created_at TEXT NOT NULL,
                    account_updated_at TEXT NOT NULL,
                    archived_at TEXT NOT NULL,
                    records_json TEXT NOT NULL,
                    record_count INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS admin_sessions (
                    token_hash TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS access_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    visitor_hash TEXT NOT NULL,
                    path TEXT NOT NULL,
                    user_id INTEGER,
                    user_agent TEXT,
                    occurred_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_records_user_date
                    ON weight_records(user_id, record_date);
                CREATE INDEX IF NOT EXISTS idx_sessions_user
                    ON sessions(user_id);
                CREATE INDEX IF NOT EXISTS idx_access_events_time
                    ON access_events(occurred_at);
                """
            )
            user_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(users)")
            }
            if "display_name" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN display_name TEXT")
            if "passcode_ciphertext" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN passcode_ciphertext TEXT")

    def _lookup(self, passcode: str) -> str:
        return hmac.new(self.secret, passcode.encode("utf-8"), hashlib.sha256).hexdigest()

    def _hash_passcode(self, passcode: str, salt: bytes) -> str:
        return hashlib.pbkdf2_hmac(
            "sha256",
            passcode.encode("utf-8"),
            salt + self.secret,
            PBKDF2_ITERATIONS,
        ).hex()

    def _encrypt_passcode(self, passcode: str) -> str:
        plaintext = passcode.encode("ascii")
        nonce = secrets.token_bytes(16)
        stream = hmac.new(self.secret, b"passcode:stream:v1:" + nonce, hashlib.sha256).digest()
        ciphertext = bytes(value ^ stream[index] for index, value in enumerate(plaintext))
        tag = hmac.new(
            self.secret, b"passcode:auth:v1:" + nonce + ciphertext, hashlib.sha256
        ).digest()
        return base64.urlsafe_b64encode(b"\x01" + nonce + ciphertext + tag).decode("ascii")

    def _decrypt_passcode(self, ciphertext: str | None) -> str | None:
        if not ciphertext:
            return None
        try:
            payload = base64.urlsafe_b64decode(ciphertext.encode("ascii"))
            if len(payload) != 55 or payload[0] != 1:
                return None
            nonce = payload[1:17]
            encrypted = payload[17:23]
            tag = payload[23:]
            expected = hmac.new(
                self.secret, b"passcode:auth:v1:" + nonce + encrypted, hashlib.sha256
            ).digest()
            if not hmac.compare_digest(tag, expected):
                return None
            stream = hmac.new(self.secret, b"passcode:stream:v1:" + nonce, hashlib.sha256).digest()
            plaintext = bytes(value ^ stream[index] for index, value in enumerate(encrypted))
            passcode = plaintext.decode("ascii")
            return passcode if PASSCODE_PATTERN.fullmatch(passcode) else None
        except (UnicodeDecodeError, ValueError):
            return None

    def create_account(self, passcode: str, display_name: object = None) -> int:
        passcode = validate_passcode(passcode)
        display_name = validate_display_name(display_name, required=True)
        salt = secrets.token_bytes(16)
        timestamp = iso_now()
        try:
            with self.connect() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO users (
                        passcode_lookup, passcode_salt, passcode_hash, passcode_ciphertext, display_name,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        self._lookup(passcode),
                        salt.hex(),
                        self._hash_passcode(passcode, salt),
                        self._encrypt_passcode(passcode),
                        display_name,
                        timestamp,
                        timestamp,
                    ),
                )
                return int(cursor.lastrowid)
        except sqlite3.IntegrityError as exc:
            raise DuplicatePasscode("这个六位密码已经有账户") from exc

    def authenticate(self, passcode: str) -> int:
        passcode = validate_passcode(passcode)
        with self.connect() as connection:
            row = connection.execute(
                "SELECT id, passcode_salt, passcode_hash FROM users WHERE passcode_lookup = ?",
                (self._lookup(passcode),),
            ).fetchone()
        if row is None:
            self._hash_passcode(passcode, b"wcal-invalid-user")
            raise InvalidCredentials("密码不正确")
        candidate = self._hash_passcode(passcode, bytes.fromhex(row["passcode_salt"]))
        if not hmac.compare_digest(candidate, row["passcode_hash"]):
            raise InvalidCredentials("密码不正确")
        return int(row["id"])

    def create_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(36)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        created = utc_now()
        expires = created + timedelta(days=SESSION_DAYS)
        with self.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (created.isoformat(),))
            connection.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (token_hash, user_id, created.isoformat(), expires.isoformat()),
            )
        return token

    def user_id_for_session(self, token: str | None) -> int:
        if not token:
            raise Unauthorized("请先登录")
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now = utc_now().isoformat()
        with self.connect() as connection:
            row = connection.execute(
                "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
            if row is None or row["expires_at"] <= now:
                connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
                raise Unauthorized("登录已过期")
        return int(row["user_id"])

    def delete_session(self, token: str | None) -> None:
        if not token:
            return
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with self.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    def create_admin_session(self) -> str:
        token = secrets.token_urlsafe(36)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        created = utc_now()
        expires = created + timedelta(hours=ADMIN_SESSION_HOURS)
        with self.connect() as connection:
            connection.execute("DELETE FROM admin_sessions WHERE expires_at <= ?", (created.isoformat(),))
            connection.execute(
                "INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)",
                (token_hash, created.isoformat(), expires.isoformat()),
            )
        return token

    def require_admin_session(self, token: str | None) -> None:
        if not token:
            raise Unauthorized("请输入管理密码")
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now = utc_now().isoformat()
        with self.connect() as connection:
            row = connection.execute(
                "SELECT expires_at FROM admin_sessions WHERE token_hash = ?", (token_hash,)
            ).fetchone()
            if row is None or row["expires_at"] <= now:
                connection.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (token_hash,))
                raise Unauthorized("管理登录已过期")

    def delete_admin_session(self, token: str | None) -> None:
        if not token:
            return
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with self.connect() as connection:
            connection.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (token_hash,))

    def payload(self, user_id: int) -> dict:
        with self.connect() as connection:
            user = connection.execute(
                """
                SELECT display_name, theme, initial_weight_grams, initial_date, created_at
                FROM users WHERE id = ?
                """,
                (user_id,),
            ).fetchone()
            if user is None:
                raise Unauthorized("账户不存在")
            records = connection.execute(
                """
                SELECT record_date, weight_grams, updated_at
                FROM weight_records WHERE user_id = ? ORDER BY record_date
                """,
                (user_id,),
            ).fetchall()
        return {
            "account": {
                "displayName": user["display_name"],
                "theme": user["theme"],
                "initialWeightGrams": user["initial_weight_grams"],
                "initialDate": user["initial_date"],
                "createdAt": user["created_at"],
            },
            "records": [
                {
                    "date": row["record_date"],
                    "weightGrams": row["weight_grams"],
                    "updatedAt": row["updated_at"],
                }
                for row in records
            ],
        }

    def set_initial(self, user_id: int, record_date: object, weight_grams: object) -> dict:
        record_date = validate_date(record_date)
        weight_grams = validate_weight(weight_grams)
        timestamp = iso_now()
        with self.connect() as connection:
            user = connection.execute(
                "SELECT initial_date FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if user is None:
                raise Unauthorized("账户不存在")
            if user["initial_date"] is not None:
                raise Conflict("初始体重已经设置")
            connection.execute(
                """
                UPDATE users
                SET initial_weight_grams = ?, initial_date = ?, updated_at = ?
                WHERE id = ?
                """,
                (weight_grams, record_date, timestamp, user_id),
            )
            connection.execute(
                """
                INSERT INTO weight_records (
                    user_id, record_date, weight_grams, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, record_date, weight_grams, timestamp, timestamp),
            )
        return self.payload(user_id)

    def upsert_record(self, user_id: int, record_date: object, weight_grams: object) -> dict:
        record_date = validate_date(record_date)
        weight_grams = validate_weight(weight_grams)
        timestamp = iso_now()
        with self.connect() as connection:
            user = connection.execute(
                "SELECT initial_date FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if user is None:
                raise Unauthorized("账户不存在")
            if user["initial_date"] is None:
                raise Conflict("请先设置初始体重")
            connection.execute(
                """
                INSERT INTO weight_records (
                    user_id, record_date, weight_grams, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id, record_date) DO UPDATE SET
                    weight_grams = excluded.weight_grams,
                    updated_at = excluded.updated_at
                """,
                (user_id, record_date, weight_grams, timestamp, timestamp),
            )
            if record_date <= user["initial_date"]:
                connection.execute(
                    """
                    UPDATE users
                    SET initial_weight_grams = ?, initial_date = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (weight_grams, record_date, timestamp, user_id),
                )
        return self.payload(user_id)

    def set_theme(self, user_id: int, theme: object) -> dict:
        if not isinstance(theme, str) or theme not in THEMES:
            raise AppError("背景颜色不存在")
        with self.connect() as connection:
            connection.execute(
                "UPDATE users SET theme = ?, updated_at = ? WHERE id = ?",
                (theme, iso_now(), user_id),
            )
        return self.payload(user_id)

    def export_payload(self, user_id: int) -> dict:
        payload = self.payload(user_id)
        return {
            "schemaVersion": 1,
            "exportedAt": iso_now(),
            "account": payload["account"],
            "records": [
                {
                    **record,
                    "weightKg": round(record["weightGrams"] / 1000, 1),
                }
                for record in payload["records"]
            ],
        }

    def archive_account(self, user_id: int) -> dict:
        timestamp = iso_now()
        with self.connect() as connection:
            user = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if user is None:
                raise Unauthorized("账户不存在")
            records = connection.execute(
                """
                SELECT record_date, weight_grams, created_at, updated_at
                FROM weight_records WHERE user_id = ? ORDER BY record_date
                """,
                (user_id,),
            ).fetchall()
            archived_records = [
                {
                    "date": row["record_date"],
                    "weightGrams": row["weight_grams"],
                    "createdAt": row["created_at"],
                    "updatedAt": row["updated_at"],
                }
                for row in records
            ]
            connection.execute(
                """
                INSERT INTO archived_accounts (
                    original_user_id, display_name, passcode_ciphertext, theme,
                    initial_weight_grams, initial_date, account_created_at,
                    account_updated_at, archived_at, records_json, record_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user["id"],
                    user["display_name"],
                    user["passcode_ciphertext"],
                    user["theme"],
                    user["initial_weight_grams"],
                    user["initial_date"],
                    user["created_at"],
                    user["updated_at"],
                    timestamp,
                    json.dumps(archived_records, ensure_ascii=False, separators=(",", ":")),
                    len(archived_records),
                ),
            )
            connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return {"ok": True, "archivedAt": timestamp}

    def record_visit(self, client_key: str, path: object, user_agent: str | None, user_id: int | None) -> None:
        safe_path = path if isinstance(path, str) and path in {"/", "/data"} else "/"
        visitor_hash = hmac.new(
            self.secret, f"visitor:{client_key}".encode("utf-8"), hashlib.sha256
        ).hexdigest()
        safe_agent = (user_agent or "")[:180]
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO access_events (visitor_hash, path, user_id, user_agent, occurred_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (visitor_hash, safe_path, user_id, safe_agent, iso_now()),
            )

    def admin_dashboard(self) -> dict:
        now = utc_now()
        today_start = datetime.combine(now.astimezone(SHANGHAI).date(), datetime.min.time(), SHANGHAI).astimezone(timezone.utc)
        seven_days_ago = now - timedelta(days=7)
        with self.connect() as connection:
            users = connection.execute("SELECT * FROM users ORDER BY created_at DESC").fetchall()
            active_users = []
            for user in users:
                records = connection.execute(
                    """
                    SELECT record_date, weight_grams, created_at, updated_at
                    FROM weight_records WHERE user_id = ? ORDER BY record_date
                    """,
                    (user["id"],),
                ).fetchall()
                active_users.append(
                    {
                        "id": user["id"],
                        "displayName": user["display_name"],
                        "passcode": self._decrypt_passcode(user["passcode_ciphertext"]),
                        "theme": user["theme"],
                        "initialWeightGrams": user["initial_weight_grams"],
                        "initialDate": user["initial_date"],
                        "createdAt": user["created_at"],
                        "updatedAt": user["updated_at"],
                        "records": [
                            {
                                "date": row["record_date"],
                                "weightGrams": row["weight_grams"],
                                "createdAt": row["created_at"],
                                "updatedAt": row["updated_at"],
                            }
                            for row in records
                        ],
                    }
                )
            archives = connection.execute(
                "SELECT * FROM archived_accounts ORDER BY archived_at DESC"
            ).fetchall()
            visits = connection.execute(
                """
                SELECT visitor_hash, path, user_id, user_agent, occurred_at
                FROM access_events ORDER BY occurred_at DESC LIMIT 80
                """
            ).fetchall()
            total_visits = connection.execute("SELECT COUNT(*) FROM access_events").fetchone()[0]
            visits_today = connection.execute(
                "SELECT COUNT(*) FROM access_events WHERE occurred_at >= ?",
                (today_start.isoformat(),),
            ).fetchone()[0]
            visits_seven_days = connection.execute(
                "SELECT COUNT(*) FROM access_events WHERE occurred_at >= ?",
                (seven_days_ago.isoformat(),),
            ).fetchone()[0]
            unique_seven_days = connection.execute(
                "SELECT COUNT(DISTINCT visitor_hash) FROM access_events WHERE occurred_at >= ?",
                (seven_days_ago.isoformat(),),
            ).fetchone()[0]
        archived_users = []
        for archive in archives:
            try:
                records = json.loads(archive["records_json"])
            except json.JSONDecodeError:
                records = []
            archived_users.append(
                {
                    "id": archive["id"],
                    "originalUserId": archive["original_user_id"],
                    "displayName": archive["display_name"],
                    "passcode": self._decrypt_passcode(archive["passcode_ciphertext"]),
                    "theme": archive["theme"],
                    "initialWeightGrams": archive["initial_weight_grams"],
                    "initialDate": archive["initial_date"],
                    "createdAt": archive["account_created_at"],
                    "updatedAt": archive["account_updated_at"],
                    "archivedAt": archive["archived_at"],
                    "records": records,
                }
            )
        return {
            "generatedAt": iso_now(),
            "stats": {
                "activeUsers": len(active_users),
                "archivedUsers": len(archived_users),
                "records": sum(len(user["records"]) for user in active_users),
                "visitsToday": visits_today,
                "visits7d": visits_seven_days,
                "uniqueVisitors7d": unique_seven_days,
                "totalVisits": total_visits,
            },
            "activeUsers": active_users,
            "archivedUsers": archived_users,
            "recentVisits": [
                {
                    "visitorId": row["visitor_hash"][:10],
                    "path": row["path"],
                    "userId": row["user_id"],
                    "userAgent": row["user_agent"],
                    "occurredAt": row["occurred_at"],
                }
                for row in visits
            ],
        }

    def health(self) -> bool:
        try:
            with self.connect() as connection:
                value = connection.execute("SELECT 1").fetchone()[0]
            return value == 1
        except sqlite3.Error:
            return False


class SlidingRateLimiter:
    def __init__(self, limit: int = 8, window_seconds: int = 600):
        self.limit = limit
        self.window_seconds = window_seconds
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            attempts = self._attempts[key]
            while attempts and attempts[0] <= now - self.window_seconds:
                attempts.popleft()
            if len(attempts) >= self.limit:
                raise RateLimited("尝试次数太多，请稍后再试")
            attempts.append(now)

    def clear(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)


class WeightCalendarHandler(BaseHTTPRequestHandler):
    database: Database
    static_root: Path
    allowed_origin: str | None = None
    admin_password: str | None = None
    production = False
    login_limiter = SlidingRateLimiter()
    admin_limiter = SlidingRateLimiter(limit=6, window_seconds=900)

    server_version = "WeightCalendar/1.0"

    def log_message(self, message_format: str, *args) -> None:
        print(f"{self.log_date_time_string()} {self.client_address[0]} {message_format % args}")

    @property
    def client_key(self) -> str:
        return self.headers.get("X-Real-IP") or self.client_address[0]

    def _security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        )

    def _send_json(self, status: int, payload: dict, extra_headers: dict[str, str] | None = None) -> None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._security_headers()
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def _send_error(self, error: AppError) -> None:
        self._send_json(error.status, {"ok": False, "code": error.code, "message": error.message})

    def _read_json(self) -> dict:
        content_type = self.headers.get("Content-Type", "")
        if "application/json" not in content_type:
            raise AppError("请求格式不正确")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise AppError("请求长度不正确") from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise AppError("请求内容过大或为空")
        try:
            payload = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise AppError("JSON 格式不正确") from exc
        if not isinstance(payload, dict):
            raise AppError("请求内容必须是对象")
        return payload

    def _session_token(self) -> str | None:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get("wcal_session")
        return morsel.value if morsel else None

    def _admin_token(self) -> str | None:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get("wcal_admin")
        return morsel.value if morsel else None

    def _require_user(self) -> int:
        return self.database.user_id_for_session(self._session_token())

    def _session_cookie(self, token: str) -> str:
        secure = "; Secure" if self.production else ""
        return (
            f"wcal_session={token}; Path=/; HttpOnly; SameSite=Strict; "
            f"Max-Age={SESSION_DAYS * 86400}{secure}"
        )

    def _admin_cookie(self, token: str) -> str:
        secure = "; Secure" if self.production else ""
        return (
            f"wcal_admin={token}; Path=/; HttpOnly; SameSite=Strict; "
            f"Max-Age={ADMIN_SESSION_HOURS * 3600}{secure}"
        )

    def _clear_cookie(self) -> str:
        secure = "; Secure" if self.production else ""
        return f"wcal_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}"

    def _clear_admin_cookie(self) -> str:
        secure = "; Secure" if self.production else ""
        return f"wcal_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}"

    def _check_origin(self) -> None:
        origin = self.headers.get("Origin")
        if origin and self.allowed_origin and origin != self.allowed_origin:
            raise AppError("请求来源不被允许")

    def do_GET(self) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/health":
                healthy = self.database.health()
                self._send_json(HTTPStatus.OK if healthy else HTTPStatus.SERVICE_UNAVAILABLE, {"ok": healthy, "database": healthy})
                return
            if parsed.path == "/api/me":
                self._send_json(HTTPStatus.OK, self.database.payload(self._require_user()))
                return
            if parsed.path == "/api/export":
                payload = self.database.export_payload(self._require_user())
                filename = f"weight-records-{local_today().isoformat()}.json"
                data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self._security_headers()
                self.end_headers()
                self.wfile.write(data)
                return
            if parsed.path == "/api/admin/dashboard":
                self.database.require_admin_session(self._admin_token())
                self._send_json(HTTPStatus.OK, self.database.admin_dashboard())
                return
            self._serve_static(parsed.path)
        except AppError as error:
            self._send_error(error)
        except Exception:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "code": "INTERNAL_ERROR", "message": "服务暂时不可用"})
            raise

    def do_POST(self) -> None:
        try:
            self._check_origin()
            payload = self._read_json()
            path = urlparse(self.path).path
            if path == "/api/visits":
                user_id = None
                try:
                    user_id = self.database.user_id_for_session(self._session_token())
                except Unauthorized:
                    pass
                self.database.record_visit(
                    self.client_key,
                    payload.get("path"),
                    self.headers.get("User-Agent"),
                    user_id,
                )
                self._send_json(HTTPStatus.CREATED, {"ok": True})
                return
            if path == "/api/accounts":
                self.login_limiter.check(f"create:{self.client_key}")
                user_id = self.database.create_account(
                    payload.get("passcode"), payload.get("displayName")
                )
                token = self.database.create_session(user_id)
                self._send_json(HTTPStatus.CREATED, self.database.payload(user_id), {"Set-Cookie": self._session_cookie(token)})
                return
            if path == "/api/sessions":
                limiter_key = f"login:{self.client_key}"
                self.login_limiter.check(limiter_key)
                user_id = self.database.authenticate(payload.get("passcode"))
                token = self.database.create_session(user_id)
                self.login_limiter.clear(limiter_key)
                self._send_json(HTTPStatus.OK, self.database.payload(user_id), {"Set-Cookie": self._session_cookie(token)})
                return
            if path == "/api/admin/session":
                limiter_key = f"admin:{self.client_key}"
                self.admin_limiter.check(limiter_key)
                supplied = payload.get("password")
                configured = self.admin_password or ""
                if not isinstance(supplied, str) or not configured or not hmac.compare_digest(supplied, configured):
                    raise InvalidCredentials("管理密码不正确")
                token = self.database.create_admin_session()
                self.admin_limiter.clear(limiter_key)
                self._send_json(
                    HTTPStatus.OK,
                    self.database.admin_dashboard(),
                    {"Set-Cookie": self._admin_cookie(token)},
                )
                return
            raise AppError("接口不存在")
        except AppError as error:
            self._send_error(error)
        except Exception:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "code": "INTERNAL_ERROR", "message": "服务暂时不可用"})
            raise

    def do_PUT(self) -> None:
        try:
            self._check_origin()
            user_id = self._require_user()
            payload = self._read_json()
            if self.path == "/api/profile":
                result = self.database.set_initial(user_id, payload.get("date"), payload.get("weightGrams"))
            elif self.path == "/api/records":
                result = self.database.upsert_record(user_id, payload.get("date"), payload.get("weightGrams"))
            elif self.path == "/api/theme":
                result = self.database.set_theme(user_id, payload.get("theme"))
            else:
                raise AppError("接口不存在")
            self._send_json(HTTPStatus.OK, result)
        except AppError as error:
            self._send_error(error)
        except Exception:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "code": "INTERNAL_ERROR", "message": "服务暂时不可用"})
            raise

    def do_DELETE(self) -> None:
        try:
            self._check_origin()
            path = urlparse(self.path).path
            if path == "/api/sessions":
                self.database.delete_session(self._session_token())
                self._send_json(HTTPStatus.OK, {"ok": True}, {"Set-Cookie": self._clear_cookie()})
                return
            if path == "/api/admin/session":
                self.database.delete_admin_session(self._admin_token())
                self._send_json(HTTPStatus.OK, {"ok": True}, {"Set-Cookie": self._clear_admin_cookie()})
                return
            if path == "/api/account":
                user_id = self._require_user()
                payload = self._read_json()
                if payload.get("confirmation") != "注销":
                    raise AppError("请输入“注销”确认")
                result = self.database.archive_account(user_id)
                self._send_json(HTTPStatus.OK, result, {"Set-Cookie": self._clear_cookie()})
                return
            raise AppError("接口不存在")
        except AppError as error:
            self._send_error(error)
        except Exception:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "code": "INTERNAL_ERROR", "message": "服务暂时不可用"})
            raise

    def _serve_static(self, request_path: str) -> None:
        relative = unquote(request_path).lstrip("/") or "index.html"
        candidate = (self.static_root / relative).resolve()
        root = self.static_root.resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not candidate.is_file():
            candidate = root / "index.html"
        if not candidate.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        mime_type, _ = mimetypes.guess_type(candidate.name)
        data = candidate.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{mime_type or 'application/octet-stream'}" + ("; charset=utf-8" if candidate.suffix in {".html", ".js", ".css", ".json", ".svg"} else ""))
        self.send_header("Content-Length", str(len(data)))
        if candidate.name == "index.html":
            self.send_header("Cache-Control", "no-store, must-revalidate")
        elif candidate.parent.name == "assets":
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        self._security_headers()
        self.end_headers()
        self.wfile.write(data)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Weight Calendar web server")
    parser.add_argument("port", nargs="?", type=int, default=int(os.environ.get("WCAL_PORT", "8141")))
    parser.add_argument("root", nargs="?", default=os.environ.get("WCAL_STATIC_ROOT", "dist"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    secret = os.environ.get("WCAL_SECRET", "development-only-secret-change-before-production")
    database_path = os.environ.get("WCAL_DB_PATH", "data/wcal.sqlite3")
    allowed_origin = os.environ.get("WCAL_ALLOWED_ORIGIN")
    admin_password = os.environ.get("WCAL_ADMIN_PASSWORD")
    production = os.environ.get("APP_ENV") == "production"
    if production and secret.startswith("development-only"):
        raise RuntimeError("WCAL_SECRET is required in production")
    if production and not admin_password:
        raise RuntimeError("WCAL_ADMIN_PASSWORD is required in production")
    database = Database(database_path, secret)
    WeightCalendarHandler.database = database
    WeightCalendarHandler.static_root = Path(args.root)
    WeightCalendarHandler.allowed_origin = allowed_origin
    WeightCalendarHandler.admin_password = admin_password
    WeightCalendarHandler.production = production
    server = ThreadingHTTPServer(("127.0.0.1", args.port), WeightCalendarHandler)
    print(f"Weight Calendar listening on http://127.0.0.1:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
