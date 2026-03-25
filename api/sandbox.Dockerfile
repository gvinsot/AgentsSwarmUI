FROM node:20-alpine

# Dev tools for agent sandboxes
RUN apk add --no-cache \
    git openssh-client \
    curl wget \
    jq yq \
    bash \
    grep sed gawk findutils coreutils \
    tree \
    tar gzip unzip \
    python3 py3-pip py3-pytest \
    make gcc g++ musl-dev binutils \
    ripgrep \
    fd \
    less \
    patch diffutils \
    docker-cli docker-cli-compose \
    # Go
    go \
    # Headless Chromium for web scraping, testing, PDF generation
    chromium nss freetype harfbuzz ca-certificates ttf-freefont

# Go tools (gopls, delve, golangci-lint)
ENV GOPATH="/root/go"
ENV PATH="/usr/lib/go/bin:$GOPATH/bin:$PATH"
RUN CGO_ENABLED=0 go install golang.org/x/tools/gopls@latest && \
    CGO_ENABLED=0 go install github.com/go-delve/delve/cmd/dlv@latest && \
    CGO_ENABLED=0 go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# Chromium flags for running inside containers (no GPU, no sandbox needed)
ENV CHROMIUM_BIN=/usr/bin/chromium-browser \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CHROME_BIN=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PLAYWRIGHT_BROWSERS_PATH=/usr/lib \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Global Node.js dev tools & browser automation
RUN npm install -g \
    playwright-core \
    puppeteer-core \
    typescript \
    ts-node \
    eslint \
    prettier \
    jest \
    vitest \
    lighthouse

# kubectl
RUN curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    chmod +x kubectl && mv kubectl /usr/local/bin/

# RTK (Rust Token Killer) — reduces LLM token consumption by 60-90%
RUN RTK_ARCH=$(uname -m | sed 's/x86_64/x86_64/' | sed 's/aarch64/aarch64/') && \
    RTK_VERSION=$(curl -fsSL https://api.github.com/repos/rtk-ai/rtk/releases/latest | grep '"tag_name"' | head -1 | cut -d'"' -f4) && \
    curl -fsSL "https://github.com/rtk-ai/rtk/releases/download/${RTK_VERSION}/rtk-${RTK_ARCH}-unknown-linux-musl.tar.gz" | tar -xz -C /usr/local/bin/ && \
    chmod +x /usr/local/bin/rtk && \
    rtk --version

# GitHub SSH host keys — stored in /etc/ssh/ssh_known_hosts (system-wide)
# so they survive the /root/.ssh volume mount that shadows build-time files
RUN mkdir -p /root/.ssh /etc/ssh && \
    ssh-keyscan -t ed25519,rsa github.com >> /etc/ssh/ssh_known_hosts 2>/dev/null && \
    ssh-keyscan -t ed25519,rsa github.com >> /root/.ssh/known_hosts 2>/dev/null

WORKDIR /workspace

# Keep container alive for docker exec
CMD ["tail", "-f", "/dev/null"]
