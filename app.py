from flask import Flask, request, jsonify
import requests
import os
from werkzeug.utils import secure_filename
import logging

app = Flask(__name__)

# configure logging
logging.basicConfig(level=logging.DEBUG,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# configuration
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'mp3'}
FIREWORKS_API_KEY = os.environ.get("FIREWORKS_API_KEY")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

logging.debug(f"FIREWORKS_API_KEY: {FIREWORKS_API_KEY}")
logging.debug(f"OPENAI_API_KEY: {OPENAI_API_KEY}")

# create uploads folder if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
logging.info(f"Uploads folder created or already exists at: {UPLOAD_FOLDER}")

def allowed_file(filename):
    logging.info(f"Checking if file {filename} is allowed")
    is_allowed = '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS
    logging.info(f"File {filename} allowed: {is_allowed}")
    return is_allowed

def shorten_transcription(transcription):
    logging.info("Shortening transcription")
    words = transcription.get('words', [])
    shortened_words = [[word['word'], word['start'], word['end']] for word in words]
    logging.debug(f"Shortened words: {shortened_words}")
    shortened_transcription_result = {
        'text': transcription.get('text', ''),
        'words': shortened_words
    }
    logging.info("Transcription shortened successfully")
    return shortened_transcription_result

@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    logging.info("Transcription request received")
    # check if file is present in request
    if 'file' not in request.files:
        logging.error("No file provided in request")
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    logging.info(f"File received: {file.filename}")
    
    # check if file is empty
    if file.filename == '':
        logging.error("No file selected")
        return jsonify({'error': 'No file selected'}), 400
    
    # check if file is allowed
    if not allowed_file(file.filename):
        logging.error(f"File type not allowed: {file.filename}")
        return jsonify({'error': 'File type not allowed'}), 400
    
    try:
        # save file temporarily
        filename = secure_filename(file.filename)
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        logging.info(f"Saving file temporarily to: {filepath}")
        file.save(filepath)
        logging.info(f"File saved successfully to: {filepath}")
        
        # transcribe file
        logging.info("Transcribing file")
        with open(filepath, "rb") as f:
            response = requests.post(
                "https://audio-prod.us-virginia-1.direct.fireworks.ai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {FIREWORKS_API_KEY}"},
                files={"file": f},
                data={
                    "vad_model": "silero",
                    "alignment_model": "tdnn_ffn",
                    "preprocessing": "none",
                    "language": "en",
                    "temperature": "0.2",
                    "timestamp_granularities": "word",
                    "response_format": "verbose_json"
                },
            )
        logging.info(f"Transcription request sent, response status code: {response.status_code}")
        
        # clean up temporary file
        logging.info(f"Removing temporary file: {filepath}")
        os.remove(filepath)
        logging.info(f"Temporary file removed: {filepath}")
        
        if response.status_code == 200:
            transcription = response.json()
            logging.info("Transcription successful")
            logging.debug(f"Transcription response: {transcription}")
            # shorten transcription
            shortened_transcription = shorten_transcription(transcription)
            logging.info("Transcription shortened successfully")

            # return jsonify({'transcription': shortened_transcription})
            
            # summarize transcription using GPT-4o
            logging.info("Summarizing transcription using GPT-4o")
            gpt_response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {OPENAI_API_KEY}"
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": "From this podcast transcript, give me the exact timestamps of the ad segments. For each ad segment, give me an opening timestamp, and an ending timestamp."},
                        {"role": "user", "content": f"{shortened_transcription}"}
                    ]
                }
            )
            logging.info(f"Summary request sent, response status code: {gpt_response.status_code}")
            
            if gpt_response.status_code == 200:
                summary = gpt_response.json()
                logging.info("Summary generated successfully")
                logging.debug(f"Summary response: {summary}")
                return jsonify({'summary': summary['choices'][0]['message']['content']})
            else:
                logging.error(f"Summary generation failed: {gpt_response.text}")
                return jsonify({'error': f'Summary generation failed: {gpt_response.text}'}), gpt_response.status_code
            
        else:
            logging.error(f"Transcription failed: {response.text}")
            return jsonify({'error': f'Transcription failed: {response.text}'}), response.status_code
            
    except Exception as e:
        logging.exception("An error occurred during transcription")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5555)