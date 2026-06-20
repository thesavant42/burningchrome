#!/usr/bin/env python3
"""
Generate a paginated HTML report from S3 bucket listing XML files.

Usage:
    python generate_report.py <input_dir> [output_html]

Examples:
    python generate_report.py ./test_export report.html
    python generate_report.py ./test_export report.html --items 100
"""

import os
import sys
import glob
import re
import argparse
from pathlib import Path


def parse_xml_files(input_dir: str):
    """Parse all page_*.xml files and extract items."""
    xml_files = sorted(glob.glob(os.path.join(input_dir, "page_*.xml")))
    
    if not xml_files:
        print(f"No page_*.xml files found in {input_dir}")
        sys.exit(1)
    
    print(f"Found {len(xml_files)} XML files")
    
    items = []
    seen_keys = set()
    bucket_name = "unknown"
    
    for xml_file in xml_files:
        with open(xml_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Extract bucket name from first file
        if not items:
            name_match = re.search(r'<Name>(.*?)</Name>', content)
            if name_match:
                bucket_name = name_match.group(1)
        
        # Extract all Contents blocks
        for match in re.finditer(r'<Contents>(.*?)</Contents>', content, re.DOTALL):
            block = match.group(0)
            key_match = re.search(r'<Key>(.*?)</Key>', block)
            size_match = re.search(r'<Size>(.*?)</Size>', block)
            modified_match = re.search(r'<LastModified>(.*?)</LastModified>', block)
            
            if key_match:
                key = key_match.group(1)
                if key and key not in seen_keys:
                    seen_keys.add(key)
                    items.append({
                        'key': key,
                        'size': int(size_match.group(1)) if size_match else 0,
                        'last_modified': modified_match.group(1) if modified_match else '',
                    })
    
    print(f"Extracted {len(items)} unique items from '{bucket_name}'")
    return bucket_name, items


def format_size(size_bytes):
    """Format bytes to human-readable size."""
    if size_bytes == 0:
        return "0 B"
    units = ['B', 'KB', 'MB', 'GB', 'TB']
    i = int(min(-1 * int(len(str(size_bytes)) - 1), 4))
    p = int(pow(1024, i))
    m = round(size_bytes / p, 1)
    return f"{m} {units[i]}"


def generate_html(bucket_name: str, items: list, output_file: str, items_per_page: int = 100):
    """Generate paginated HTML report."""
    total_pages = (len(items) + items_per_page - 1) // items_per_page
    import json
    items_json = json.dumps(items)
    
    html = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>__BUCKET__ - Bucket Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #1a1a2e; color: #eaeaea; padding: 20px; }
        .header { margin-bottom: 20px; padding: 15px; background: #16213e; border-radius: 8px; }
        .header h1 { font-size: 18px; color: #e94560; margin-bottom: 8px; }
        .header p { font-size: 13px; color: #a0a0a0; }
        .toolbar { margin-bottom: 15px; display: flex; gap: 10px; align-items: center; }
        .toolbar input { flex: 1; padding: 8px 12px; background: #0f3460; border: 1px solid #533483; color: #eaeaea; border-radius: 4px; font-size: 14px; }
        .toolbar button { padding: 8px 16px; background: #e94560; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; }
        .toolbar button:hover { background: #c73e54; }
        table { width: 100%; border-collapse: collapse; background: #16213e; border-radius: 8px; overflow: hidden; }
        th { background: #0f3460; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #a0a0a0; cursor: pointer; user-select: none; }
        th:hover { color: #e94560; }
        td { padding: 8px 12px; border-top: 1px solid #1a1a3e; font-size: 13px; }
        tr:hover td { background: #1a2a4e; }
        .key { color: #4fc3f7; word-break: break-all; }
        .pagination { margin-top: 15px; display: flex; gap: 8px; align-items: center; justify-content: center; }
        .pagination button { padding: 6px 12px; background: #0f3460; color: #eaeaea; border: 1px solid #533483; border-radius: 4px; cursor: pointer; }
        .pagination button:disabled { opacity: 0.3; cursor: not-allowed; }
        .pagination button:hover:not(:disabled) { background: #533483; }
        .pagination span { color: #a0a0a0; font-size: 13px; }
        .stats { margin-top: 10px; font-size: 12px; color: #a0a0a0; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <h1>__BUCKET__</h1>
        <p>__TOTAL__ items | __SIZE__ total</p>
    </div>
    <div class="toolbar">
        <input type="text" id="search" placeholder="Filter keys (e.g. data -css -png)..." />
        <button onclick="applyFilter()">Search</button>
    </div>
    <table>
        <thead>
            <tr>
                <th onclick="sortTable('key')">Key &#x25B4;&#x25BE;</th>
                <th onclick="sortTable('size')">Size &#x25B4;&#x25BE;</th>
                <th onclick="sortTable('last_modified')">Last Modified &#x25B4;&#x25BE;</th>
            </tr>
        </thead>
        <tbody id="tableBody"></tbody>
    </table>
    <div class="pagination" id="pagination"></div>
    <div class="stats" id="stats"></div>
    <script>
        const items = __ITEMS__;
        let filtered = [...items];
        let currentPage = 1;
        const perPage = __PERPAGE__;

        function formatSize(bytes) {
            if (bytes === 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(1024));
            return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
        }

        function formatDate(dateStr) {
            if (!dateStr) return '';
            return dateStr.replace('T', ' ').replace('Z', '');
        }

        function applyFilter() {
            const query = document.getElementById('search').value.toLowerCase().trim();
            if (!query) {
                filtered = [...items];
            } else {
                const parts = query.split(/\\s+/);
                const includes = parts.filter(p => !p.startsWith('-'));
                const excludes = parts.filter(p => p.startsWith('-')).map(p => p.slice(1));
                filtered = items.filter(item => {
                    const key = item.key.toLowerCase();
                    return includes.every(p => key.includes(p)) && !excludes.some(p => key.includes(p));
                });
            }
            currentPage = 1;
            render();
        }

        function sortTable(field) {
            filtered.sort((a, b) => {
                if (field === 'size') return sortAsc ? a[field] - b[field] : b[field] - a[field];
                return sortAsc ? a[field].localeCompare(b[field]) : b[field].localeCompare(a[field]);
            });
            sortAsc = !sortAsc;
            currentPage = 1;
            render();
        }

        function render() {
            const tbody = document.getElementById('tableBody');
            const pagination = document.getElementById('pagination');
            const stats = document.getElementById('stats');
            const totalPages = Math.ceil(filtered.length / perPage);
            const start = (currentPage - 1) * perPage;
            const end = Math.min(start + perPage, filtered.length);
            const pageItems = filtered.slice(start, end);

            tbody.innerHTML = pageItems.map(item =>
                '<tr><td class="key">' + item.key + '</td><td>' + formatSize(item.size) + '</td><td>' + formatDate(item.last_modified) + '</td></tr>'
            ).join('');

            let pagHtml = '';
            pagHtml += '<button ' + (currentPage === 1 ? 'disabled' : '') + ' onclick="goPage(' + (currentPage - 1) + ')">Prev</button>';
            pagHtml += '<span>Page ' + currentPage + ' of ' + (totalPages || 1) + '</span>';
            pagHtml += '<button ' + (currentPage === totalPages || totalPages === 0 ? 'disabled' : '') + ' onclick="goPage(' + (currentPage + 1) + ')">Next</button>';
            pagination.innerHTML = pagHtml;
            stats.textContent = 'Showing ' + (start + 1) + '-' + end + ' of ' + filtered.length.toLocaleString() + ' items';
        }

        function goPage(page) {
            const totalPages = Math.ceil(filtered.length / perPage);
            if (page >= 1 && page <= totalPages) { currentPage = page; render(); }
        }

        document.getElementById('search').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') applyFilter();
        });

        render();
    </script>
</body>
</html>"""

    total_size = sum(i['size'] for i in items)
    html = html.replace('__BUCKET__', bucket_name)
    html = html.replace('__TOTAL__', f'{len(items):,}')
    html = html.replace('__SIZE__', format_size(total_size))
    html = html.replace('__ITEMS__', items_json)
    html = html.replace('__PERPAGE__', str(items_per_page))
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html)
    
    print(f"Report saved to {output_file}")
    print(f"File size: {os.path.getsize(output_file) / 1024 / 1024:.1f} MB")
    print(f"Pages: {total_pages} ({items_per_page} items/page)")


def main():
    parser = argparse.ArgumentParser(description="Generate paginated HTML report from S3 bucket XML.")
    parser.add_argument("input_dir", help="Directory containing page_*.xml files")
    parser.add_argument("output", nargs="?", default="report.html", help="Output HTML file")
    parser.add_argument("--items", type=int, default=100, help="Items per page (default: 100)")
    args = parser.parse_args()
    
    bucket_name, items = parse_xml_files(args.input_dir)
    generate_html(bucket_name, items, args.output, items_per_page=args.items)


if __name__ == "__main__":
    main()
