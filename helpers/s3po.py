#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
s3po.py
Mirror / index a *public* S3 (or S3-compatible) bucket using the XML ListObjectsV2 API.

✔ Accepts either a bucket name *or* a full https:// endpoint as the positional arg
✔ --endpoint-url overrides the default https://{bucket}.s3.amazonaws.com/
✔ Windows-safe output directory names (no ":" explosions)
✔ Works in "index-only" mode and generates both paginated & single-page HTML reports
✔ Resumable downloads with a tiny JSON state file
"""

import argparse
import json
import os
import re
import sys
import hashlib
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, quote, urlparse

import requests

STATE_FILE = ".s3_mirror_state.json"
_WIN_BAD_CHARS = r'[<>:"/\\|?*]+'  # chars Windows doesn't like in file/dir names

# Global so we don't pass it everywhere
BASE_URL = None

# -------------------- Utility -------------------- #
def _safe_dirname(name: str) -> str:
    """Return a sanitized directory name that won't upset Windows."""
    return re.sub(_WIN_BAD_CHARS, "_", name).strip("_") or "bucket_output"

def natural_sort_key(text: str):
    """Sort helper: splits digits so 'file10' > 'file2' naturally, avoids mixed types."""
    return [str(tok).zfill(10) if tok.isdigit() else tok.lower() for tok in re.findall(r"\d+|\D+", text)]

