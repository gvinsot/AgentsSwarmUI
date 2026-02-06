import express from 'express';
import { readdir } from 'fs/promises';
import { join } from 'path';

export function projectRoutes() {
  const router = express.Router();

  // List all project directories from HOST_CODE_PATH
  router.get('/', async (req, res) => {
    try {
      // In Docker, projects are mounted at /projects; locally use HOST_CODE_PATH
      const basePath = process.env.HOST_CODE_PATH 
        ? (process.env.NODE_ENV === 'production' ? '/projects' : process.env.HOST_CODE_PATH)
        : '/projects';
      
      const entries = await readdir(basePath, { withFileTypes: true });
      const projects = entries
        .filter(entry => entry.isDirectory())
        .filter(entry => !entry.name.startsWith('.')) // Skip hidden directories
        .map(entry => ({
          name: entry.name,
          path: join(basePath, entry.name)
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json(projects);
    } catch (err) {
      console.error('Failed to list projects:', err);
      res.status(500).json({ error: 'Failed to list projects', details: err.message });
    }
  });

  return router;
}
