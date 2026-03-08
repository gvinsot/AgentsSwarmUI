# Agents Swarm UI

A complete full-stack interface for coordinating autonomous agent workflows with a polished, responsive React frontend and a lightweight Express backend.

## Features

- **Live swarm orchestration**: spin up specialist agents for research, coding, design, QA, and operations.
- **Task tracking**: monitor status updates, delegated work, and execution logs in real time.
- **Realtime voice**: OpenAI Realtime API powered by WebRTC and microphone capture.
- **Modern interface**: dark glassmorphism UI with command center, task board, event timeline, and responsive layouts.
- **Backend health endpoint**: simple Express service suitable for Docker or local development.

## Project structure

```text
.
├── client/           # React + Vite frontend
├── server/           # Express API and static asset host
├── docs/             # Additional project notes
└── devops/           # Deployment configuration
```

## Getting started

### Prerequisites

- Node.js 20+
- npm 10+

### 1. Install dependencies

```bash
cd client && npm install
cd ../server && npm install
```

### 2. Configure environment

Create the following environment files:

```bash
# client/.env
VITE_API_URL=http://localhost:3001
VITE_OPENAI_API_KEY=your_openai_api_key
```

The frontend expects the backend at `VITE_API_URL`, defaulting to `http://localhost:3001`.

> **Important**
>
> The voice feature currently requests an ephemeral realtime token directly from the browser using your OpenAI API key. For production deployments, proxy token creation through the backend to keep your key secret.

### 3. Run locally

In separate terminals:

```bash
cd server && npm start
cd client && npm run dev
```

Then open `http://localhost:5173`.

## Frontend overview

The client app is composed of the following key areas:

- **Header controls**: launch swarm tasks, toggle dark/light mode, and connect voice.
- **Agent roster**: inspect each specialized agent, capabilities, and current assignment.
- **Task board**: track queued, active, and completed tasks.
- **Timeline**: stream command events and handoff updates.
- **Command palette**: issue natural language instructions or operational commands.
- **Voice panel**: start a conversation with the orchestrator and monitor connection status.

Key frontend modules:

- `src/App.jsx`: main shell and layout composition.
- `src/data/mockSwarm.js`: starter data for agents, tasks, and events.
- `src/components/*`: reusable UI panels and controls.
- `src/lib/realtime.js`: browser-side OpenAI Realtime WebRTC client.
- `src/styles/*`: theme and layout styling.
- `nginx.conf`: production client headers, including CSP allowances for Google Fonts and OpenAI Realtime.

## Backend overview

The backend currently exposes a single endpoint:

- `GET /health`: returns `{ ok: true }`

Environment variables:

- `PORT`: Server port (defaults to `3001`)
- `CLIENT_URL`: Optional origin allowed by the server CORS and browser isolation headers.

The server also sends baseline security headers to support local voice and shared memory features, including CSP rules that allow Google Fonts and `https://api.openai.com` for realtime session setup.

## Docker

### Build images

```bash
docker build -t agents-swarm-ui-client ./client
docker build -t agents-swarm-ui-server ./server
```

### Run containers

```bash
docker run --rm -p 5173:80 agents-swarm-ui-client
docker run --rm -p 3001:3001 agents-swarm-ui-server
```

## Deployment notes

- Set `CLIENT_URL` to your public frontend origin when deploying the backend.
- Update `VITE_API_URL` so the frontend can reach the deployed backend.
- When serving the frontend and backend from different origins, review browser security headers for microphone and WebRTC usage.
- If you customize CSP, keep `https://fonts.googleapis.com`, `https://fonts.gstatic.com`, and `https://api.openai.com` allowed for the current font and realtime voice implementation.

## Testing

```bash
cd server && npm test
cd client && npm run build
```