import { readdir, readFile, writeFile, access, stat, mkdir } from 'fs/promises';
import { join, dirname, relative } from 'path';
import { constants } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PROJECTS_BASE = '/projects';

// Tool definitions that will be injected into agent prompts
export const TOOL_DEFINITIONS = `
--- AVAILABLE TOOLS ---
You can interact with project files using these commands. Use the exact format shown.

@read_file(path) - Read contents of a file
  Example: @read_file(src/index.js)

@write_file(path, content) - Write content to a file (creates directories if needed)
  Example: @write_file(src/utils/helper.js, """
  export function helper() {
    return 'Hello';
  }
  """)

@list_dir(path) - List contents of a directory
  Example: @list_dir(src)

@search_files(pattern, query) - Search for text in files matching a glob pattern
  Example: @search_files(*.js, function authenticate)

@run_command(command) - Run a shell command in the project directory (read-only safe commands only)
  Example: @run_command(npm test)
  Example: @run_command(grep -r "TODO" src/)

@append_file(path, content) - Append content to end of a file
  Example: @append_file(CHANGELOG.md, """
  ## v1.0.1
  - Fixed bug
  """)

IMPORTANT:
- File paths are relative to the project root
- Always read files before modifying them
- Use multi-line content with triple quotes """content"""
- After making changes, verify by reading the file
`;

