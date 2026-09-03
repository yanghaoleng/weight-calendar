import sqlite3
import tempfile
import unittest
from pathlib import Path

from server import (
    AppError,
    Database,
    DoubaoAnalyzer,
    DuplicatePasscode,
    GeoLocator,
    InvalidCredentials,
    Unauthorized,
    normalize_ip,
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
            migrated = Database(path, "test-secret-with-at-least-thirty-two-characters")
            with migrated.connect() as connection:
                columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)")}
            self.assertIn("display_name", columns)
            self.assertIn("font_style", columns)
            self.assertIn("sound_enabled", columns)
            self.assertIn("height_cm", columns)
            self.assertIn("body_fat_percent", columns)

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
                        height_cm INTEGER,
                        body_fat_percent REAL,
                        initial_weight_grams INTEGER,
                        initial_date TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        CHECK (initial_weight_grams IS NULL OR initial_weight_grams BETWEEN 20000 AND 400000)
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
        payload = self.database.set_sound_enabled(user_id, False)
        self.assertFalse(payload["account"]["soundEnabled"])
        with self.assertRaises(AppError):
            self.database.set_font_style(user_id, "comic-sans")
        with self.assertRaises(AppError):
            self.database.set_sound_enabled(user_id, "false")
        exported = self.database.export_payload(user_id)
        self.assertEqual(exported["schemaVersion"], 1)
        self.assertEqual(exported["records"][0]["weightKg"], 61.2)

    def test_account_archive_releases_passcode_and_preserves_snapshot(self):
        user_id = self.database.create_account("654321", "小高")
        self.database.set_initial(user_id, "2026-08-01", 60200)
        self.database.set_font_style(user_id, "handwriting")
        self.database.set_sound_enabled(user_id, False)
        self.database.set_health_profile(user_id, 172, 21.5)
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
        self.assertEqual(dashboard["archivedUsers"][0]["heightCm"], 172)
        self.assertEqual(dashboard["archivedUsers"][0]["bodyFatPercent"], 21.5)
        self.assertEqual(dashboard["archivedUsers"][0]["records"][0]["weightGrams"], 60200)

    def test_admin_session_and_ip_access_stats(self):
        token = self.database.create_admin_session()
        self.database.require_admin_session(token)
        location = {
            "country": "示例国",
            "region": "示例省",
            "city": "示例市",
            "network": "示例网络",
        }
        self.database.record_visit("192.0.2.14", "/", "Test Browser", None, location)
        self.database.record_visit("192.0.2.14", "/data", "Test Browser", None, location)
        dashboard = self.database.admin_dashboard()
        self.assertEqual(dashboard["stats"]["totalVisits"], 2)
        self.assertEqual(dashboard["stats"]["uniqueVisitors7d"], 1)
        self.assertEqual(dashboard["recentVisits"][0]["ipAddress"], "192.0.2.14")
        self.assertEqual(dashboard["recentVisits"][0]["city"], "示例市")
        self.assertEqual(dashboard["recentVisits"][0]["network"], "示例网络")
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


if __name__ == "__main__":
    unittest.main()