def save_state(data: dict):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def load_state() -> dict:
    if not os.path.exists(STATE_FILE):
        return {"bucket_dir": None, "downloaded_keys": []}
    with open(STATE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def delete_state():
    if os.path.exists(STATE_FILE):
        os.remove(STATE_FILE)

# -------------------- Namespace handling -------------------- #
def extract_namespace(xml_content: str) -> dict:
    """
    Extract the namespace from the XML content.
    Supports both S3 and GXP namespaces.
    """
    # Try to find namespace in the root element
    match = re.search(r'xmlns[:=](["\'])(.*?)\1', xml_content)
    if match:
        ns_value = match.group(2)
        return {"s3": ns_value}

    # Default to AWS S3 namespace if none found
    return {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}

# -------------------- Core ops -------------------- #
def list_keys(bucket_dir: str, base_url: str, max_pages: int | None = None):
    """
    Robust XML walker:
      * Supports list-type=2 (continuation-token) and legacy Marker/NextMarker
      * Detects duplicate XML (same MD5) and stops
      * Dedupes keys

    Pagination notes:
    - ListObjectsV2 uses 'continuation-token' and 'NextContinuationToken'
    - Legacy ListObjects uses 'marker' and 'NextMarker'
    - boto3 paginator for 'list_objects_v2' handles ContinuationToken automatically
    - Marker is NOT used with ListObjectsV2
    """
    # Try boto3 paginator for custom endpoints
    try:
        import boto3
        from botocore.config import Config
        # Detect if base_url is a custom endpoint
        endpoint_url = None
        bucket_name = None
        parsed = urlparse(base_url)
        if parsed.scheme and parsed.netloc:
            # If base_url is a full URL, extract bucket name and endpoint
            # e.g. https://custom-host/bucket/
            path_parts = parsed.path.strip('/').split('/')
            if path_parts:
                bucket_name = path_parts[0]
                endpoint_url = f"{parsed.scheme}://{parsed.netloc}"
        if endpoint_url and bucket_name:
            s3 = boto3.client(
                's3',
                endpoint_url=endpoint_url,
                config=Config(s3={'addressing_style': 'path'})
            )
            paginator = s3.get_paginator('list_objects_v2')
            all_keys = set()
            page = 1
            xml_dir = os.path.join(bucket_dir, "_xml_listings")
            os.makedirs(xml_dir, exist_ok=True)
            for response in paginator.paginate(Bucket=bucket_name):
                # Save XML for HTML conversion
                xml_path = os.path.join(xml_dir, f"listing_page_{page}.xml")
                with open(xml_path, "w", encoding="utf-8") as f:
                    f.write(str(response))
                for obj in response.get('Contents', []):
                    all_keys.add(obj['Key'])
                print(f"Fetched page {page}. Keys so far: {len(all_keys)}")
                page += 1
            return sorted(all_keys)
    except Exception as e:
        print(f"Boto3 paginator failed: {e}. Falling back to manual pagination.")
        # Fallback to manual XML parsing below
    # --- Manual XML parsing (legacy logic) ---
    params = {"list-type": "2", "max-keys": "1000"}
    keys = []
    seen_keys = set()
    seen_md5 = set()
    page = 1
    prev_token = None

    xml_dir = os.path.join(bucket_dir, "_xml_listings")
    os.makedirs(xml_dir, exist_ok=True)

    def _get_txt(root, tag):
        return root.findtext(f".//{{*}}{tag}") or root.findtext(tag)

    while True:
        resp = requests.get(base_url, params=params)
        resp.raise_for_status()
        xml_content = resp.text

        md5 = hashlib.md5(xml_content.encode("utf-8")).hexdigest()
        if md5 in seen_md5:
            print(f"XML page {page} is identical to a previous page (md5={md5}). Stopping.")
            break
        seen_md5.add(md5)

        xml_path = os.path.join(xml_dir, f"listing_page_{page}.xml")
        with open(xml_path, "w", encoding="utf-8") as f:
            f.write(xml_content)

        root = ET.fromstring(xml_content)

        # Extract namespace from XML content
        ns = extract_namespace(xml_content)

        for contents in root.findall(".//{*}Contents") + root.findall("Contents"):
            key = contents.findtext(".//{*}Key") or contents.findtext("Key") or ""
            if key and key not in seen_keys:
                seen_keys.add(key)
                keys.append(key)

        is_truncated_txt = (_get_txt(root, "IsTruncated") or "false").lower()
        is_truncated = is_truncated_txt == "true"

        next_token = _get_txt(root, "NextContinuationToken")
        next_marker = _get_txt(root, "NextMarker")

        print(f"Fetched page {page}. Keys so far: {len(keys)}")

        if max_pages and page >= max_pages:
            print("Hit max_pages limit, stopping.")
            break

        if not is_truncated:
            break
        elif is_truncated and not next_token:
            # If truncated and no NextContinuationToken, use last key as marker
            page_keys = [contents.findtext(".//{*}Key") or contents.findtext("Key") or "" for contents in root.findall(".//{*}Contents") + root.findall("Contents")]
            if page_keys:
                last_key = page_keys[-1]
                print(f"No NextContinuationToken, using last key as marker: {last_key}")
                params["marker"] = last_key
                params.pop("continuation-token", None)
                prev_token = last_key
            else:
                print("No keys found on truncated page; cannot continue.")
                break
        elif next_token:
            # ListObjectsV2 pagination
            if prev_token == next_token:
                print("Continuation token repeated; stopping to avoid loop.")
                break
            params["continuation-token"] = next_token
            params.pop("marker", None)
            prev_token = next_token
        elif next_marker and params.get("list-type") != "2":
            # Legacy ListObjects pagination (only use marker if not list-type=2)
            if prev_token == next_marker:
                print("NextMarker repeated; stopping to avoid loop.")
                break
            params["marker"] = next_marker
            params.pop("continuation-token", None)
            prev_token = next_marker
        else:
            print("No pagination token found and response truncated => giving up.")
            break

        page += 1

    return keys

def download_objects(bucket_dir: str,
                     keys,
                     filter_keywords=None,
                     filter_filetypes=None,
                     folder_path=None,
                     resume=False,
                     base_url=None):
    """
    Download each object into bucket_dir/key.
    Skip 403s but mark them as 'seen' so resume doesn't retry forever.
    """
    filter_keywords = [k.lower() for k in (filter_keywords or [])]
    filter_filetypes = [f.lower() for f in (filter_filetypes or [])]

    # Filter keys
    def _include(k):
        if folder_path and not k.startswith(folder_path):
            return False
        if filter_keywords and not any(x in k.lower() for x in filter_keywords):
            return False
        if filter_filetypes and not any(k.lower().endswith(ext) for ext in filter_filetypes):
            return False
        return True

    filtered_keys = [k for k in keys if _include(k)]

    downloaded_keys = set()
    if resume:
        state = load_state()
        if state.get("bucket_dir") == bucket_dir:
            downloaded_keys = set(state.get("downloaded_keys", []))
            print(f"Resuming. Already have {len(downloaded_keys)} / {len(filtered_keys)} filtered objects.")
        else:
            print("State file is for a different bucket/output dir. Starting fresh.")
            delete_state()

    print(f"Downloading {len(filtered_keys)} objects (after filters).")

    for i, key in enumerate(filtered_keys, start=1):
        if key in downloaded_keys:
            print(f"Skip [{i}/{len(filtered_keys)}] {key} (already)")
            continue

        if key.endswith("/"):
            # folder marker, just ensure local dir
            os.makedirs(os.path.join(bucket_dir, key), exist_ok=True)
            downloaded_keys.add(key)
            save_state({"bucket_dir": bucket_dir, "downloaded_keys": list(downloaded_keys)})
            continue

        dest_path = os.path.join(bucket_dir, key)
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)

        url = urljoin(base_url, quote(key))
        try:
            print(f"[{i}/{len(filtered_keys)}] {key}")
            resp = requests.get(url, stream=True)
            if resp.status_code == 403:
                print(f"  -> 403 Forbidden, marking as done.")
                downloaded_keys.add(key)
                save_state({"bucket_dir": bucket_dir, "downloaded_keys": list(downloaded_keys)})
                continue
            resp.raise_for_status()

            with open(dest_path, "wb") as f:
                for chunk in resp.iter_content(8192):
                    f.write(chunk)

            downloaded_keys.add(key)
            save_state({"bucket_dir": bucket_dir, "downloaded_keys": list(downloaded_keys)})
        except requests.exceptions.HTTPError as e:
            print(f"HTTP error on {key}: {e}")
        except Exception as e:
            print(f"Unexpected error on {key}: {e}")

