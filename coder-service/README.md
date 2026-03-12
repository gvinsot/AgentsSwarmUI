# coder-service

A Python FastAPI wrapper around the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) that lets you use your **Claude Max subscription** directly — no API key, no per-token billing.

## Why it exists

The Anthropic API charges per token. If you have a Claude Max subscription (the `claude` CLI), you can run coding tasks at no additional cost. `coder-service` bridges the gap: it exposes an HTTP endpoint that AgentsSwarmUI agents call to execute tasks, while internally spawning the `claude` CLI in headless mode.

## How it works

1. An agent sends a task prompt via `POST /execute`
2. `coder-service` spawns `claude --output-format stream-json --headless -p "<prompt>"` as a subprocess
3. The CLI authenticates using the locally logged-in Claude Max account (no `ANTHROPIC_API_KEY` needed)
4. JSON output is streamed back to the caller in real time
5. The agent receives the result and continues its work

## Configuration

| Variable | Default | Description |
|---|---|---|
| `API_KEY` | `change-me-in-production` | Shared secret for authenticating requests from the API server |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | Model to use (passed as `--model`) |
| `CLAUDE_MAX_TURNS` | `50` | Max agentic turns per task (`--max-turns`) |
| `TIMEOUT` | `600` | Subprocess timeout in seconds |
| `LOG_LEVEL` | `INFO` | Python logging level |
| `VERBOSE` | `false` | Enable verbose HTTP client logs |

## Docker usage

The container mounts the project repositories as volumes so Claude Code has full filesystem access:

```yaml
volumes:
  - /path/to/repos:/repos        # project source code
  - claude-config:/root/.config  # persists Claude CLI auth (login once)
```

The `claude` CLI must be authenticated before starting the container. Log in once interactively:

```bash
docker run -it --rm -v claude-config:/root/.config coder-service claude auth login
```

After that, all subsequent container starts reuse the stored credentials automatically.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/execute` | Run a task; streams NDJSON events |
| `GET` | `/health` | Health check |
