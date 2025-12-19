export function download(content, filename, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
}

export function saveHtml(domain, suffix = '') {
  download(document.documentElement.outerHTML, `${domain}${suffix}.html`, 'text/html');
}

export function saveJson(domain, data, suffix = '') {
  download(JSON.stringify(data, null, 2), `${domain}${suffix}.json`, 'application/json');
}

