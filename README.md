# 🐝 Agent Swarm UI

A professional, real-time web interface for managing a swarm of AI agents. Built with the **Swarm pattern** (lightweight multi-agent orchestration with handoffs), supporting multiple LLM providers including Ollama and Claude (Anthropic).

## Features

### Agent Management
- **Add/Remove agents** in real time with visual feedback
- **8 pre-built agent templates**: Developer, Architect, QA Engineer, Marketing, DevOps, Data Analyst, Product Manager, Security Analyst
- **Custom agent creation** with full LLM configuration
- **Color-coded** agent cards with status indicators (idle/busy/error)

### Real-Time Capabilities
- **Live streaming** of agent responses via WebSocket
- **Real-time thinking indicator** showing the agent's current output as it generates
- **Status updates** propagated to all connected clients instantly
- **Metrics tracking**: messages, tokens in/out, errors, last active time

### Chat & Interaction
- **Per-agent chat** with full markdown rendering
- **Conversation history** with timestamps
- **Streaming responses** with typing indicators

### Global Broadcast (tmux-style)
- **Broadcast a message to ALL agents simultaneously**
- See all responses side-by-side

### Agent Handoffs (Swarm Pattern)
- **Transfer conversations** between agents with context

### Task Management (Todo Lists)
- **Per-agent todo lists** with progress tracking

### RAG (Retrieval-Augmented Generation)
- **Attach reference documents** to any agent
- Upload text files (.txt, .md, .json, .csv, .yaml)

### Security
- **JWT-based authentication** with login page
- Default credentials: `admin` / `swarm2026`

## Quick Start

```bash
# Install server
cd server && npm install

# Install client
cd ../client && npm install

# Start server (terminal 1)
cd server && npm start

# Start client (terminal 2)
cd client && npm run dev
```

Open **http://localhost:5173** — login: `admin` / `swarm2026`

## Tech Stack

- **Backend**: Node.js, Express, Socket.IO, JWT
- **Frontend**: React 19, Vite 6, Tailwind CSS, Lucide Icons
- **LLM**: Anthropic SDK, Ollama API
