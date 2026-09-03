import hashlib
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from server import (
    AppError,
    Database,
    DoubaoAnalyzer,
    DuplicatePasscode,
    GeoLocator,
    InvalidCredentials,
    Unauthorized,
    localize_network_label,
    normalize_ip,
    utc_now,
    validate_passcode,
)


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database = Database(
            Path(self.temp_dir.name) / "test.sqlite3",
            "test-secret-with-at-least-thirty-two-characters",
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_passcodes_are_unique_and_not_stored_in_plain_text(self):
        user_id = self.database.create_account("314159", "圆圆")
        with self.assertRaises(DuplicatePasscode):
            self.database.create_account("314159", "另一人")
        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        self.assertNotIn("314159", tuple(str(value) for value in row))

    def test_four_and_six_digit_passcodes_are_supported(self):
        short_user_id = self.database.create_account("2718", "小李")
        long_user_id = self.database.create_account("271828", "小周")

        self.assertEqual(self.database.authenticate("2718"), short_user_id)
        self.assertEqual(self.database.authenticate("271828"), long_user_id)
        dashboard = self.database.admin_dashboard()
        self.assertEqual(
            {user["passcode"] for user in dashboard["activeUsers"]},
            {"2718", "271828"},
        )

        for passcode in ("123", "12345", "1234567", "12a4", "１２３４", 1234, None):
            with self.subTest(passcode=passcode), self.assertRaises(AppError):
                validate_passcode(passcode)

    def test_login_and_session_round_trip(self):
        user_id = self.database.create_account("271828", "小李")
        self.assertEqual(self.database.authenticate("271828"), user_id)
        with self.assertRaises(InvalidCredentials):
            self.database.authenticate("271829")
        token = self.database.create_session(user_id)
        self.assertEqual(self.database.user_id_for_session(token), user_id)
        self.database.delete_session(token)
        with self.assertRaises(Unauthorized):
            self.database.user_id_for_session(token)

    def test_passcode_change_requires_an_available_passcode_and_keeps_session(self):
        user_id = self.database.create_account("271828", "小李")
        self.database.create_account("314159", "小周")
        token = self.database.create_session(user_id)

        with self.assertRaises(DuplicatePasscode):
            self.database.change_passcode(user_id, "314159")
        self.assertEqual(self.database.authenticate("271828"), user_id)

        payload = self.database.change_passcode(user_id, "1618")
        self.assertEqual(payload["account"]["displayName"], "小李")
        with self.assertRaises(InvalidCredentials):
            self.database.authenticate("271828")
        self.assertEqual(self.database.authenticate("1618"), user_id)
        self.assertEqual(self.database.user_id_for_session(token), user_id)

        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        self.assertNotIn("1618", tuple(str(value) for value in row))

    def test_session_can_be_renewed_for_a_full_year(self):
        user_id = self.database.create_account("271827", "小周")
        token = self.database.create_session(user_id)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        short_expiry = (utc_now() + timedelta(hours=1)).isoformat()
        with self.database.connect() as connection:
            connection.execute(
                "UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
                (short_expiry, token_hash),
            )

        self.assertEqual(self.database.user_id_for_session(token, renew=True), user_id)
        with self.database.connect() as connection:
            renewed = connection.execute(
                "SELECT expires_at FROM sessions WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()["expires_at"]
        self.assertGreater(renewed, (utc_now() + timedelta(days=364)).isoformat())

    def test_display_name_is_optional_trimmed_and_limited(self):
        named_user = self.database.create_account("112358", "  小乔  ")
        self.assertEqual(self.database.payload(named_user)["account"]["displayName"], "小乔")
        blank_user = self.database.create_account("112359", "   ")
        unnamed_user = self.database.create_account("112357")
        self.assertIsNone(self.database.payload(blank_user)["account"]["displayName"])
        self.assertIsNone(self.database.payload(unnamed_user)["account"]["displayName"])
        with self.assertRaises(AppError):
            self.database.create_account("112360", "一二三四五六七八九十外")

        payload = self.database.set_display_name(named_user, "  新称呼  ")
        self.assertEqual(payload["account"]["displayName"], "新称呼")
        payload = self.database.set_display_name(named_user, "")
        self.assertIsNone(payload["account"]["displayName"])

    def test_initial_weight_and_daily_upsert(self):
        user_id = self.database.create_account("161803", "小周")
        payload = self.database.set_initial(user_id, "2026-08-01", 60000)
        self.assertEqual(payload["account"]["initialWeightGrams"], 60000)
        payload = self.database.upsert_record(user_id, "2026-08-02", 59800)
        self.assertEqual(len(payload["records"]), 2)
        payload = self.database.upsert_record(user_id, "2026-08-02", 59700)
        self.assertEqual(len(payload["records"]), 2)
        self.assertEqual(payload["records"][1]["weightGrams"], 59700)

    def test_zero_flow_deletes_record_and_recalculates_initial_weight(self):
        user_id = self.database.create_account("161804", "小许")
        self.database.set_initial(user_id, "2026-08-01", 60000)
        self.database.upsert_record(user_id, "2026-08-02", 59800)

        payload = self.database.delete_record(user_id, "2026-08-01")
        self.assertEqual([record["date"] for record in payload["records"]], ["2026-08-02"])
        self.assertEqual(payload["account"]["initialDate"], "2026-08-02")
        self.assertEqual(payload["account"]["initialWeightGrams"], 59800)

        payload = self.database.delete_record(user_id, "2026-08-02")
        self.assertEqual(payload["records"], [])
        self.assertIsNone(payload["account"]["initialDate"])
        self.assertIsNone(payload["account"]["initialWeightGrams"])

    def test_weight_range_accepts_point_one_to_nine_hundred_ninety_nine(self):
        user_id = self.database.create_account("161805", "小庄")
        self.database.set_initial(user_id, "2026-08-01", 100)
        payload = self.database.upsert_record(user_id, "2026-08-02", 999000)
        self.assertEqual(payload["records"][1]["weightGrams"], 999000)

    def test_dates_before_initial_date_can_be_backfilled(self):
        user_id = self.database.create_account("141421", "小林")
        self.database.set_initial(user_id, "2026-08-02", 60000)
        payload = self.database.upsert_record(user_id, "2026-08-01", 59900)
        self.assertEqual(payload["account"]["initialDate"], "2026-08-01")
        self.assertEqual(payload["account"]["initialWeightGrams"], 59900)
        self.assertEqual([record["date"] for record in payload["records"]], ["2026-08-01", "2026-08-02"])

    def test_existing_database_gains_display_name_column(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.sqlite3"
            with sqlite3.connect(path) as connection:
                connection.execute(
                    """
                    CREATE TABLE users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        passcode_lookup TEXT NOT NULL UNIQUE,
                        passcode_salt TEXT NOT NULL,
                        passcode_hash TEXT NOT NULL,
                        theme TEXT NOT NULL DEFAULT 'rose',
                        initial_weight_grams INTEGER,
                        initial_date TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                connection.executescript(
                    """
                    CREATE TABLE access_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        visitor_hash TEXT NOT NULL,
                        ip_address TEXT,
                        path TEXT NOT NULL,
                        user_id INTEGER,
                        user_agent TEXT,
                        country TEXT,
                        region TEXT,
                        city TEXT,
                        network TEXT,
                        occurred_at TEXT NOT NULL
                    );
                    CREATE TABLE ip_locations (
                        ip_address TEXT PRIMARY KEY,
                        country TEXT,
                        region TEXT,
                        city TEXT,
                        network TEXT,
                        resolved_at TEXT NOT NULL
                    );
                    """
                )
            migrated = Database(path, "test-secret-with-at-least-thirty-two-characters")
            with migrated.connect() as connection:
                columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)")}
                access_columns = {
                    row["name"]
                    for row in connection.execute("PRAGMA table_info(access_events)")
                }
                location_columns = {
                    row["name"]
                    for row in connection.execute("PRAGMA table_info(ip_locations)")
                }
            self.assertIn("display_name", columns)
            self.assertIn("font_style", columns)
            self.assertIn("sound_enabled", columns)
            self.assertIn("language", columns)
            self.assertIn("unit", columns)
            self.assertIn("height_cm", columns)
            self.assertIn("body_fat_percent", columns)
            self.assertIn("country_code", access_columns)
            self.assertIn("country_code", location_columns)

    def test_existing_font_constraint_expands_to_all_six_styles(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "old-fonts.sqlite3"
            with sqlite3.connect(path) as connection:
                connection.execute(
                    """
                    CREATE TABLE users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        passcode_lookup TEXT NOT NULL UNIQUE,
                        passcode_salt TEXT NOT NULL,
                        passcode_hash TEXT NOT NULL,
                        passcode_ciphertext TEXT,
                        display_name TEXT,
                        theme TEXT NOT NULL DEFAULT 'rose',
                        font_style TEXT NOT NULL DEFAULT 'system',
                        sound_enabled INTEGER NOT NULL DEFAULT 1,
                        language TEXT NOT NULL DEFAULT 'zh-CN',
                        unit TEXT NOT NULL DEFAULT 'kg',
                        height_cm INTEGER,
                        body_fat_percent REAL,
                        initial_weight_grams INTEGER,
                        initial_date TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        CHECK (font_style IN ('system', 'serif', 'handwriting'))
                    )
                    """
                )

            migrated = Database(path, "test-secret-with-at-least-thirty-two-characters")
            user_id = migrated.create_account("261803", "旧字体")
            for font_style in ("humanist", "cute", "light"):
                payload = migrated.set_font_style(user_id, font_style)
                self.assertEqual(payload["account"]["fontStyle"], font_style)
            with migrated.connect() as connection:
                schema = connection.execute(
                    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
                ).fetchone()[0]
                self.assertIn("'humanist'", schema)
                self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_weight_range_migration_preserves_accounts_records_and_sessions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "old-range.sqlite3"
            secret = "test-secret-with-at-least-thirty-two-characters"
            original = Database(path, secret)
            user_id = original.create_account("202609", "旧范围")
            original.set_initial(user_id, "2026-09-01", 60000)
            original.set_health_profile(user_id, 166, 22.5)
            token = original.create_session(user_id)

            with original.connect() as connection:
                connection.commit()
                connection.execute("PRAGMA foreign_keys = OFF")
                connection.executescript(
                    """
                    BEGIN IMMEDIATE;
                    CREATE TABLE users_old_range (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        passcode_lookup TEXT NOT NULL UNIQUE,
                        passcode_salt TEXT NOT NULL,
                        passcode_hash TEXT NOT NULL,
                        passcode_ciphertext TEXT,
                        display_name TEXT,
                        theme TEXT NOT NULL DEFAULT 'rose',
                        font_style TEXT NOT NULL DEFAULT 'system',
                        sound_enabled INTEGER NOT NULL DEFAULT 1,
                        language TEXT NOT NULL DEFAULT 'zh-CN',
                        unit TEXT NOT NULL DEFAULT 'kg',
                        height_cm INTEGER,
                        body_fat_percent REAL,
                        initial_weight_grams INTEGER,
                        initial_date TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        CHECK (initial_weight_grams IS NULL OR initial_weight_grams BETWEEN 20000 AND 400000),
                        CHECK (font_style IN ('system', 'serif', 'handwriting'))
                    );
                    INSERT INTO users_old_range SELECT * FROM users;
                    DROP TABLE users;
                    ALTER TABLE users_old_range RENAME TO users;

                    CREATE TABLE records_old_range (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        record_date TEXT NOT NULL,
                        weight_grams INTEGER NOT NULL CHECK (weight_grams BETWEEN 20000 AND 400000),
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        UNIQUE (user_id, record_date)
                    );
                    INSERT INTO records_old_range SELECT * FROM weight_records;
                    DROP TABLE weight_records;
                    ALTER TABLE records_old_range RENAME TO weight_records;
                    CREATE INDEX idx_records_user_date ON weight_records(user_id, record_date);
                    COMMIT;
                    """
                )
                connection.execute("PRAGMA foreign_keys = ON")

            migrated = Database(path, secret)
            self.assertEqual(migrated.user_id_for_session(token), user_id)
            payload = migrated.payload(user_id)
            self.assertEqual(payload["records"][0]["weightGrams"], 60000)
            self.assertEqual(payload["account"]["heightCm"], 166)
            payload = migrated.set_font_style(user_id, "humanist")
            self.assertEqual(payload["account"]["fontStyle"], "humanist")
            migrated.upsert_record(user_id, "2026-09-02", 999000)
            with migrated.connect() as connection:
                self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_health_profile_context_and_ai_shape(self):
        user_id = self.database.create_account("100200", "小杭")
        self.database.set_initial(user_id, "2026-08-01", 60200)
        self.database.upsert_record(user_id, "2026-08-02", 59800)

        profile = self.database.set_health_profile(user_id, 168, 23.4)
        self.assertEqual(profile["account"]["heightCm"], 168)
        self.assertEqual(profile["account"]["bodyFatPercent"], 23.4)
        context = self.database.health_context(user_id)
        self.assertEqual(context["recordCount"], 2)
        self.assertEqual(context["latestWeightKg"], 59.8)
        self.assertEqual(context["recentChangeKg"], -0.4)

        analyzer = DoubaoAnalyzer(None)
        result = analyzer._normalize_analysis(
            {
                "summary": "保持温和、稳定的生活节奏",
                "diet": ["三餐规律，优先天然食物"],
                "exercise": ["每周安排三次中等强度活动"],
                "sleep": ["尽量保持固定的入睡时间"],
            }
        )
        self.assertEqual(set(result), {"summary", "diet", "exercise", "sleep"})
        with self.assertRaises(AppError):
            self.database.set_health_profile(user_id, 119, 23)

    def test_legacy_account_passcode_is_backfilled_for_admin(self):
        user_id = self.database.create_account("000007", "老用户")
        with self.database.connect() as connection:
            connection.execute(
                "UPDATE users SET passcode_ciphertext = NULL WHERE id = ?", (user_id,)
            )
        migrated = Database(
            self.database.path,
            "test-secret-with-at-least-thirty-two-characters",
        )
        user = migrated.admin_dashboard()["activeUsers"][0]
        self.assertEqual(user["passcode"], "000007")

    def test_theme_and_export(self):
        user_id = self.database.create_account("173205", "小沈")
        self.database.set_initial(user_id, "2026-08-01", 61200)
        payload = self.database.set_theme(user_id, "mint")
        self.assertEqual(payload["account"]["theme"], "mint")
        payload = self.database.set_font_style(user_id, "serif")
        self.assertEqual(payload["account"]["fontStyle"], "serif")
        for font_style in ("humanist", "cute", "light"):
            payload = self.database.set_font_style(user_id, font_style)
            self.assertEqual(payload["account"]["fontStyle"], font_style)
        payload = self.database.set_sound_enabled(user_id, False)
        self.assertFalse(payload["account"]["soundEnabled"])
        payload = self.database.set_language(user_id, "ja")
        self.assertEqual(payload["account"]["language"], "ja")
        payload = self.database.set_weight_unit(user_id, "lb")
        self.assertEqual(payload["account"]["unit"], "lb")
        with self.assertRaises(AppError):
            self.database.set_font_style(user_id, "comic-sans")
        with self.assertRaises(AppError):
            self.database.set_sound_enabled(user_id, "false")
        with self.assertRaises(AppError):
            self.database.set_language(user_id, "fr")
        with self.assertRaises(AppError):
            self.database.set_weight_unit(user_id, "stone-and-pounds")
        exported = self.database.export_payload(user_id)
        self.assertEqual(exported["schemaVersion"], 1)
        self.assertEqual(exported["records"][0]["weightKg"], 61.2)

    def test_account_archive_releases_passcode_and_preserves_snapshot(self):
        user_id = self.database.create_account("654321", "小高")
        self.database.set_initial(user_id, "2026-08-01", 60200)
        self.database.set_font_style(user_id, "handwriting")
        self.database.set_sound_enabled(user_id, False)
        self.database.set_language(user_id, "zh-HK")
        self.database.set_weight_unit(user_id, "st")
        self.database.set_health_profile(user_id, 172, 21.5)
        self.database.record_visit("192.0.2.55", "/", "Test Browser", user_id, {})
        self.database.verify_passcode(user_id, "654321")
        with self.assertRaises(InvalidCredentials):
            self.database.verify_passcode(user_id, "000000")
        token = self.database.create_session(user_id)
        result = self.database.archive_account(user_id)
        self.assertTrue(result["ok"])
        with self.assertRaises(Unauthorized):
            self.database.user_id_for_session(token)

        replacement_id = self.database.create_account("654321", "新小高")
        self.assertNotEqual(replacement_id, user_id)
        dashboard = self.database.admin_dashboard()
        self.assertEqual(dashboard["activeUsers"][0]["passcode"], "654321")
        self.assertEqual(dashboard["archivedUsers"][0]["passcode"], "654321")
        self.assertEqual(dashboard["archivedUsers"][0]["fontStyle"], "handwriting")
        self.assertFalse(dashboard["archivedUsers"][0]["soundEnabled"])
        self.assertEqual(dashboard["archivedUsers"][0]["language"], "zh-HK")
        self.assertEqual(dashboard["archivedUsers"][0]["unit"], "st")
        self.assertEqual(dashboard["archivedUsers"][0]["heightCm"], 172)
        self.assertEqual(dashboard["archivedUsers"][0]["bodyFatPercent"], 21.5)
        self.assertEqual(dashboard["archivedUsers"][0]["records"][0]["weightGrams"], 60200)
        with self.database.connect() as connection:
            linked_visits = connection.execute(
                "SELECT COUNT(*) FROM access_events WHERE user_id = ?", (user_id,)
            ).fetchone()[0]
        self.assertEqual(linked_visits, 0)

    def test_expired_archives_are_purged_after_thirty_days(self):
        user_id = self.database.create_account("654320", "待清理")
        self.database.archive_account(user_id)
        old_time = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        with self.database.connect() as connection:
            connection.execute(
                "UPDATE archived_accounts SET archived_at = ? WHERE original_user_id = ?",
                (old_time, user_id),
            )
        self.assertEqual(self.database.purge_expired_archived_accounts(), 1)
        self.assertEqual(self.database.admin_dashboard()["archivedUsers"], [])

    def test_ai_prompt_uses_the_account_language(self):
        context = {"recordCount": 1, "records": [{"date": "2026-09-03", "weightKg": 60.0}]}
        self.assertIn("简体中文", DoubaoAnalyzer.build_prompt(context, 170, 22.0, "zh-CN"))
        self.assertIn("日本語", DoubaoAnalyzer.build_prompt(context, 170, 22.0, "ja"))
        self.assertIn("한국어", DoubaoAnalyzer.build_prompt(context, 170, 22.0, "ko"))

    def test_daily_snapshot_is_idempotent_and_reports_storage(self):
        user_id = self.database.create_account("600001", "快照用户")
        self.database.set_initial(user_id, "2026-09-01", 60000)
        snapshot_time = datetime(2026, 9, 4, 8, tzinfo=timezone.utc)

        first = self.database.create_snapshot("daily", snapshot_time)
        second = self.database.create_snapshot("daily", snapshot_time)

        self.assertEqual(first["id"], "wcal-2026-09-04-daily.sqlite3.gz")
        self.assertEqual(second["id"], first["id"])
        self.assertGreater(first["sizeBytes"], 0)
        dashboard = self.database.admin_dashboard()
        self.assertEqual(dashboard["snapshotPolicy"]["count"], 1)
        self.assertEqual(dashboard["snapshotPolicy"]["retentionDays"], 365)
        self.assertEqual(dashboard["snapshots"][0]["kind"], "daily")

    def test_restore_user_from_snapshot_preserves_password_and_creates_safety_snapshot(self):
        user_id = self.database.create_account("600002", "恢复前")
        self.database.set_initial(user_id, "2026-09-01", 60000)
        self.database.set_theme(user_id, "mint")
        snapshot = self.database.create_snapshot(
            "manual", datetime(2026, 9, 3, 8, tzinfo=timezone.utc)
        )

        self.database.upsert_record(user_id, "2026-09-02", 59000)
        self.database.set_theme(user_id, "sky")
        self.database.change_passcode(user_id, "6002")
        result = self.database.restore_user_from_snapshot(user_id, snapshot["id"])

        restored = self.database.payload(user_id)
        self.assertEqual(restored["account"]["theme"], "mint")
        self.assertEqual([record["date"] for record in restored["records"]], ["2026-09-01"])
        self.assertEqual(self.database.authenticate("6002"), user_id)
        with self.assertRaises(InvalidCredentials):
            self.database.authenticate("600002")
        self.assertEqual(result["restoredRecordCount"], 1)
        self.assertEqual(result["safetySnapshot"]["kind"], "pre-restore")

        safety_id = result["safetySnapshot"]["id"]
        self.database.restore_user_from_snapshot(user_id, safety_id)
        recovered = self.database.payload(user_id)
        self.assertEqual(recovered["account"]["theme"], "sky")
        self.assertEqual(len(recovered["records"]), 2)

    def test_snapshot_retention_removes_only_expired_snapshot_files(self):
        database = Database(
            Path(self.temp_dir.name) / "retention.sqlite3",
            "test-secret-with-at-least-thirty-two-characters",
            snapshot_retention_days=365,
        )
        database.create_snapshot("daily", datetime(2026, 9, 1, 8, tzinfo=timezone.utc))
        database.create_snapshot("daily", datetime(2026, 9, 4, 8, tzinfo=timezone.utc))
        database.snapshot_retention_days = 3
        removed = database.purge_expired_snapshots(datetime(2026, 9, 4, 8, tzinfo=timezone.utc))
        self.assertEqual(removed, 1)
        self.assertEqual(
            [snapshot["date"] for snapshot in database.list_snapshots()],
            ["2026-09-04"],
        )

    def test_admin_session_and_ip_access_stats(self):
        token = self.database.create_admin_session()
        self.database.require_admin_session(token)
        location = {
            "country_code": "CN",
            "country": "示例国",
            "region": "示例省",
            "city": "示例市",
            "network": "China Mobile Communications Group",
        }
        self.database.record_visit("192.0.2.14", "/", "Test Browser", None, location)
        self.database.record_visit("192.0.2.14", "/data", "Test Browser", None, location)
        dashboard = self.database.admin_dashboard()
        self.assertEqual(dashboard["stats"]["totalVisits"], 2)
        self.assertEqual(dashboard["stats"]["uniqueVisitors7d"], 1)
        self.assertEqual(dashboard["recentVisits"][0]["ipAddress"], "192.0.2.14")
        self.assertEqual(dashboard["recentVisits"][0]["countryCode"], "CN")
        self.assertEqual(dashboard["recentVisits"][0]["city"], "示例市")
        self.assertEqual(
            dashboard["recentVisits"][0]["network"],
            "China Mobile Communications Group",
        )
        self.assertEqual(dashboard["recentVisits"][0]["networkLabel"], "中国移动")
        self.database.delete_admin_session(token)
        with self.assertRaises(Unauthorized):
            self.database.require_admin_session(token)

    def test_ip_normalization_and_private_location(self):
        self.assertEqual(normalize_ip("203.0.113.8, 10.0.0.1"), "203.0.113.8")
        self.assertEqual(normalize_ip("not-an-ip"), "unknown")
        self.assertEqual(
            GeoLocator("https://example.invalid/{ip}").locate("127.0.0.1")["country"],
            "本地或保留地址",
        )

    def test_geo_locator_exposes_country_code_and_raw_network(self):
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self, _limit):
                return (
                    b'{"success":true,"country_code":"cn","country":"China",'
                    b'"region":"Shanghai","city":"Shanghai",'
                    b'"connection":{"isp":"China Telecom"}}'
                )

        with patch("server.urlopen", return_value=FakeResponse()):
            location = GeoLocator("https://example.invalid/{ip}").locate("8.8.8.8")
        self.assertEqual(location["country_code"], "CN")
        self.assertEqual(location["country"], "China")
        self.assertEqual(location["city"], "Shanghai")
        self.assertEqual(location["network"], "China Telecom")
        self.assertEqual(localize_network_label(location["network"]), "中国电信")
        self.assertEqual(localize_network_label("mobile"), "移动网络")
        self.assertEqual(localize_network_label("Example ISP"), "Example ISP")


if __name__ == "__main__":
    unittest.main()
