import os
import json
import uuid
import subprocess
import requests
from io import BytesIO
from flask import Flask, request, send_file, jsonify
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from dotenv import load_dotenv
from openai import OpenAI
from werkzeug.utils import secure_filename
from flask_cors import CORS

load_dotenv()

app = Flask(__name__)
CORS(app)

# getting keys from .env
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL")
REASONING_EFFORT = os.environ.get("REASONING_EFFORT")
FIREWORKS_API_KEY = os.environ.get("FIREWORKS_API_KEY")
print("OPENAI_API_KEY from .env", OPENAI_API_KEY)
print("FIREWORKS_API_KEY from .env", FIREWORKS_API_KEY)
print("OPENAI_MODEL from .env", OPENAI_MODEL)
print("REASONING_EFFORT from .env", REASONING_EFFORT)

# getting rate limiting from .env
RATE_LIMITING_ENABLED = os.environ.get("RATE_LIMITING_ENABLED")
print("RATE_LIMITING_ENABLED from .env", RATE_LIMITING_ENABLED)

if RATE_LIMITING_ENABLED == "true":
    RATE_LIMIT = os.environ.get("RATE_LIMIT")
    print("RATE_LIMIT from .env", RATE_LIMIT)
else:
    RATE_LIMIT = None
    print("Rate limiting is disabled")

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["5 per day"],
    storage_uri="memory://",
)

# create gemini api client
client = OpenAI(
    api_key=OPENAI_API_KEY,
)

def transcribe(filePath):
    """Calls the Fireworks transcription API and returns a tuple (transcription_text, segments, word-level transcript)."""
    with open(filePath, "rb") as file:
        response = requests.post(
            "https://audio-prod.us-virginia-1.direct.fireworks.ai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {FIREWORKS_API_KEY}"},
            files={"file": file},
            data={
                "vad_model": "silero",
                "alignment_model": "tdnn_ffn",
                "preprocessing": "none",
                "temperature": "0",
                "timestamp_granularities": "word,segment",
                "audio_window_seconds": "5",
                "speculation_window_words": "4",
                "response_format": "verbose_json"
            },
        )
    if response.status_code == 200:
        dict_response = response.json()
        text = dict_response["text"]
        segments = dict_response["segments"]
        words = dict_response["words"]
        # clean each word, keeping only "word", "start", and "end"
        cleaned_words = []
        for word in words:
            cleaned_word = {
                "word": word["word"],
                "start": word["start"],
                "end": word["end"]
            }
            cleaned_words.append(cleaned_word)
        return text, segments, cleaned_words
    else:
        raise Exception(f"Transcription API error: {response.status_code}, {response.text}")

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

def generate_ffmpeg_trim_command(input_file, output_file, segments_to_remove):
    """
    Generate an FFmpeg command to remove segments from an audio file.
    segments_to_remove should be a list of (start_time, end_time) tuples (in seconds).
    """
    if not input_file or not output_file:
        raise ValueError("Input and output file paths must be provided")
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

    # build FFmpeg filter_complex string
    filter_parts = []
    segment_labels = []
    # extract audio from beginning to start of the first segment
    filter_parts.append(f"[0:a]atrim=0:{segments_to_remove[0][0]}[s0]")
    segment_labels.append("[s0]")
    # extract audio between segments
    for i in range(len(segments_to_remove) - 1):
        current_end = segments_to_remove[i][1]
        next_start = segments_to_remove[i+1][0]
        if current_end < next_start:
            filter_parts.append(f"[0:a]atrim={current_end}:{next_start}[s{i+1}]")
            segment_labels.append(f"[s{i+1}]")
    # extract audio from the end of the last segment to the end of the file
    filter_parts.append(f"[0:a]atrim=start={segments_to_remove[-1][1]}[s{len(segments_to_remove)}]")
    segment_labels.append(f"[s{len(segments_to_remove)}]")
    concat_filter = f"{''.join(segment_labels)}concat=n={len(segment_labels)}:v=0:a=1[out]"

    filter_complex = ";".join(filter_parts) + ";" + concat_filter
    command = f'ffmpeg -i "{input_file}" -filter_complex "{filter_complex}" -map "[out]" "{output_file}"'
    return command

def find_phrases_timestamps(transcript_data, phrases):
    """
    For each phrase from the Gemini response (either a string or list of strings),
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
@limiter.limit(RATE_LIMIT)
def process_audio():
    """
    Expects a multipart/form-data POST with an audio file attached under the key "file".
    It will process the file (transcribe -> extract ad segments -> find those segments' timestamps -> remove those segments via FFmpeg)
    and send back the cleaned audio file. Both input and output files are deleted afterward.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    # save the incoming file with a uuid to prevent conflics/overwrites
    uploads_dir = "uploads"
    os.makedirs(uploads_dir, exist_ok=True)
    filename = secure_filename(file.filename)
    unique_id = uuid.uuid4().hex
    input_file = os.path.join(uploads_dir, unique_id + "_" + filename)
    file.save(input_file)

    # define the output file name (appending _edited before the extension)
    base, ext = os.path.splitext(input_file)
    output_file = base + "_edited" + ext

    try:
        # firly, transcribe the audio file
        transcription_text, _, transcript_words = transcribe(input_file)
    except Exception as e:
        os.remove(input_file)
        return jsonify({"error": str(e)}), 500

    try:
        # using openai to extract advertisement segments
        phrases_str = openaiGetSegments(transcription_text)
        try:
            phrases = json.loads(phrases_str)
        except json.JSONDecodeError:
            phrases = []
    except Exception as e:
        os.remove(input_file)
        return jsonify({"error": f"Error from OpenAI: {str(e)}"}), 500

    # find the timestamps of the phrases in the transcript
    matches = find_phrases_timestamps(transcript_words, phrases)
    
    # if no matches found, simply copy the file (i.e. nothing to remove)
    if not matches:
        cmd = f'cp "{input_file}" "{output_file}"'
    else:
        try:
            cmd = generate_ffmpeg_trim_command(input_file, output_file, matches)
        except Exception as e:
            os.remove(input_file)
            return jsonify({"error": f"Error generating FFmpeg command: {str(e)}"}), 500

    try:
        # execute the FFmpeg command to trim the segments
        result = subprocess.run(cmd, shell=True, capture_output=True)
        if result.returncode != 0:
            os.remove(input_file)
            return jsonify({"error": f"FFmpeg command failed: {result.stderr.decode()}"}), 500
    except Exception as e:
        os.remove(input_file)
        return jsonify({"error": f"Error executing FFmpeg command: {str(e)}"}), 500

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

    # extract the original filename to then create a new filename from it and not return the uuid
    original_base, _ = os.path.splitext(filename)
    download_filename = original_base + "_edited.mp3"

    # return the cleaned audio file
    return send_file(
        BytesIO(audio_data),
        download_name=download_filename,
        as_attachment=True,
        mimetype="audio/mpeg"
    )

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=7070)