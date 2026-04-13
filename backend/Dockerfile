# PicTur Backend (Flask API, Turtle Matching, Google Sheets)
FROM python:3.11-slim

# System deps for OpenCV (libgl1 is the modern replacement for libgl1-mesa-glx on Debian Bookworm+)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Data dir for TurtleManager (Review_Queue, Community_Uploads, vocabulary, etc.)
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 5000

# Use env PORT if set (e.g. by Heroku/Docker), default 5000
ENV PORT=5000
CMD ["python", "-u", "app.py"]
