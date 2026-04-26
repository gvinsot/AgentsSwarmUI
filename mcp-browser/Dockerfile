FROM python:3.11-slim

# System dependencies required by Playwright / Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget curl gnupg2 ca-certificates fonts-liberation \
        libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
        libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
        libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
        libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY mcp-browser/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Let crawl4ai install Playwright + Chromium
RUN crawl4ai-setup

COPY mcp-browser/src/ ./src/

EXPOSE 8000

CMD ["python", "src/server.py"]