# -------------------- HTML conversion -------------------- #
def convert_xml_to_html(bucket_dir: str, single_page=False, base_url=None):
    xml_dir = os.path.join(bucket_dir, "_xml_listings")
    html_dir = os.path.join(bucket_dir, "_html_listings")
    os.makedirs(html_dir, exist_ok=True)

    xml_files = sorted(
        [f for f in os.listdir(xml_dir) if f.lower().endswith(".xml")],
        key=natural_sort_key
    )

    total_pages = len(xml_files)

    # Paginated pages
    for page_index, xml_file in enumerate(xml_files, start=1):
        try:
            _convert_single_xml_to_html(bucket_dir, xml_dir, html_dir, xml_file, page_index, total_pages, base_url)
        except Exception as e:
            print(f"Error converting {xml_file} -> HTML: {e}")

    _create_index_page(bucket_dir, xml_files, html_dir, total_pages)

    if single_page:
        _create_single_page_html(bucket_dir, xml_files, xml_dir, html_dir, base_url)

def _convert_single_xml_to_html(bucket_dir, xml_dir, html_dir, xml_file, page_index, total_pages, base_url):
    path = os.path.join(xml_dir, xml_file)
    tree = ET.parse(path)
    root = tree.getroot()

    # Extract namespace from XML content
    with open(path, "r", encoding="utf-8") as f:
        xml_content = f.read()
    ns = extract_namespace(xml_content)

    rows_html = ""
    for contents in root.findall("s3:Contents", ns):
        key = contents.findtext("s3:Key", "", ns)
        size = contents.findtext("s3:Size", "", ns)
        lastmod = contents.findtext("s3:LastModified", "", ns)

        if key.endswith("/"):
            key_cell = f"<td>📁 {key}</td>"
        else:
            s3_url = urljoin(base_url, quote(key))
            key_cell = f'<td><a href="{s3_url}">{key}</a></td>'

        rows_html += f"""
<tr>
  {key_cell}
  <td>{size}</td>
  <td>{lastmod}</td>
</tr>
"""

    nav_html = _generate_pagination_nav(page_index, total_pages, xml_files=None)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>S3 Listing Page {page_index} / {total_pages}</title>
