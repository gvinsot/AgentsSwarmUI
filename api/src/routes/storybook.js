import express from 'express';
import { generateStorybook, getComponentsJSON } from '../services/storybookGenerator.js';
import path from 'path';
import fs from 'fs/promises';

export function storybookRoutes() {
  const router = express.Router();

  /**
   * GET /storybook
   * Generate and serve the Storybook HTML page
   */
  router.get('/', async (req, res) => {
    try {
      const { html, components } = await generateStorybook();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      console.error('Error generating storybook:', error);
      res.status(500).json({ error: 'Failed to generate storybook', message: error.message });
    }
  });

  /**
   * GET /storybook/json
   * Return components data as JSON
   */
  router.get('/json', async (req, res) => {
    try {
      const components = await getComponentsJSON();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="pulsar-components.json"');
      res.json(components);
    } catch (error) {
      console.error('Error fetching components JSON:', error);
      res.status(500).json({ error: 'Failed to fetch components', message: error.message });
    }
  });

  /**
   * GET /storybook/download
   * Download the Storybook HTML as a file
   */
  router.get('/download', async (req, res) => {
    try {
      const { html } = await generateStorybook();
      const timestamp = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="storybook-${timestamp}.html"`);
      res.send(html);
    } catch (error) {
      console.error('Error generating storybook download:', error);
      res.status(500).json({ error: 'Failed to generate storybook', message: error.message });
    }
  });

  /**
   * POST /storybook/generate
   * Generate and save the Storybook to a file
   */
  router.post('/generate', async (req, res) => {
    try {
      const { outputDir = 'dist/storybook' } = req.body || {};
      
      // Create output directory if needed
      await fs.mkdir(outputDir, { recursive: true });
      
      const outputPath = path.join(outputDir, 'index.html');
      const { html, components } = await generateStorybook(outputPath);
      
      // Also save JSON separately
      const jsonPath = path.join(outputDir, 'components.json');
      await fs.writeFile(jsonPath, JSON.stringify(components, null, 2), 'utf8');
      
      res.json({
        success: true,
        outputPath,
        jsonPath,
        components: components.length,
        message: `Storybook generated at ${outputPath}`
      });
    } catch (error) {
      console.error('Error generating storybook:', error);
      res.status(500).json({ error: 'Failed to generate storybook', message: error.message });
    }
  });

  return router;
}

export default { storybookRoutes };