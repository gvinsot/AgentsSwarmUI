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
    python3 py3-pip \
    make gcc g++ musl-dev \
    ripgrep \
    fd \
    less \
    patch diffutils \
    docker-cli docker-cli-compose

# kubectl
RUN curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    chmod +x kubectl && mv kubectl /usr/local/bin/

# GitHub SSH host keys
RUN mkdir -p /root/.ssh && \
    ssh-keyscan github.com >> /root/.ssh/known_hosts

WORKDIR /workspace

# Keep container alive for docker exec
CMD ["tail", "-f", "/dev/null"]
