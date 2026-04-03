import fs from 'fs/promises';
import path from 'path';

/**
 * Storybook Generator Service
 * Generates an interactive HTML page displaying all frontend components
 * with JSON download capability
 */

const COMPONENTS_DIR = path.resolve(process.cwd(), 'frontend/src/components');

/**
 * Parse component file to extract metadata (name, description, props)
 */
async function parseComponentMetadata(filePath, fileName) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    
    // Extract component name from file
    const nameMatch = content.match(/export\s+(?:default\s+)?function\s+(\w+)/) ||
                      content.match(/export\s+default\s+(\w+)/) ||
                      content.match(/const\s+(\w+)\s*=\s*(?:function|\()/);
    const componentName = nameMatch ? nameMatch[1] : fileName.replace('.jsx', '').replace('.js', '');
    
    // Extract JSDoc description
    const descMatch = content.match(/\/\*\*[\s\S]*?\*\/\s*(?:export|const|function)/);
    let description = '';
    if (descMatch) {
      const jsdoc = descMatch[0];
      const descLine = jsdoc.match(/@description\s+(.+?)(?:\n\s*\*|\*\/)/);
      description = descLine ? descLine[1].trim() : '';
      if (!description) {
        // Try to extract first line of JSDoc
        const firstLine = jsdoc.match(/\/\*\*\s*\n\s*\*\s*(.+?)(?:\n\s*\*|\*\/)/);
        description = firstLine ? firstLine[1].trim() : '';
      }
    }
    
    // Extract category from JSDoc @category or infer from filename
    const categoryMatch = content.match(/@category\s+(\w+)/i);
    let category = categoryMatch ? categoryMatch[1] : 'General';
    
    // Infer category from filename patterns
    if (!categoryMatch) {
      if (fileName.includes('Agent')) category = 'Agent';
      else if (fileName.includes('Task') || fileName.includes('Board')) category = 'Tasks';
      else if (fileName.includes('Project')) category = 'Projects';
      else if (fileName.includes('Modal') || fileName.includes('Dialog')) category = 'Modals';
      else if (fileName.includes('Dashboard') || fileName.includes('Stats')) category = 'Dashboard';
      else if (fileName.includes('Chat') || fileName.includes('Voice')) category = 'Communication';
      else if (fileName.includes('Setting') || fileName.includes('Config')) category = 'Settings';
      else if (fileName.includes('Login') || fileName.includes('Auth')) category = 'Authentication';
    }
    
    // Extract props if available
    const props = [];
    const propTypesMatch = content.match(/propTypes\s*=\s*\{([\s\S]*?)\}/);
    if (propTypesMatch) {
      const propLines = propTypesMatch[1].split('\n');
      for (const line of propLines) {
        const propMatch = line.match(/(\w+)\s*:\s*(?:PropTypes\.)?(\w+)(?:\.(?:isRequired|oneOf\([^)]+\)))?/);
        if (propMatch) {
          props.push({
            name: propMatch[1],
            type: propMatch[2],
            required: line.includes('isRequired')
          });
        }
      }
    }
    
    return {
      name: componentName,
      fileName,
      filePath: path.relative(process.cwd(), filePath),
      description: description || `The ${componentName} component.`,
      category,
      props,
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error parsing ${fileName}:`, error.message);
    return {
      name: fileName.replace('.jsx', '').replace('.js', ''),
      fileName,
      filePath: path.relative(process.cwd(), filePath),
      description: 'No description available.',
      category: 'General',
      props: [],
      error: error.message
    };
  }
}

/**
 * Discover all component files in the components directory
 */
async function discoverComponents() {
  try {
    const entries = await fs.readdir(COMPONENTS_DIR, { withFileTypes: true });
    const componentFiles = entries
      .filter(entry => entry.isFile() && (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')))
      .map(entry => entry.name);
    
    const components = [];
    for (const fileName of componentFiles) {
      const filePath = path.join(COMPONENTS_DIR, fileName);
      const metadata = await parseComponentMetadata(filePath, fileName);
      components.push(metadata);
    }
    
    // Sort by category, then by name
    components.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name);
    });
    
    return components;
  } catch (error) {
    console.error('Error discovering components:', error.message);
    return [];
  }
}

/**
 * Group components by category
 */
function groupByCategory(components) {
  const groups = {};
  for (const component of components) {
    if (!groups[component.category]) {
      groups[component.category] = [];
    }
    groups[component.category].push(component);
  }
  return groups;
}

/**
 * Generate the HTML content for the Storybook
 */
function generateHTML(components) {
  const grouped = groupByCategory(components);
  const categories = Object.keys(grouped).sort();
  
  const componentCards = categories.map(category => {
    const componentsInCategory = grouped[category];
    return `
      <div class="category-section" id="category-${category.toLowerCase()}">
        <h2 class="category-title">${category}</h2>
        <div class="component-grid">
          ${componentsInCategory.map(comp => `
            <div class="component-card" data-name="${comp.name}">
              <div class="card-header">
                <h3 class="component-name">${comp.name}</h3>
                <span class="file-name">${comp.fileName}</span>
              </div>
              <p class="component-description">${comp.description}</p>
              ${comp.props.length > 0 ? `
                <div class="props-section">
                  <h4>Props</h4>
                  <div class="props-list">
                    ${comp.props.map(prop => `
                      <span class="prop-tag ${prop.required ? 'required' : ''}">
                        ${prop.name}: ${prop.type}${prop.required ? ' *' : ''}
                      </span>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              <div class="card-footer">
                <code>${comp.filePath}</code>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
  
  const categoryNav = categories.map(cat => 
    `<a href="#category-${cat.toLowerCase()}" class="nav-link">${cat}</a>`
  ).join('');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PulsarTeam Storybook</title>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-card: #334155;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      --border: #475569;
      --success: #22c55e;
      --warning: #eab308;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }
    
    header {
      text-align: center;
      padding: 3rem 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 2rem;
    }
    
    h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, var(--accent), #a855f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .subtitle {
      color: var(--text-secondary);
      font-size: 1.1rem;
    }
    
    .actions {
      display: flex;
      justify-content: center;
      gap: 1rem;
      margin-top: 1.5rem;
    }
    
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
      text-decoration: none;
    }
    
    .btn-primary {
      background: var(--accent);
      color: white;
    }
    
    .btn-primary:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
    }
    
    .btn-secondary {
      background: var(--bg-card);
      color: var(--text-primary);
      border: 1px solid var(--border);
    }
    
    .btn-secondary:hover {
      background: var(--bg-secondary);
    }
    
    .stats {
      display: flex;
      justify-content: center;
      gap: 2rem;
      margin-top: 1.5rem;
      flex-wrap: wrap;
    }
    
    .stat-item {
      text-align: center;
    }
    
    .stat-value {
      font-size: 2rem;
      font-weight: bold;
      color: var(--accent);
    }
    
    .stat-label {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    
    /* Navigation */
    .nav {
      position: sticky;
      top: 0;
      background: var(--bg-secondary);
      padding: 1rem 0;
      border-bottom: 1px solid var(--border);
      z-index: 100;
      overflow-x: auto;
    }
    
    .nav-links {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 1rem;
    }
    
    .nav-link {
      color: var(--text-secondary);
      text-decoration: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-size: 0.9rem;
      transition: all 0.2s;
      white-space: nowrap;
    }
    
    .nav-link:hover {
      color: var(--text-primary);
      background: var(--bg-card);
    }
    
    /* Category Sections */
    .category-section {
      margin-bottom: 3rem;
    }
    
    .category-title {
      font-size: 1.75rem;
      margin-bottom: 1.5rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid var(--accent);
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    
    .category-title::before {
      content: '#';
      color: var(--accent);
    }
    
    /* Component Grid */
    .component-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 1.5rem;
    }
    
    .component-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      transition: all 0.2s;
    }
    
    .component-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(99, 102, 241, 0.15);
    }
    
    .card-header {
      margin-bottom: 1rem;
    }
    
    .component-name {
      font-size: 1.25rem;
      color: var(--text-primary);
      margin-bottom: 0.25rem;
    }
    
    .file-name {
      font-size: 0.8rem;
      color: var(--text-secondary);
      font-family: 'Monaco', 'Consolas', monospace;
    }
    
    .component-description {
      color: var(--text-secondary);
      margin-bottom: 1rem;
      font-size: 0.95rem;
    }
    
    .props-section {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
    }
    
    .props-section h4 {
      font-size: 0.85rem;
      color: var(--text-secondary);
      margin-bottom: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .props-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    
    .prop-tag {
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      background: var(--bg-card);
      font-family: 'Monaco', 'Consolas', monospace;
    }
    
    .prop-tag.required {
      border-left: 2px solid var(--warning);
    }
    
    .card-footer {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
    }
    
    .card-footer code {
      font-size: 0.75rem;
      color: var(--text-secondary);
      font-family: 'Monaco', 'Consolas', monospace;
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    /* JSON Preview Modal */
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    
    .modal.active {
      display: flex;
    }
    
    .modal-content {
      background: var(--bg-secondary);
      border-radius: 12px;
      max-width: 800px;
      width: 100%;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
    }
    
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    
    .modal-header h3 {
      font-size: 1.25rem;
    }
    
    .close-btn {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0.25rem;
      line-height: 1;
    }
    
    .close-btn:hover {
      color: var(--text-primary);
    }
    
    .modal-body {
      padding: 1.5rem;
      overflow: auto;
      flex: 1;
    }
    
    pre {
      background: var(--bg-primary);
      padding: 1rem;
      border-radius: 8px;
      overflow: auto;
      font-size: 0.85rem;
      line-height: 1.5;
    }
    
    /* Footer */
    footer {
      text-align: center;
      padding: 2rem;
      color: var(--text-secondary);
      border-top: 1px solid var(--border);
      margin-top: 3rem;
    }
    
    /* Responsive */
    @media (max-width: 768px) {
      .container {
        padding: 1rem;
      }
      
      h1 {
        font-size: 1.75rem;
      }
      
      .component-grid {
        grid-template-columns: 1fr;
      }
      
      .stats {
        gap: 1rem;
      }
    }
    
    /* Animations */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .component-card {
      animation: fadeIn 0.3s ease-out;
    }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>📚 PulsarTeam Storybook</h1>
      <p class="subtitle">Interactive component documentation and preview</p>
      
      <div class="actions">
        <button class="btn btn-primary" onclick="downloadJSON()">
          ⬇️ Download JSON
        </button>
        <button class="btn btn-secondary" onclick="showJSONPreview()">
          👁️ Preview JSON
        </button>
      </div>
      
      <div class="stats">
        <div class="stat-item">
          <div class="stat-value">${components.length}</div>
          <div class="stat-label">Components</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${categories.length}</div>
          <div class="stat-label">Categories</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${new Date().toLocaleDateString()}</div>
          <div class="stat-label">Generated</div>
        </div>
      </div>
    </div>
  </header>
  
  <nav class="nav">
    <div class="nav-links">
      <a href="#" class="nav-link">↑ Top</a>
      ${categoryNav}
    </div>
  </nav>
  
  <main class="container">
    ${componentCards}
  </main>
  
  <footer>
    <p>Generated by PulsarTeam Storybook Generator</p>
    <p style="margin-top: 0.5rem; font-size: 0.85rem;">
      Components are organized by category. Click "Download JSON" to export all component data.
    </p>
  </footer>
  
  <!-- JSON Preview Modal -->
  <div class="modal" id="jsonModal">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Component Data (JSON)</h3>
        <button class="close-btn" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <pre id="jsonPreview"></pre>
      </div>
    </div>
  </div>
  
  <script>
    // Component data embedded in the page
    const componentData = ${JSON.stringify(components, null, 2)};
    
    // Download JSON functionality
    function downloadJSON() {
      const dataStr = JSON.stringify(componentData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pulsar-components-' + new Date().toISOString().split('T')[0] + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    
    // Show JSON preview modal
    function showJSONPreview() {
      const modal = document.getElementById('jsonModal');
      const preview = document.getElementById('jsonPreview');
      preview.textContent = JSON.stringify(componentData, null, 2);
      modal.classList.add('active');
    }
    
    // Close modal
    function closeModal() {
      document.getElementById('jsonModal').classList.remove('active');
    }
    
    // Close modal on outside click
    document.getElementById('jsonModal').addEventListener('click', function(e) {
      if (e.target === this) {
        closeModal();
      }
    });
    
    // Close modal on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeModal();
      }
    });
    
    // Smooth scroll for navigation
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        const href = this.getAttribute('href');
        if (href !== '#') {
          e.preventDefault();
          const target = document.querySelector(href);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      });
    });
  </script>
</body>
</html>`;
}

/**
 * Generate the Storybook HTML file
 * @param {string} outputPath - Path to save the HTML file
 * @returns {Promise<{html: string, components: Array, outputPath: string}>}
 */
export async function generateStorybook(outputPath = null) {
  const components = await discoverComponents();
  const html = generateHTML(components);
  
  if (outputPath) {
    await fs.writeFile(outputPath, html, 'utf8');
    console.log(`Storybook generated: ${outputPath}`);
  }
  
  return {
    html,
    components,
    outputPath
  };
}

/**
 * Get components data as JSON
 * @returns {Promise<Array>}
 */
export async function getComponentsJSON() {
  return await discoverComponents();
}

export default {
  generateStorybook,
  getComponentsJSON,
  discoverComponents
};