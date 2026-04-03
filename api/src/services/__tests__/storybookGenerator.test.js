import { describe, test, expect } from '@jest/globals';
import { generateStorybook, getComponentsJSON } from '../storybookGenerator.js';

describe('StorybookGenerator', () => {
  test('should generate HTML with valid structure', async () => {
    const { html, components } = await generateStorybook();
    
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>PulsarTeam Storybook</title>');
    expect(html).toContain('Download JSON');
    expect(html).toContain('component-card');
    expect(html).toContain('category-section');
  });

  test('should discover components from frontend/src/components', async () => {
    const components = await getComponentsJSON();
    
    expect(Array.isArray(components)).toBe(true);
    expect(components.length).toBeGreaterThan(0);
    
    // Check component structure
    const firstComponent = components[0];
    expect(firstComponent).toHaveProperty('name');
    expect(firstComponent).toHaveProperty('fileName');
    expect(firstComponent).toHaveProperty('category');
    expect(firstComponent).toHaveProperty('description');
  });

  test('should group components by category', async () => {
    const { html } = await generateStorybook();
    
    // Check that categories are present in the HTML
    expect(html).toContain('category-section');
    expect(html).toContain('category-title');
  });

  test('should include JSON download functionality', async () => {
    const { html } = await generateStorybook();
    
    expect(html).toContain('downloadJSON');
    expect(html).toContain('application/json');
    expect(html).toContain('pulsar-components');
  });

  test('should embed component data in HTML', async () => {
    const { html, components } = await generateStorybook();
    
    // The component data should be embedded as JSON in the script
    const componentDataString = JSON.stringify(components);
    expect(html).toContain(componentDataString.substring(0, 100));
  });
});