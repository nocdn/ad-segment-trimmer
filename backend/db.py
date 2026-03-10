import json
import os
from pathlib import Path
from datetime import datetime, timezone

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

ROOT_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ROOT_ENV_PATH)

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required")


def get_connection():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def init_db():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS history (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    ad_segments_found INTEGER NOT NULL DEFAULT 0,
                    ad_segments JSONB,
                    processing_time_ms BIGINT
                )
                """
            )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS processing_cache (
                    audio_hash TEXT PRIMARY KEY,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    ad_segments JSONB,
                    transcription TEXT,
                    ad_segment_timestamps JSONB
                )
                """
            )

            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_history_user_created_at ON history (user_id, created_at DESC)"
            )


def add_entry(
    user_id,
    filename,
    ad_segments_found,
    ad_segments=None,
    processing_time_ms=None,
):
    ad_segments_json = json.dumps(ad_segments) if ad_segments is not None else None

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO history (
                    user_id,
                    filename,
                    ad_segments_found,
                    ad_segments,
                    processing_time_ms
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    user_id,
                    filename,
                    ad_segments_found,
                    ad_segments_json,
                    processing_time_ms,
                ),
            )


def _normalise_entry(row):
    entry = dict(row)

    if isinstance(entry.get("created_at"), datetime):
        entry["created_at"] = entry["created_at"].astimezone(timezone.utc).isoformat()

    ad_segments = entry.get("ad_segments")
    if isinstance(ad_segments, str):
        try:
            entry["ad_segments"] = json.loads(ad_segments)
        except json.JSONDecodeError:
            entry["ad_segments"] = None

    ad_segment_timestamps = entry.get("ad_segment_timestamps")
    if isinstance(ad_segment_timestamps, str):
        try:
            entry["ad_segment_timestamps"] = json.loads(ad_segment_timestamps)
        except json.JSONDecodeError:
            entry["ad_segment_timestamps"] = None

    return entry


def get_history_for_user(user_id):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    user_id,
                    filename,
                    created_at,
                    ad_segments_found,
                    ad_segments,
                    processing_time_ms
                FROM history
                WHERE user_id = %s
                ORDER BY created_at DESC
                """
                ,
                (user_id,),
            )
            rows = cur.fetchall()

    return [_normalise_entry(row) for row in rows]


def get_cached_processing_data(audio_hash):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ad_segments, ad_segment_timestamps, transcription
                FROM processing_cache
                WHERE audio_hash = %s
                LIMIT 1
                """,
                (audio_hash,),
            )
            row = cur.fetchone()

    if not row:
        return None

    return _normalise_entry(row)


def upsert_cached_processing_data(
    audio_hash,
    ad_segments=None,
    transcription=None,
    ad_segment_timestamps=None,
):
    ad_segments_json = json.dumps(ad_segments) if ad_segments is not None else None
    ad_segment_timestamps_json = (
        json.dumps(ad_segment_timestamps) if ad_segment_timestamps is not None else None
    )

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO processing_cache (
                    audio_hash,
                    ad_segments,
                    transcription,
                    ad_segment_timestamps,
                    updated_at
                )
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (audio_hash)
                DO UPDATE SET
                    ad_segments = EXCLUDED.ad_segments,
                    transcription = EXCLUDED.transcription,
                    ad_segment_timestamps = EXCLUDED.ad_segment_timestamps,
                    updated_at = NOW()
                """,
                (
                    audio_hash,
                    ad_segments_json,
                    transcription,
                    ad_segment_timestamps_json,
                ),
            )


def delete_entry(entry_id, user_id):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM history WHERE id = %s AND user_id = %s",
                (entry_id, user_id),
            )
            deleted = cur.rowcount > 0
    return deleted


def clear_all():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM history")
            cur.execute("DELETE FROM processing_cache")
