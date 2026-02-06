import express from 'express';
import { readdir, access } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';

export function projectRoutes() {
  const router = express.Router();

  // List all project directories from HOST_CODE_PATH
  router.get('/', async (req, res) => {
    try {
      // Try /projects first (Docker mount), then HOST_CODE_PATH, then return empty
      let basePath = '/projects';
      
      try {
        await access(basePath, constants.R_OK);
      } catch {
        basePath = process.env.HOST_CODE_PATH;
        if (basePath) {
          try {
            await access(basePath, constants.R_OK);
          } catch {
            // Neither path accessible, return empty list
            return res.json([]);
          }
        } else {
          // No path configured, return empty list
          return res.json([]);
        }
      }
      
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
      // Return empty list instead of error to not break the UI
      res.json([]);
    }
  });

  return router;
}
