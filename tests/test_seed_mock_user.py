import tempfile
import unittest
from datetime import date
from pathlib import Path

from scripts.seed_mock_user import generate_weight_records, seed_mock_user
from server import Database


class MockUserSeedTests(unittest.TestCase):
    def test_weight_series_has_natural_gaps_and_fluctuations(self):
        records = generate_weight_records(date(2026, 6, 1), date(2026, 9, 4))
        weights = [weight_grams for _, weight_grams in records]

        self.assertEqual(len(records), 83)
        self.assertEqual(weights[0], 120_000)
        self.assertEqual(weights[-1], 96_800)
        self.assertGreater(sum(right > left for left, right in zip(weights, weights[1:])), 10)
        self.assertGreater(max(weights), weights[-1])
        self.assertTrue(all(90_000 <= weight <= 125_000 for weight in weights))

    def test_seed_creates_login_and_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Database(
                Path(directory) / "wcal.sqlite3",
                "test-secret-with-at-least-thirty-two-characters",
            )
            summary = seed_mock_user(
                database,
                "123456",
                "模拟减重用户",
                date(2026, 6, 1),
                date(2026, 9, 4),
            )

            self.assertEqual(database.authenticate("123456"), summary["userId"])
            self.assertEqual(summary["recordCount"], 83)
            self.assertEqual(summary["missingCount"], 13)
            self.assertEqual(database.admin_dashboard()["snapshots"][0]["kind"], "manual")


if __name__ == "__main__":
    unittest.main()
