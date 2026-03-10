import os
import json
import uuid
import subprocess
import logging
import traceback
import hashlib
import time
import shutil
from pathlib import Path

from io import BytesIO
from flask import Flask, request, send_file, jsonify
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from dotenv import load_dotenv
from openai import OpenAI
from werkzeug.utils import secure_filename
from flask_cors import CORS

ROOT_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ROOT_ENV_PATH)

import db

app = Flask(__name__)
CORS(app)
db.init_db()

logging.basicConfig(level=logging.DEBUG, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)
logging.getLogger("openai").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

class ExcludeHistoryGetLogs(logging.Filter):
    def filter(self, record):
        return "GET /history" not in record.getMessage()

logging.getLogger("werkzeug").addFilter(ExcludeHistoryGetLogs())

# getting keys from .env
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL")
REASONING_EFFORT = os.environ.get("REASONING_EFFORT")
FIREWORKS_API_KEY = os.environ.get("FIREWORKS_API_KEY")
INTERNAL_API_SECRET = os.environ.get("INTERNAL_API_SECRET", "local-internal-secret")
print("OPENAI_API_KEY configured", bool(OPENAI_API_KEY))
print("FIREWORKS_API_KEY configured", bool(FIREWORKS_API_KEY))
print("OPENAI_MODEL from .env", OPENAI_MODEL)
print("REASONING_EFFORT from .env", REASONING_EFFORT)

# getting rate limiting from .env
RATE_LIMITING_ENABLED = os.environ.get("RATE_LIMITING_ENABLED", "false").lower() == "true"
PROCESS_RATE_LIMIT = os.environ.get("RATE_LIMIT", "10000 per day")
HISTORY_RATE_LIMIT = os.environ.get("HISTORY_RATE_LIMIT", "500000 per day")
print("RATE_LIMITING_ENABLED from .env", RATE_LIMITING_ENABLED)
if RATE_LIMITING_ENABLED:
    print("RATE_LIMIT from .env", PROCESS_RATE_LIMIT)
    print("HISTORY_RATE_LIMIT from .env", HISTORY_RATE_LIMIT)
else:
    print("Rate limiting is disabled")

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[],
    storage_uri="memory://",
)

def maybe_limit(limit):
    def decorator(func):
        if RATE_LIMITING_ENABLED:
            return limiter.limit(limit)(func)
        return func
    return decorator


def get_internal_user_id():
    internal_secret = request.headers.get("X-Internal-Api-Secret")
    if internal_secret != INTERNAL_API_SECRET:
        return None

    user_id = request.headers.get("X-User-Id")
    if not user_id:
        return None

    return user_id

# create openai client
client = OpenAI(
    api_key=OPENAI_API_KEY,
)

# create fireworks audio client (OpenAI-compatible)
fireworks_client = OpenAI(
    base_url="https://audio-turbo.api.fireworks.ai/v1",
    api_key=FIREWORKS_API_KEY,
)

def transcribe(filePath):
    """Calls the Fireworks transcription API and returns a tuple (transcription_text, segments, word-level transcript)."""
    with open(filePath, "rb") as file:
        response = fireworks_client.audio.transcriptions.create(
            model="whisper-v3-turbo",
            file=file,
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )
    text = response.text
    segments = response.segments
    words = response.words
    # clean each word, keeping only "word", "start", and "end"
    cleaned_words = []
    for word in words:
        cleaned_word = {
            "word": word.word,
            "start": word.start,
            "end": word.end
        }
        cleaned_words.append(cleaned_word)
    return text, segments, cleaned_words

