import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';

import agentsRouter from './routes/agents.js';
import authRouter from './routes/auth.js';
import templatesRouter from './routes/templates.js';
import projectsRouter from './routes/projects.js';
import pluginsRouter from './routes/plugins.js';
import mcpRouter from './routes/mcp.js';
import { setupSocket } from './ws/socketHandler.js';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/plugins', pluginsRouter);
app.use('/api/skills', pluginsRouter);
app.use('/api/mcp', mcpRouter);

setupSocket(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});