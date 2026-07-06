FROM node:22-alpine

WORKDIR /app

# Install production deps first so this layer caches across code changes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app.js manifest.json ./
COPY listeners ./listeners
COPY services ./services
COPY blocks ./blocks

# Task store lives here — mount a volume to persist across container restarts
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data

USER node

# Socket Mode: outbound websocket only, no inbound ports needed
CMD ["node", "app.js"]
