import sqlite3
import tempfile
import unittest
from pathlib import Path

from server import AppError, Database, DuplicatePasscode, InvalidCredentials, Unauthorized


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
        user_id = self.database.create_account("314159")
        with self.assertRaises(DuplicatePasscode):
            self.database.create_account("314159")
        with self.database.connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        self.assertNotIn("314159", tuple(str(value) for value in row))

    def test_login_and_session_round_trip(self):
        user_id = self.database.create_account("271828")
        self.assertEqual(self.database.authenticate("271828"), user_id)
        with self.assertRaises(InvalidCredentials):
            self.database.authenticate("271829")
        token = self.database.create_session(user_id)
        self.assertEqual(self.database.user_id_for_session(token), user_id)
        self.database.delete_session(token)
        with self.assertRaises(Unauthorized):
            self.database.user_id_for_session(token)

    def test_optional_display_name_is_trimmed_and_limited(self):
        named_user = self.database.create_account("112358", "  小乔  ")
        self.assertEqual(self.database.payload(named_user)["account"]["displayName"], "小乔")
        unnamed_user = self.database.create_account("112359", "   ")
        self.assertIsNone(self.database.payload(unnamed_user)["account"]["displayName"])
        with self.assertRaises(AppError):
            self.database.create_account("112360", "一二三四五六七八九十外")

    def test_initial_weight_and_daily_upsert(self):
        user_id = self.database.create_account("161803")
        payload = self.database.set_initial(user_id, "2026-08-01", 60000)
        self.assertEqual(payload["account"]["initialWeightGrams"], 60000)
        payload = self.database.upsert_record(user_id, "2026-08-02", 59800)
        self.assertEqual(len(payload["records"]), 2)
        payload = self.database.upsert_record(user_id, "2026-08-02", 59700)
        self.assertEqual(len(payload["records"]), 2)
        self.assertEqual(payload["records"][1]["weightGrams"], 59700)

    def test_dates_before_initial_date_can_be_backfilled(self):
        user_id = self.database.create_account("141421")
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

    def test_theme_and_export(self):
        user_id = self.database.create_account("173205")
        self.database.set_initial(user_id, "2026-08-01", 61200)
        payload = self.database.set_theme(user_id, "mint")
        self.assertEqual(payload["account"]["theme"], "mint")
        exported = self.database.export_payload(user_id)
        self.assertEqual(exported["schemaVersion"], 1)
        self.assertEqual(exported["records"][0]["weightKg"], 61.2)


if __name__ == "__main__":
    unittest.main()
