# OpenClaw Service - FastAPI backend
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    curl \
    wget \
    ca-certificates \
    jq \
    netcat-openbsd \
    dnsutils \
    postgresql-client \
    sqlite3 \
    gettext-base \
    util-linux \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# Create Python virtual environment
RUN python3.12 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy and install Python dependencies
COPY openclaw-service/requirements.txt .
RUN /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

# Copy server code and entrypoint
COPY openclaw-service/src/*.py .
COPY openclaw-service/src/entrypoint.sh .
RUN chmod +x entrypoint.sh

# Install gosu for runtime user switching
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=120s \
    CMD curl -sf http://localhost:8000/health || exit 1

# Start FastAPI server
CMD ["./entrypoint.sh"]