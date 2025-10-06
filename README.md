# ad-segment-trimmer

> self-hosted REST API (with frontend) to remove ads from audio/video files using OpenAI's Whisper and LLMs

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

### How does it work?

A transcript is made with an API from Fireworks AI, running Whisper (specifically Whisper-V3-Large), an open-source ASR model, which returns an entire transcription, and also word level timestamps, then the entire transcription is sent to an LLM (gpt-5-mini) to extract the entire advertisement segments, then the start_time and end_time of each segment is used to create an FFmpeg command to remove the segments from the original audio file, and return the cleaned audio file to the user.

### How much does it cost?

Whisper is billed at $0.0015 per audio minute (billed per second), and gpt-5-mini is billed at $0.25 per million input tokens ($0.00000025 per token), so for an hour long podcast, the process is billed at around ~$0.093 USD (Whisper $0.09 + ~12k input tokens ≈ $0.003).

### Usage with Docker (recommended)

##### Prerequisites

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)

Clone the repository and navigate to the directory:

```bash
git clone https://github.com/nocdn/ad-segment-trimmer.git
cd ad-segment-trimmer/
```

Copy the `.env.example` file to `.env`:

```bash
cp .env.example .env
```

1. Make sure you have an OpenAI API key, as an environment variable called `OPENAI_API_KEY` in the `.env` file.
2. Make sure you have a Fireworks AI API key, as an environment variable called `FIREWORKS_API_KEY` in the `.env` file.
3. Set any rate limits you want in the `.env` file (optional).
4. Set the OpenAI model you want to use, as an environment variable called `OPENAI_MODEL` in the `.env` file.
5. Set the reasoning effort you want to use, as an environment variable called `REASONING_EFFORT` in the `.env` file.
6. Build the containers and run them:

```bash
docker compose up -d --build
```

(the `-d` flag runs the container in detached mode, and the `--build` flag rebuilds the image if there are any changes)

There now should be a frontend running at port `6030`, and the API running at port `7070`.

To access the API, you can use the following curl command:

```bash
curl -F "file=@audio.mp3" -OJ http://localhost:7070/process
```

(replace `audio.mp3` with the path to your audio file, the -OJ flag will save the file with the returned name with the \_edited suffix)

### Installation for local development

##### Prerequisites

- Python 3.10+

Clone the repository and navigate to the directory:

```bash
git clone https://github.com/nocdn/ad-segment-trimmer.git
cd ad-segment-trimmer/
```

Fill out the .env file by copying the .env.example file:

```bash
cp .env.example .env
```

1. Make sure you have an OpenAI API key, as an environment variable called `OPENAI_API_KEY` in the `.env` file.
2. Make sure you have a Fireworks AI API key, as an environment variable called `FIREWORKS_API_KEY` in the `.env` file.
3. Set any rate limits you want in the `.env` file (optional).
4. Set the OpenAI model you want to use, as an environment variable called `OPENAI_MODEL` in the `.env` file.
5. Set the reasoning effort you want to use, as an environment variable called `REASONING_EFFORT` in the `.env` file.

##### backend

Install the dependencies:

```bash
cd backend
uv venv
uv pip install -r requirements.txt
```

Run the backend:

```bash
python app.py
```

##### frontend

Install the dependencies:

```bash
cd frontend
bun install
```

Run the frontend:

```bash
bun run dev
```

### License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