<style>
body {{ font-family: system-ui, Arial, sans-serif; max-width: 1200px; margin: 20px auto; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ border: 1px solid #ccc; padding: 4px 6px; font-size: 14px; }}
th {{ background: #f3f3f3; text-align: left; }}
a {{ text-decoration: none; color: #0645ad; }}
.pagination a {{ margin: 0 4px; }}
</style>
</head>
<body>
<h1>S3 Bucket Listing (page {page_index} of {total_pages})</h1>
{nav_html}
<table>
  <thead>
    <tr><th>Key</th><th>Size</th><th>Last Modified</th></tr>
  </thead>
  <tbody>
    {rows_html}
  </tbody>
</table>
{nav_html}
<p><a href="index.html">Back to index</a></p>
</body>
</html>
"""

    out_html = os.path.join(html_dir, f"page_{page_index}.html")
    with open(out_html, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Generated {out_html}")

def _generate_pagination_nav(current_page, total_pages, xml_files):
    if total_pages <= 1:
        return ""
    links = []
    for p in range(1, total_pages + 1):
        if p == current_page:
            links.append(f"<strong>{p}</strong>")
        else:
            links.append(f'<a href="page_{p}.html">{p}</a>')
    return '<div class="pagination">' + " ".join(links) + "</div>"

def _create_index_page(bucket_dir, xml_files, html_dir, total_pages):
    index_path = os.path.join(html_dir, "index.html")
    xml_dir = os.path.join(bucket_dir, "_xml_listings")

    li = []
    for i, xml_file in enumerate(xml_files, start=1):
        li.append(f'<li><a href="page_{i}.html">Page {i}</a> — <code>{xml_file}</code></li>')

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>S3 Bucket Index - {bucket_dir}</title>
<style>
body {{ font-family: system-ui, Arial, sans-serif; max-width: 800px; margin: 20px auto; }}
code {{ background: #f5f5f5; padding: 2px 4px; }}
li {{ margin-bottom: 4px; }}
</style>
</head>
<body>
<h1>S3 Bucket Index: {bucket_dir}</h1>
<p>Total pages: {total_pages}</p>

<h2>Pages</h2>
<ol>
{''.join(li)}
</ol>

<p>XML files saved under: <code>{xml_dir}</code></p>
<p>Generated with <code>s3po.py</code></p>
</body>
</html>
"""

    with open(index_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Generated {index_path}")

def _create_single_page_html(bucket_dir, xml_files, xml_dir, html_dir, base_url):
    combined_path = os.path.join(html_dir, "combined.html")
    print(f"Creating combined single-page HTML: {combined_path}")

    objects = []  # list of dicts {key, size, lastmod, is_directory}

    for xml_file in xml_files:
        path = os.path.join(xml_dir, xml_file)
        tree = ET.parse(path)
        root = tree.getroot()

        # Extract namespace from XML content
        with open(path, "r", encoding="utf-8") as f:
            xml_content = f.read()
        ns = extract_namespace(xml_content)

        for contents in root.findall("s3:Contents", ns):
            key = contents.findtext("s3:Key", "", ns)
            size = contents.findtext("s3:Size", "", ns)
            lastmod = contents.findtext("s3:LastModified", "", ns)
            objects.append({
                "key": key,
                "size": int(size or 0),
                "lastmod": lastmod,
                "is_directory": key.endswith("/")
            })

    # Sort all objects by key
    objects.sort(key=lambda x: natural_sort_key(x["key"]))

    rows = ""
    for obj in objects:
        if obj["is_directory"]:
            key_cell = f"<td>📁 {obj['key']}</td>"
        else:
            s3_url = urljoin(base_url, quote(obj["key"]))
            key_cell = f'<td><a href="{s3_url}">{obj["key"]}</a></td>'

        rows += f"""
<tr>
  {key_cell}
  <td>{obj["size"]}</td>
  <td>{obj["lastmod"]}</td>
</tr>
"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Complete S3 Bucket Listing - {bucket_dir}</title>
<style>
body {{ font-family: system-ui, Arial, sans-serif; max-width: 1200px; margin: 20px auto; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ border: 1px solid #ccc; padding: 4px 6px; font-size: 14px; }}
th {{ background: #f3f3f3; text-align: left; }}
a {{ text-decoration: none; color: #0645ad; }}
</style>
</head>
<body>
<h1>Complete S3 Bucket Listing: {bucket_dir}</h1>
<p>Total objects: {len(objects)}</p>

<table>
  <thead>
    <tr><th>Key</th><th>Size</th><th>Last Modified</th></tr>
  </thead>
  <tbody>
    {rows}
  </tbody>
</table>

<p><a href="index.html">Back to paginated index</a></p>
</body>
</html>
"""

    with open(combined_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Generated {combined_path}")

# -------------------- CLI -------------------- #
def main():
    parser = argparse.ArgumentParser(
        description="Download contents of a public S3 bucket via HTTPS XML listing"
    )
    parser.add_argument("bucket", help="Bucket name OR full https URL to the bucket root")
    parser.add_argument("--filter-keywords", nargs="*", help="Case-insensitive keyword filters")
    parser.add_argument("--filter-filetypes", nargs="*", help="Filter by extensions (e.g., .jpg .pdf)")
    parser.add_argument("--folder-path", help="Download only keys starting with this prefix")
    parser.add_argument("--resume", action="store_true", help="Resume from last state")
    parser.add_argument("--convert-xml-to-html", action="store_true",
                        help="Convert saved XML listings to HTML (no network)")
    parser.add_argument("--single-page-html", action="store_true",
                        help="Create one giant HTML file (use with --convert-xml-to-html)")
    parser.add_argument("--index-only", action="store_true",
                        help="Only download XML listings and make HTML reports (no files)")
    parser.add_argument("--clear-state", action="store_true",
                        help="Clear saved state and exit")
    parser.add_argument("--endpoint-url",
                        help="Custom S3 endpoint URL (e.g., https://cld1.staticsfly.com/)")

    args = parser.parse_args()

    if args.clear_state:
        delete_state()
        print("State file cleared.")
        sys.exit(0)

    raw_bucket = args.bucket

    # Resolve base_url and safe output dir
    if raw_bucket.startswith("http://") or raw_bucket.startswith("https://"):
        if not args.endpoint_url:
            args.endpoint_url = raw_bucket
        parsed = urlparse(raw_bucket)
        bucket_dir = _safe_dirname(parsed.netloc + parsed.path)
    else:
        bucket_dir = _safe_dirname(raw_bucket)

    global BASE_URL
    if args.endpoint_url:
        BASE_URL = args.endpoint_url.rstrip("/") + "/"
    else:
        BASE_URL = f"https://{raw_bucket}.s3.amazonaws.com/"

    os.makedirs(bucket_dir, exist_ok=True)

    # Offline conversion mode
    if args.convert_xml_to_html:
        convert_xml_to_html(bucket_dir, single_page=args.single_page_html, base_url=BASE_URL)
        print("XML->HTML conversion done.")
        sys.exit(0)

    # Online: list keys first
    keys = list_keys(bucket_dir, BASE_URL)

    if args.index_only:
        print(f"Index-only: {len(keys)} objects found. Generating HTML...")
        convert_xml_to_html(bucket_dir, single_page=False, base_url=BASE_URL)
        convert_xml_to_html(bucket_dir, single_page=True, base_url=BASE_URL)
        print("Done. Inspect HTML to choose prefixes/filters, then rerun without --index-only.")
        sys.exit(0)

    print(f"Found {len(keys)} objects total.")
    download_objects(bucket_dir, keys,
                     filter_keywords=args.filter_keywords,
                     filter_filetypes=args.filter_filetypes,
                     folder_path=args.folder_path,
                     resume=args.resume,
                     base_url=BASE_URL)

if __name__ == "__main__":
    main()
