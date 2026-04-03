# PulsarTeam Storybook

A visual component documentation and preview system for the PulsarTeam frontend.

## Overview

The Storybook generator creates an interactive HTML page that displays all React components from the `frontend/src/components` directory, organized by category with metadata extraction.

## Features

### US-1: Visualisation des composants
- All components are displayed in a visually organized grid layout
- Each component card shows:
  - Component name
  - File name
  - Description (extracted from JSDoc or auto-generated)
  - Props (if available)
  - File path

### US-2: Téléchargement JSON
- **Download JSON Button**: Download all component data as a JSON file
- **Preview JSON Button**: View the raw JSON data in a modal
- JSON file includes:
  - Component names
  - File paths
  - Descriptions
  - Categories
  - Props with types and required status

### US-3: Navigation par catégorie
- Components are automatically categorized based on:
  - JSDoc `@category` tag (if present)
  - Filename patterns (e.g., "Agent", "Task", "Modal")
- Sticky navigation bar with links to each category
- Smooth scrolling between sections

## API Endpoints

### GET `/api/storybook`
Generate and serve the Storybook HTML page.

**Authentication**: Required (JWT token)

**Response**: HTML page with embedded component data

### GET `/api/storybook/json`
Return components data as JSON.

**Authentication**: Required (JWT token)

**Response**: JSON array of component metadata

**Headers**:
- `Content-Type: application/json`
- `Content-Disposition: attachment; filename="pulsar-components.json"`

### GET `/api/storybook/download`
Download the Storybook HTML as a file.

**Authentication**: Required (JWT token)

**Response**: HTML file download

**Headers**:
- `Content-Type: text/html; charset=utf-8`
- `Content-Disposition: attachment; filename="storybook-YYYY-MM-DD.html"`

### POST `/api/storybook/generate`
Generate and save the Storybook to files.

**Authentication**: Required (JWT token)

**Request Body**:
```json
{
  "outputDir": "dist/storybook"
}
```

**Response**:
```json
{
  "success": true,
  "outputPath": "dist/storybook/index.html",
  "jsonPath": "dist/storybook/components.json",
  "components": 25,
  "message": "Storybook generated at dist/storybook/index.html"
}
```

## Usage

### Access the Storybook

1. Start the API server:
   ```bash
   cd api
   npm start
   ```

2. Navigate to: `http://localhost:3001/api/storybook`

3. Authenticate with your JWT token

### Generate Storybook Files

```bash
curl -X POST http://localhost:3001/api/storybook/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"outputDir": "dist/storybook"}'
```

### Download JSON Data

```bash
curl -X GET http://localhost:3001/api/storybook/json \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o components.json
```

## Component Metadata Extraction

The Storybook generator extracts the following information from each component:

### Name
Extracted from:
- `export default function ComponentName`
- `export default ComponentName`
- `const ComponentName = function` or `const ComponentName = ()`

### Description
Extracted from:
- JSDoc `@description` tag
- First line of JSDoc comment
- Auto-generated: "The [ComponentName] component."

### Category
Determined by:
- JSDoc `@category` tag
- Filename patterns:
  - `Agent*` → "Agent"
  - `Task*`, `*Board` → "Tasks"
  - `Project*` → "Projects"
  - `*Modal`, `*Dialog` → "Modals"
  - `*Dashboard`, `*Stats` → "Dashboard"
  - `*Chat`, `*Voice` → "Communication"
  - `*Setting`, `*Config` → "Settings"
  - `Login*`, `*Auth` → "Authentication"
  - Default → "General"

### Props
Extracted from `propTypes` definitions:
```javascript
MyComponent.propTypes = {
  name: PropTypes.string.isRequired,
  age: PropTypes.number,
  status: PropTypes.oneOf(['active', 'inactive'])
};
```

## JSON Output Format

```json
[
  {
    "name": "Dashboard",
    "fileName": "Dashboard.jsx",
    "filePath": "frontend/src/components/Dashboard.jsx",
    "description": "The Dashboard component displays the main overview.",
    "category": "Dashboard",
    "props": [
      {
        "name": "user",
        "type": "Object",
        "required": true
      },
      {
        "name": "agents",
        "type": "Array",
        "required": true
      }
    ],
    "createdAt": "2025-01-15T10:30:00.000Z"
  }
]
```

## Styling

The Storybook uses a dark theme matching the PulsarTeam design:

- **Primary Background**: `#0f172a`
- **Secondary Background**: `#1e293b`
- **Card Background**: `#334155`
- **Primary Text**: `#f1f5f9`
- **Secondary Text**: `#94a3b8`
- **Accent Color**: `#6366f1`

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

No external dependencies required - all styles and scripts are embedded in the HTML.

## Performance

- **Generation Time**: < 5 seconds for typical component libraries
- **File Size**: ~50-100KB for 20-30 components
- **No Build Step**: Pure JavaScript, no compilation required

## Adding Documentation to Components

To improve the Storybook output, add JSDoc comments to your components:

```jsx
/**
 * @description The AgentCard component displays individual agent information
 * @category Agent
 */
export default function AgentCard({ agent, onEdit }) {
  // ...
}
```

## Testing

Run the unit tests:

```bash
cd api
npm test -- storybookGenerator
```

## Future Enhancements

- [ ] Live component preview with interactive props
- [ ] Component usage examples
- [ ] Search functionality
- [ ] Export to multiple formats (Markdown, PDF)
- [ ] Integration with component testing frameworks