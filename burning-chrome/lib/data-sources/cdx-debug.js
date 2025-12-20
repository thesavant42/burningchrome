// CDX Debug logging utilities
// Shared state for debug log collection during CDX operations

let cdxDebugLog = [];

export function addDebug(msg) {
  const ts = new Date().toISOString().split('T')[1].split('.')[0];
  cdxDebugLog.push(`[${ts}] ${msg}`);
  console.log(`[CDX] ${msg}`);
}

export function getDebugLog() {
  return cdxDebugLog.join('\n');
}

export function clearDebugLog() {
  cdxDebugLog = [];
}

