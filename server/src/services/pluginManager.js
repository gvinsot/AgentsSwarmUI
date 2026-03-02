import { SkillManager } from './skillManager.js';

export class PluginManager {
  constructor() {
    this.skillManager = new SkillManager();
  }

  async loadFromDatabase() {
    return this.skillManager.loadFromDatabase();
  }

  async seedDefaults(defaultPlugins) {
    return this.skillManager.seedDefaults(defaultPlugins);
  }

  getAll() {
    return this.skillManager.getAll();
  }

  getById(id) {
    return this.skillManager.getById(id);
  }

  async create(plugin) {
    return this.skillManager.create(plugin);
  }

  async update(id, patch) {
    return this.skillManager.update(id, patch);
  }

  async delete(id) {
    return this.skillManager.delete(id);
  }
}