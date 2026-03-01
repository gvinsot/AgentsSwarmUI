import express from 'express';

export function skillRoutes(skillManager) {
  const router = express.Router();

  // List all skills (marketplace)
  router.get('/', (req, res) => {
    res.json(skillManager.getAll());
  });

  // Get single skill
  router.get('/:id', (req, res) => {
    const skill = skillManager.getById(req.params.id);
    if (!skill) return res.status(404).json({ error: 'Skill not found' });
    res.json(skill);
  });

  // Create custom skill
  router.post('/', async (req, res) => {
    try {
      const { name, description, category, icon, instructions } = req.body;
      if (!name || !instructions) {
        return res.status(400).json({ error: 'Name and instructions required' });
      }
      const skill = await skillManager.create({ name, description, category, icon, instructions });
      res.status(201).json(skill);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update skill
  router.put('/:id', async (req, res) => {
    try {
      const skill = await skillManager.update(req.params.id, req.body);
      if (!skill) return res.status(404).json({ error: 'Skill not found' });
      res.json(skill);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete skill
  router.delete('/:id', async (req, res) => {
    try {
      const success = await skillManager.delete(req.params.id);
      if (!success) return res.status(404).json({ error: 'Skill not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
