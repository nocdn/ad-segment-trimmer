import sqlite3
import json
import os
from datetime import datetime, timezone

DB_PATH = os.environ.get("DB_PATH", "history.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            created_at TEXT NOT NULL,
            ad_segments_found INTEGER NOT NULL DEFAULT 0,
            ad_segments TEXT,
            transcription_preview TEXT
        )
    """)
    conn.commit()
    conn.close()

def add_entry(filename, ad_segments_found, ad_segments=None, transcription_preview=None):
    conn = get_connection()
    conn.execute(
        "INSERT INTO history (filename, created_at, ad_segments_found, ad_segments, transcription_preview) VALUES (?, ?, ?, ?, ?)",
        (
            filename,
            datetime.now(timezone.utc).isoformat(),
            ad_segments_found,
            json.dumps(ad_segments) if ad_segments else None,
            transcription_preview[:500] if transcription_preview else None,
        ),
    )
    conn.commit()
    conn.close()

def get_all_entries():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM history ORDER BY created_at DESC").fetchall()
    conn.close()
    entries = []
    for row in rows:
        entry = dict(row)
        if entry["ad_segments"]:
            entry["ad_segments"] = json.loads(entry["ad_segments"])
        entries.append(entry)
    return entries

def delete_entry(entry_id):
    conn = get_connection()
    cursor = conn.execute("DELETE FROM history WHERE id = ?", (entry_id,))
    conn.commit()
    deleted = cursor.rowcount > 0
    conn.close()
    return deleted

def clear_all():
    conn = get_connection()
    conn.execute("DELETE FROM history")
    conn.commit()
    conn.close()
