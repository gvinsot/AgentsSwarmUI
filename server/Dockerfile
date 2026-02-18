FROM node:20-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache git openssh-client

# Configure git
RUN git config --global user.name "Gildas" && \
    git config --global user.email "gildas@methodinfo.fr"

# Add GitHub's SSH host keys to known_hosts
RUN mkdir -p /root/.ssh && \
    ssh-keyscan github.com >> /root/.ssh/known_hosts

# Install dependencies
COPY server/package*.json ./
RUN npm ci --production

# Copy source code
COPY server/src ./src

EXPOSE 3001

CMD ["node", "src/index.js"]
