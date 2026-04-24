FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY run.py .

# Create required directories
RUN mkdir -p data sessions media

# Expose port
EXPOSE 8000

# Run server
CMD ["python", "run.py"]
