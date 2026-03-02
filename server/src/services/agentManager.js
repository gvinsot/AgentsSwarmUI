[existing content]
// ─── File System Handoff ────────────────────────────────────────────────────────
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

async function transferUserFiles(fromId, toId) {
  const tempDir = path.join('/tmp', `handoff-${uuidv4()}`);
  const fromHomeDir = `/home/${fromId}`;
  const toHomeDir = `/home/${toId}`;

  try {
    // Create temporary directory
    await fs.mkdir(tempDir, { recursive: true });

    // Copy files from original user's home directory
    await fs.cp(fromHomeDir, tempDir, { recursive: true });

    // Change ownership to receiving agent
    await fs.chmod(tempDir, 0o755);
    await fs.chownr(tempDir, toId, toId);

    // Move files to receiving agent's home directory
    await fs.rename(tempDir, toHomeDir);

    return { success: true, message: 'File system handoff completed successfully' };
  } catch (error) {
    console.error('File system handoff failed:', error);
    // Clean up temporary directory if it exists
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
    return { success: false, message: error.message };
  }
}

// Modified handoff method to include file system transfer
async handoff(fromId, toId, context, streamCallback) {
  // Existing handoff logic
  const handoffMessage = `[HANDOFF from ${fromAgent.name}]: ${context}\n\nPrevious conversation context:\n${
    previousContext.join('\n')
  }`;

  this._emit('agent:handoff', {
    fromId,
    toId,
    context,
    timestamp: new Date().toISOString()
  });

  // Add file system transfer
  const fileTransferResult = await transferUserFiles(fromId, toId);

  // Include file transfer status in response
  const response = await this.sendMessage(toId, handoffMessage, streamCallback);

  return {
    ...response,
    fileTransfer: fileTransferResult
  };
}