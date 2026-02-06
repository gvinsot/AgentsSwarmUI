FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY server/package*.json ./
RUN npm ci --production

# Copy source code
COPY server/src ./src

EXPOSE 3001

CMD ["node", "src/index.js"]
