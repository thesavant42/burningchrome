import { apiKeys } from './lib/storage.js';

async function init() {
  await loadExistingKeys();
  document.getElementById('saveConfig').addEventListener('click', saveConfig);
}

async function loadExistingKeys() {
  const vtKey = await apiKeys.get('virustotal');
  const shodanKey = await apiKeys.get('shodan');
  const ghToken = await apiKeys.get('github');
  
  if (vtKey) document.getElementById('vtApiKey').value = vtKey;
  if (shodanKey) document.getElementById('shodanApiKey').value = shodanKey;
  if (ghToken) document.getElementById('githubToken').value = ghToken;
}

async function saveConfig() {
  const vtKey = document.getElementById('vtApiKey').value.trim();
  const shodanKey = document.getElementById('shodanApiKey').value.trim();
  const ghToken = document.getElementById('githubToken').value.trim();
  const statusEl = document.getElementById('saveStatus');
  
  try {
    if (vtKey) {
      await apiKeys.set('virustotal', vtKey);
    } else {
      await apiKeys.remove('virustotal');
    }
    
    if (shodanKey) {
      await apiKeys.set('shodan', shodanKey);
    } else {
      await apiKeys.remove('shodan');
    }
    
    if (ghToken) {
      await apiKeys.set('github', ghToken);
    } else {
      await apiKeys.remove('github');
    }
    
    statusEl.textContent = 'Saved!';
    statusEl.style.color = 'var(--green)';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.style.color = 'var(--red)';
  }
}

init();

