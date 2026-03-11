FROM ghcr.io/astral-sh/uv:python3.10-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

COPY . .

RUN mkdir -p uploads

EXPOSE 7070

CMD ["uv", "run", "api.py"]