// Execute a tool command and return the result
export async function executeTool(toolName, args, projectPath) {
  const basePath = join(PROJECTS_BASE, projectPath);
  
  // Verify project exists
  try {
    await access(basePath, constants.R_OK);
  } catch {
    return { success: false, error: `Project path not accessible: ${projectPath}` };
  }
  
  try {
    switch (toolName) {
      case 'read_file':
        return await readFileFromProject(basePath, args[0]);
      
      case 'write_file':
        return await writeFileToProject(basePath, args[0], args[1]);
      
      case 'list_dir':
        return await listDirectory(basePath, args[0] || '.');
      
      case 'search_files':
        return await searchInFiles(basePath, args[0], args[1]);
      
      case 'run_command':
        return await runCommand(basePath, args[0]);
      
      case 'append_file':
        return await appendToFile(basePath, args[0], args[1]);
      
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function readFileFromProject(basePath, filePath) {
  const fullPath = join(basePath, filePath);
  
  // Security: ensure path is within project
  if (!fullPath.startsWith(basePath)) {
    return { success: false, error: 'Path traversal not allowed' };
  }
  
  try {
    const content = await readFile(fullPath, 'utf-8');
    const stats = await stat(fullPath);
    return { 
      success: true, 
      result: content,
      meta: { path: filePath, size: stats.size, lines: content.split('\n').length }
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { success: false, error: `File not found: ${filePath}` };
    }
    throw err;
  }
}

async function writeFileToProject(basePath, filePath, content) {
  const fullPath = join(basePath, filePath);
  
  // Security: ensure path is within project
  if (!fullPath.startsWith(basePath)) {
    return { success: false, error: 'Path traversal not allowed' };
  }
  
  // Create directory if needed
  const dir = dirname(fullPath);
  await mkdir(dir, { recursive: true });
  
  await writeFile(fullPath, content, 'utf-8');
  const stats = await stat(fullPath);
  
  return { 
    success: true, 
    result: `File written: ${filePath} (${stats.size} bytes)`,
    meta: { path: filePath, size: stats.size }
  };
}

async function listDirectory(basePath, dirPath) {
  const fullPath = join(basePath, dirPath);
  
  if (!fullPath.startsWith(basePath)) {
    return { success: false, error: 'Path traversal not allowed' };
  }
  
  const entries = await readdir(fullPath, { withFileTypes: true });
  const items = entries
    .filter(e => !e.name.startsWith('.'))
    .map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file'
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  
  const result = items.map(i => `${i.type === 'dir' ? '📁' : '📄'} ${i.name}`).join('\n');
  return { 
    success: true, 
    result: result || '(empty directory)',
    meta: { path: dirPath, count: items.length }
  };
}

async function searchInFiles(basePath, pattern, query) {
  // Use grep for searching (available on Linux/Docker)
  try {
    const { stdout } = await execAsync(
      `grep -r -l -i "${query.replace(/"/g, '\\"')}" --include="${pattern}" . 2>/dev/null | head -20`,
      { cwd: basePath, timeout: 10000 }
    );
    
    const files = stdout.trim().split('\n').filter(Boolean);
    
    if (files.length === 0) {
      return { success: true, result: 'No matches found' };
    }
    
    // Get context for each match (first 3 files)
    const results = [];
    for (const file of files.slice(0, 5)) {
      const cleanPath = file.replace('./', '');
      try {
        const { stdout: grepOut } = await execAsync(
          `grep -n -i "${query.replace(/"/g, '\\"')}" "${file}" | head -5`,
          { cwd: basePath, timeout: 5000 }
        );
        results.push(`📄 ${cleanPath}:\n${grepOut.trim()}`);
      } catch {
        results.push(`📄 ${cleanPath}`);
      }
    }
    
    if (files.length > 5) {
      results.push(`... and ${files.length - 5} more files`);
    }
    
    return { 
      success: true, 
      result: results.join('\n\n'),
      meta: { matches: files.length, query }
    };
  } catch (err) {
    if (err.code === 1) {
      // grep returns 1 when no matches
      return { success: true, result: 'No matches found' };
    }
    return { success: false, error: err.message };
  }
}

async function runCommand(basePath, command) {
  // Security: block dangerous commands
  const blockedPatterns = [
    /rm\s+-rf/i,
    /rm\s+.*\//i,
    /curl.*\|.*sh/i,
    /wget.*\|.*sh/i,
    />\s*\/dev/i,
    /dd\s+if=/i,
    /mkfs/i,
    /format/i,
  ];
  
  for (const pattern of blockedPatterns) {
    if (pattern.test(command)) {
      return { success: false, error: 'Command blocked for security reasons' };
    }
  }
  
  try {
    const { stdout, stderr } = await execAsync(command, { 
      cwd: basePath, 
      timeout: 30000,
      maxBuffer: 1024 * 1024 // 1MB
    });
    
    const output = stdout || stderr || '(no output)';
    return { 
      success: true, 
      result: output.slice(0, 10000), // Limit output size
      meta: { command, truncated: output.length > 10000 }
    };
  } catch (err) {
    return { 
      success: false, 
      error: err.message,
      result: err.stderr || err.stdout
    };
  }
}

async function appendToFile(basePath, filePath, content) {
  const fullPath = join(basePath, filePath);
  
  if (!fullPath.startsWith(basePath)) {
    return { success: false, error: 'Path traversal not allowed' };
  }
  
  // Create directory if needed
  const dir = dirname(fullPath);
  await mkdir(dir, { recursive: true });
  
  // Read existing content if file exists
  let existing = '';
  try {
    existing = await readFile(fullPath, 'utf-8');
  } catch {
    // File doesn't exist, that's fine
  }
  
  const newContent = existing + (existing.endsWith('\n') ? '' : '\n') + content;
  await writeFile(fullPath, newContent, 'utf-8');
  
  return { 
    success: true, 
    result: `Content appended to: ${filePath}`,
    meta: { path: filePath }
  };
}

// Parse tool calls from agent response
export function parseToolCalls(response) {
  const toolCalls = [];
  
  // Pattern for single-arg tools: @tool_name(arg)
  const singleArgPattern = /@(read_file|list_dir|run_command)\s*\(\s*([^)]+)\s*\)/gi;
  
  // Pattern for two-arg tools with multi-line content: @tool_name(path, """content""")
  const multiLinePattern = /@(write_file|append_file)\s*\(\s*([^,]+?)\s*,\s*"""([\s\S]*?)"""\s*\)/gi;
  
  // Pattern for search: @search_files(pattern, query)
  const searchPattern = /@search_files\s*\(\s*([^,]+?)\s*,\s*([^)]+)\s*\)/gi;
  
  let match;
  
  // Parse single-arg tools
  while ((match = singleArgPattern.exec(response)) !== null) {
    toolCalls.push({
      tool: match[1].toLowerCase(),
      args: [match[2].trim()]
    });
  }
  
  // Parse multi-line tools
  while ((match = multiLinePattern.exec(response)) !== null) {
    toolCalls.push({
      tool: match[1].toLowerCase(),
      args: [match[2].trim(), match[3]]
    });
  }
  
  // Parse search
  while ((match = searchPattern.exec(response)) !== null) {
    toolCalls.push({
      tool: 'search_files',
      args: [match[1].trim(), match[2].trim()]
    });
  }
  
  return toolCalls;
}
