#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
import os
import random
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server import Database, InvalidCredentials, SHANGHAI, local_today


def default_start_date(today: date) -> date:
    year = today.year if today.month >= 6 else today.year - 1
    return date(year, 6, 1)


def missing_dates(start: date, end: date) -> set[date]:
    span = (end - start).days + 1
    gaps = ((11, 1), (25, 3), (48, 5), (72, 1), (84, 3))
    missing: set[date] = set()
    for offset, length in gaps:
        for step in range(length):
            candidate = start + timedelta(days=offset + step)
            if offset + step < span - 1:
                missing.add(candidate)
    return missing


def generate_weight_records(start: date, end: date, seed: int = 123456) -> list[tuple[date, int]]:
    if end < start:
        raise ValueError("结束日期不能早于开始日期")
    days = (end - start).days + 1
    randomizer = random.Random(seed)
    raw_noise: list[float] = []
    rolling = 0.0
    for index in range(days):
        progress = index / max(1, days - 1)
        rolling = max(-0.85, min(0.85, rolling * 0.74 + randomizer.uniform(-0.38, 0.38)))
        weekly = 0.38 * math.sin(index * math.tau / 7 + 0.7)
        slower = 0.28 * math.sin(index * math.tau / 19)
        rebound_one = 1.25 * math.exp(-((progress - 0.34) / 0.065) ** 2)
        rebound_two = 0.95 * math.exp(-((progress - 0.72) / 0.055) ** 2)
        raw_noise.append(rolling + weekly + slower + rebound_one + rebound_two)

    start_noise = raw_noise[0]
    end_noise = raw_noise[-1]
    omissions = missing_dates(start, end)
    records: list[tuple[date, int]] = []
    for index, noise in enumerate(raw_noise):
        current_date = start + timedelta(days=index)
        if current_date in omissions:
            continue
        progress = index / max(1, days - 1)
        normalized_noise = noise - (start_noise + (end_noise - start_noise) * progress)
        target = 120.0 + (96.8 - 120.0) * progress
        weight = round(target + normalized_noise, 1)
        records.append((current_date, int(round(weight * 1000))))

    if records:
        records[0] = (records[0][0], 120_000)
        records[-1] = (records[-1][0], 96_800)
    return records


def seed_mock_user(
    database: Database,
    passcode: str,
    display_name: str,
    start: date,
    end: date,
    *,
    replace: bool = False,
) -> dict:
    records = generate_weight_records(start, end)
    try:
        user_id = database.authenticate(passcode)
        exists = True
    except InvalidCredentials:
        user_id = database.create_account(passcode, display_name)
        exists = False

    if exists and not replace:
        raise RuntimeError("密码已有账户，未修改现有数据。如确认是模拟账户，请增加 --replace。")

    created_at = datetime.combine(start, time(hour=8), SHANGHAI).astimezone(timezone.utc).isoformat(timespec="seconds")
    updated_at = datetime.combine(end, time(hour=8), SHANGHAI).astimezone(timezone.utc).isoformat(timespec="seconds")
    with database.connect() as connection:
        connection.execute(
            """
            UPDATE users SET
                display_name = ?, initial_weight_grams = ?, initial_date = ?,
                created_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (display_name, records[0][1], records[0][0].isoformat(), created_at, updated_at, user_id),
        )
        connection.execute("DELETE FROM weight_records WHERE user_id = ?", (user_id,))
        connection.executemany(
            """
            INSERT INTO weight_records (
                user_id, record_date, weight_grams, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            [
                (
                    user_id,
                    record_date.isoformat(),
                    weight_grams,
                    datetime.combine(record_date, time(hour=8), SHANGHAI).astimezone(timezone.utc).isoformat(timespec="seconds"),
                    datetime.combine(record_date, time(hour=8), SHANGHAI).astimezone(timezone.utc).isoformat(timespec="seconds"),
                )
                for record_date, weight_grams in records
            ],
        )
    snapshot = database.create_snapshot("manual")
    return {
        "userId": user_id,
        "recordCount": len(records),
        "missingCount": (end - start).days + 1 - len(records),
        "startDate": records[0][0].isoformat(),
        "endDate": records[-1][0].isoformat(),
        "startWeightKg": records[0][1] / 1000,
        "endWeightKg": records[-1][1] / 1000,
        "snapshotId": snapshot["id"],
    }


def parse_args() -> argparse.Namespace:
    today = local_today()
    parser = argparse.ArgumentParser(description="为体重日历生成可重复的模拟减重账户")
    parser.add_argument("--database", default=os.environ.get("WCAL_DB_PATH", "data/wcal.sqlite3"))
    parser.add_argument("--snapshot-dir", default=os.environ.get("WCAL_SNAPSHOT_DIR"))
    parser.add_argument("--secret", default=os.environ.get("WCAL_SECRET", "development-only-secret-change-before-production"))
    parser.add_argument("--passcode", default="123456")
    parser.add_argument("--name", default="模拟减重用户")
    parser.add_argument("--start", type=date.fromisoformat, default=default_start_date(today))
    parser.add_argument("--end", type=date.fromisoformat, default=today)
    parser.add_argument("--replace", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    database = Database(args.database, args.secret, snapshot_dir=args.snapshot_dir)
    summary = seed_mock_user(
        database,
        args.passcode,
        args.name,
        args.start,
        args.end,
        replace=args.replace,
    )
    print(
        f"已生成用户 #{summary['userId']}：{summary['recordCount']} 条记录，"
        f"缺测 {summary['missingCount']} 天，"
        f"{summary['startWeightKg']:.1f} kg -> {summary['endWeightKg']:.1f} kg，"
        f"快照 {summary['snapshotId']}"
    )


if __name__ == "__main__":
    main()
