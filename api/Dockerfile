FROM node:24-alpine AS base

WORKDIR /app

# Install system dependencies for agent coding tools
RUN apk add --no-cache \
    git openssh-client \
    curl wget \
    jq yq \
    bash \
    grep sed gawk findutils coreutils \
    tree \
    tar gzip unzip \
    python3 py3-pip \
    make gcc g++ musl-dev \
    ripgrep \
    fd \
    less \
    patch diffutils \
    docker-cli \
    shadow \
    util-linux

# Configure git at runtime via entrypoint (user/email from env vars)
ENV GIT_USER_NAME=""
ENV GIT_USER_EMAIL=""

# ZVEC native binary requires glibc but Alpine uses musl — always use in-memory vector store
ENV CODE_SEARCH_VECTOR_BACKEND=memory

# Add GitHub's SSH host keys to known_hosts
RUN mkdir -p /root/.ssh && \
    ssh-keyscan github.com >> /root/.ssh/known_hosts

# Install all dependencies (including devDependencies for TypeScript build)
COPY api/package*.json ./
RUN npm ci

# Copy TypeScript config and source code
COPY api/tsconfig.json ./
COPY api/src ./src

# Build TypeScript to JavaScript
RUN npx tsc

# ── Test stage ──────────────────────────────────────────────
FROM base AS test
CMD ["npm", "test"]

# ── Production stage ────────────────────────────────────────
FROM base AS production

# Remove devDependencies for smaller image
RUN npm prune --production

COPY api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
