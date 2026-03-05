import json
import os
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

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
                    filename TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    ad_segments_found INTEGER NOT NULL DEFAULT 0,
                    ad_segments JSONB,
                    transcription TEXT,
                    audio_hash TEXT,
                    ad_segment_timestamps JSONB,
                    processing_time_ms BIGINT
                )
                """
            )

            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_history_audio_hash ON history (audio_hash)"
            )


def add_entry(
    filename,
    ad_segments_found,
    ad_segments=None,
    transcription=None,
    audio_hash=None,
    ad_segment_timestamps=None,
    processing_time_ms=None,
):
    ad_segments_json = json.dumps(ad_segments) if ad_segments else None
    ad_segment_timestamps_json = (
        json.dumps(ad_segment_timestamps) if ad_segment_timestamps is not None else None
    )

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO history (
                    filename,
                    ad_segments_found,
                    ad_segments,
                    transcription,
                    audio_hash,
                    ad_segment_timestamps,
                    processing_time_ms
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    filename,
                    ad_segments_found,
                    ad_segments_json,
                    transcription,
                    audio_hash,
                    ad_segment_timestamps_json,
                    processing_time_ms,
                ),
            )


def get_all_entries():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    filename,
                    created_at,
                    ad_segments_found,
                    ad_segments,
                    transcription,
                    audio_hash,
                    ad_segment_timestamps,
                    processing_time_ms
                FROM history
                ORDER BY created_at DESC
                """
            )
            rows = cur.fetchall()

    entries = []
    for row in rows:
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

        entries.append(entry)

    return entries


def get_cached_processing_data(audio_hash):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ad_segments, ad_segment_timestamps, transcription
                FROM history
                WHERE audio_hash = %s
                  AND ad_segment_timestamps IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (audio_hash,),
            )
            row = cur.fetchone()

    if not row:
        return None

    entry = dict(row)

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


def delete_entry(entry_id):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM history WHERE id = %s", (entry_id,))
            deleted = cur.rowcount > 0
    return deleted


def clear_all():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM history")