def compute_file_hash(file_path):
    """Compute a SHA-256 hash of the file bytes."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as file:
        while True:
            chunk = file.read(1024 * 1024)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()

def normalise_timestamp_ranges(raw_ranges):
    """Validate and normalise cached timestamp ranges."""
    if not isinstance(raw_ranges, list):
        return None

    normalised = []
    for item in raw_ranges:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            return None

        start, end = item
        try:
            start_float = float(start)
            end_float = float(end)
        except (TypeError, ValueError):
            return None

        if start_float < 0 or end_float <= start_float:
            return None

        normalised.append((start_float, end_float))

    normalised.sort(key=lambda x: x[0])
    return normalised

def openaiGetSegments(transcriptionText):
    """
    Uses the OpenAI API to extract advertisement segments from the transcript.
    The response is expected to be an array of segments in JSON text.
    """
    response = client.responses.create(
        model=OPENAI_MODEL,
        input=[
            {
                "role": "developer",
                "content": [
                    {
                        "type": "input_text",
                        "text": "From the provided podcast transcript, please output all of the advertisement segments. Output them verbatim. Output them as an array of strings with each string being a segment. If a segment is repeated exactly in another part of the transcript, only output it once. DO NOT OUTPUT THEM IN ANY CODEBLOCKS OR BACKTICKS OR ANYTHING, JUST THE ARRAY OF SEGMENTS AS YOUR RESPONSE.  This is going into a safety-critical system so it cannot have any code blocks or backticks. Do not change the segments' case, punctuation or capitalization."
                    }
                ]
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": transcriptionText
                    }
                ]
            }
        ],
        reasoning={
            "effort": REASONING_EFFORT,
            "summary": "auto"
        },
    )
    return response.output[1].content[0].text

def generate_ffmpeg_trim_command(input_file, output_file, segments_to_remove, concat_manifest_file):
    """
    Generate an FFmpeg stream-copy command to remove segments from an audio file.
    This uses concat demuxer + inpoint/outpoint so FFmpeg can avoid re-encoding.
    segments_to_remove should be a list of (start_time, end_time) tuples (in seconds).
    """
    if not input_file or not output_file or not concat_manifest_file:
        raise ValueError("Input, output, and concat manifest file paths must be provided")
    if not segments_to_remove or not isinstance(segments_to_remove, list):
        raise ValueError("segments_to_remove must be a non-empty list of (start, end) tuples")

    segments_to_remove.sort(key=lambda x: x[0])
    for i, (start, end) in enumerate(segments_to_remove):
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise ValueError(f"Segment {i}: Start and end times must be numbers")
        if start >= end:
            raise ValueError(f"Segment {i}: Start time ({start}) must be less than end time ({end})")
        if i > 0 and start < segments_to_remove[i-1][1]:
            raise ValueError(f"Segments {i-1} and {i} overlap or are not in ascending order")

    input_path_for_concat = os.path.abspath(input_file).replace("'", "'\\''")
    keep_ranges = []

    # Keep audio before the first removed segment.
    first_start = segments_to_remove[0][0]
    if first_start > 0:
        keep_ranges.append((0.0, first_start))

    # Keep audio in-between removed segments.
    for i in range(len(segments_to_remove) - 1):
        current_end = segments_to_remove[i][1]
        next_start = segments_to_remove[i + 1][0]
        if current_end < next_start:
            keep_ranges.append((current_end, next_start))

    # Keep tail audio after the last removed segment.
    keep_ranges.append((segments_to_remove[-1][1], None))

    manifest_lines = ["ffconcat version 1.0"]
    for start, end in keep_ranges:
        manifest_lines.append(f"file '{input_path_for_concat}'")
        manifest_lines.append(f"inpoint {start:.6f}")
        if end is not None:
            manifest_lines.append(f"outpoint {end:.6f}")

    with open(concat_manifest_file, "w", encoding="utf-8") as manifest:
        manifest.write("\n".join(manifest_lines) + "\n")

    command = (
        f'ffmpeg -f concat -safe 0 -i "{concat_manifest_file}" '
        f'-fflags +genpts -avoid_negative_ts make_zero -c copy "{output_file}"'
    )
    return command

def find_phrases_timestamps(transcript_data, phrases):
    """
    For each phrase from the OpenAI response (either a string or list of strings),
    find its occurrences in the transcript data (a list of words with timestamps)
    and return a list of (start_time, end_time) tuples.
    """
    if not transcript_data or not phrases:
        return []
    
    if isinstance(phrases, str):
        phrases = [phrases]
    
    # normalise transcript words
    transcript_words = []
    for item in transcript_data:
        cleaned_word = item['word'].strip().lower().rstrip('.,:;!?')
        transcript_words.append({
            'word': cleaned_word,
            'start': item['start'],
            'end': item['end']
        })
    
    results = []
    total_words = len(transcript_words)
    
    # look for each phrase as a sequence of words
    for phrase in phrases:
        if not phrase:
            continue
        target_words = [w.strip().lower().rstrip('.,:;!?') for w in phrase.split()]
        target_length = len(target_words)
        for i in range(total_words - target_length + 1):
            match = True
            for j in range(target_length):
                if transcript_words[i+j]['word'] != target_words[j]:
                    match = False
                    break
            if match:
                start_time = transcript_words[i]['start']
                end_time = transcript_words[i+target_length-1]['end']
                results.append((start_time, end_time))
    return results

@app.route("/process", methods=["POST"])
@maybe_limit(PROCESS_RATE_LIMIT)
def process_audio():
    """
    Expects a multipart/form-data POST with an audio file attached under the key "file".
    It will process the file (transcribe -> extract ad segments -> find those segments' timestamps -> remove those segments via FFmpeg)
    and send back the cleaned audio file. Both input and output files are deleted afterward.
    """
    user_id = get_internal_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400
    request_start_time = time.perf_counter()

    # save the incoming file with a uuid to prevent conflics/overwrites
    uploads_dir = "uploads"
    os.makedirs(uploads_dir, exist_ok=True)
    fallback_name = f"upload_{uuid.uuid4().hex}"
    original_filename = os.path.basename(file.filename) or fallback_name
    filename = secure_filename(original_filename) or fallback_name
    unique_id = uuid.uuid4().hex
    input_file = os.path.join(uploads_dir, unique_id + "_" + filename)
    file.save(input_file)
    logger.info(f"Saved uploaded file: {filename} -> {input_file}")

    # define the output file name (appending _edited before the extension)
    base, ext = os.path.splitext(input_file)
    output_file = base + "_edited" + ext

    audio_hash = compute_file_hash(input_file)
    logger.info(f"Computed audio hash: {audio_hash}")

    transcription_text = None
    phrases = []
    matches = []
    cached_processing = db.get_cached_processing_data(audio_hash)
    if cached_processing:
        cached_ranges = normalise_timestamp_ranges(cached_processing.get("ad_segment_timestamps"))
        if cached_ranges is not None:
            matches = cached_ranges
            cached_phrases = cached_processing.get("ad_segments")
            if isinstance(cached_phrases, list):
                phrases = cached_phrases
            cached_transcription = cached_processing.get("transcription")
            if isinstance(cached_transcription, str):
                transcription_text = cached_transcription
            logger.info(f"Hash cache hit: found existing processing data for {audio_hash}")
            logger.info(
                f"Skipping transcription and ad extraction; reusing {len(matches)} cached timestamp ranges"
            )
        else:
            logger.warning(
                f"Cache entry for hash {audio_hash} has invalid timestamps, falling back to full processing"
            )
            cached_processing = None
    else:
        logger.info(f"Hash cache miss: no existing processing data for {audio_hash}")

    if not cached_processing:
        logger.info("Running transcription and ad extraction for this upload")
        try:
            # first, transcribe the audio file
            logger.info("Starting transcription...")
            transcription_text, _, transcript_words = transcribe(input_file)
            logger.info(f"Transcription complete. Text length: {len(transcription_text)}, Words: {len(transcript_words)}")
        except Exception as e:
            logger.error(f"Transcription failed: {traceback.format_exc()}")
            os.remove(input_file)
            return jsonify({"error": str(e)}), 500

        try:
            # using openai to extract advertisement segments
            logger.info("Sending transcription to OpenAI for ad segment detection...")
            phrases_str = openaiGetSegments(transcription_text)
            logger.info("Received ad-segment response from OpenAI")
            try:
                phrases = json.loads(phrases_str)
                logger.info(f"Parsed {len(phrases)} ad segments")
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse OpenAI response as JSON, treating as no segments")
                phrases = []
        except Exception as e:
            logger.error(f"OpenAI call failed: {traceback.format_exc()}")
            os.remove(input_file)
            return jsonify({"error": f"Error from OpenAI: {str(e)}"}), 500

        # find the timestamps of the phrases in the transcript
        matches = find_phrases_timestamps(transcript_words, phrases)
        logger.info(f"Found {len(matches)} matching timestamp ranges: {matches}")
        db.upsert_cached_processing_data(
            audio_hash=audio_hash,
            ad_segments=phrases if phrases else [],
            transcription=transcription_text,
            ad_segment_timestamps=matches,
        )
    
    concat_manifest_file = os.path.join(uploads_dir, unique_id + "_segments.ffconcat")

    # if no matches found, simply copy the file (i.e. nothing to remove)
    if not matches:
        logger.info("No ad segments found, copying original file")
        try:
            shutil.copyfile(input_file, output_file)
        except Exception as e:
            logger.error(f"File copy failed: {traceback.format_exc()}")
            os.remove(input_file)
            return jsonify({"error": f"Error copying original file: {str(e)}"}), 500
    else:
        try:
            cmd = generate_ffmpeg_trim_command(input_file, output_file, matches, concat_manifest_file)
            logger.info(f"FFmpeg command: {cmd}")
        except Exception as e:
            logger.error(f"FFmpeg command generation failed: {traceback.format_exc()}")
            os.remove(input_file)
            return jsonify({"error": f"Error generating FFmpeg command: {str(e)}"}), 500

        try:
            # execute the FFmpeg command to trim the segments
            logger.info("Executing FFmpeg stream-copy trim...")
            result = subprocess.run(cmd, shell=True, capture_output=True)
            if result.returncode != 0:
                logger.error(f"FFmpeg failed: {result.stderr.decode()}")
                os.remove(input_file)
                return jsonify({"error": f"FFmpeg command failed: {result.stderr.decode()}"}), 500
            logger.info("FFmpeg completed successfully")
        except Exception as e:
            logger.error(f"FFmpeg execution error: {traceback.format_exc()}")
            os.remove(input_file)
            return jsonify({"error": f"Error executing FFmpeg command: {str(e)}"}), 500
        finally:
            if os.path.exists(concat_manifest_file):
                os.remove(concat_manifest_file)

    try:
        # read the processed output file
        with open(output_file, "rb") as f:
            audio_data = f.read()
    except Exception as e:
        if os.path.exists(input_file):
            os.remove(input_file)
        if os.path.exists(output_file):
            os.remove(output_file)
        return jsonify({"error": f"Error reading output file: {str(e)}"}), 500

    # cleanup: deleting both the input and output files from the working dir
    os.remove(input_file)
    os.remove(output_file)

    processing_time_ms = int((time.perf_counter() - request_start_time) * 1000)

    # save to history
    db.add_entry(
        user_id=user_id,
        filename=original_filename,
        ad_segments_found=len(matches),
        ad_segments=phrases if phrases else None,
        processing_time_ms=processing_time_ms,
    )

    # preserve the uploaded filename and append [trimmed] before the extension
    original_base, original_ext = os.path.splitext(original_filename)
    if original_ext:
        download_filename = f"{original_base}[trimmed]{original_ext}"
    else:
        download_filename = f"{original_filename}[trimmed]"

    # return the cleaned audio file
    return send_file(
        BytesIO(audio_data),
        download_name=download_filename,
        as_attachment=True,
        mimetype="audio/mpeg"
    )

@app.route("/history", methods=["GET"])
@maybe_limit(HISTORY_RATE_LIMIT)
def get_history():
    """Returns all processing history entries."""
    user_id = get_internal_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    entries = db.get_history_for_user(user_id)
    return jsonify(entries)

@app.route("/history/<int:entry_id>", methods=["DELETE"])
def delete_history(entry_id):
    """Deletes a single history entry by ID."""
    user_id = get_internal_user_id()
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401

    deleted = db.delete_entry(entry_id, user_id)
    if deleted:
        return jsonify({"message": "Entry deleted"})
    return jsonify({"error": "Entry not found"}), 404

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=7070)
