#!/usr/bin/env python3
"""
Download all bucket listing XML pages for a public S3 bucket.

Usage:
    python download_bucket.py <bucket_url> [output_dir]

Examples:
    python download_bucket.py https://datg-nap7-cdn-public-origin-prod.s3.amazonaws.com/
    python download_bucket.py https://datg-nap7-cdn-public-origin-prod.s3.amazonaws.com/ ./exports
"""

import sys
import os
import re
import time
import argparse
import xml.etree.ElementTree as ET
from urllib.parse import urlparse, urlencode, urlunparse, parse_qs

import requests


def extract_namespace(xml_content: str) -> dict:
    match = re.search(r'xmlns[:=](["\'])(.*?)\1', xml_content)
    if match:
        return {"s3": match.group(2)}
    return {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}


def get_txt(root, tag):
    """Find text in element, trying namespaced and non-namespaced."""
    return root.findtext(f".//{{*}}{tag}") or root.findtext(tag)


def download_bucket(bucket_url: str, output_dir: str, delay: float = 0.5) -> None:
    parsed = urlparse(bucket_url)
    base = urlunparse((parsed.scheme, parsed.netloc, parsed.path.rstrip("/") + "/", parsed.params, "", parsed.fragment))

    params = {"list-type": "2", "max-keys": "1000"}
    page = 1
    prev_token = None

    os.makedirs(output_dir, exist_ok=True)
    print(f"Bucket: {base}")
    print(f"Output: {output_dir}")
    print("-" * 60)

    while True:
        resp = requests.get(base, params=params, timeout=60)
        resp.raise_for_status()
        xml_content = resp.text

        xml_path = os.path.join(output_dir, f"page_{page:04d}.xml")
        with open(xml_path, "w", encoding="utf-8") as f:
            f.write(xml_content)

        root = ET.fromstring(xml_content)
        ns = extract_namespace(xml_content)

        contents = root.findall(".//{*}Contents") + root.findall("Contents")
        keys = [c.findtext(".//{*}Key") or c.findtext("Key") or "" for c in contents if (c.findtext(".//{*}Key") or c.findtext("Key"))]
        print(f"Page {page}: {len(keys)} keys -> {os.path.basename(xml_path)}")

        is_truncated = (get_txt(root, "IsTruncated") or "false").lower() == "true"
        next_token = get_txt(root, "NextContinuationToken")
        next_marker = get_txt(root, "NextMarker")

        if not is_truncated:
            print("Done. No more pages.")
            break

        if next_token:
            if prev_token == next_token:
                print("Token repeated, stopping.")
                break
            params["continuation-token"] = next_token
            params.pop("marker", None)
            prev_token = next_token
        elif next_marker:
            if prev_token == next_marker:
                print("Marker repeated, stopping.")
                break
            params["marker"] = next_marker
            params.pop("continuation-token", None)
            prev_token = next_marker
        else:
            last_key = keys[-1] if keys else None
            if last_key:
                print(f"No token, using last key as marker: {last_key}")
                params["marker"] = last_key
                params.pop("continuation-token", None)
                prev_token = last_key
            else:
                print("No pagination info, stopping.")
                break

        page += 1
        time.sleep(delay)


def main():
    parser = argparse.ArgumentParser(description="Download all bucket listing XML pages.")
    parser.add_argument("bucket_url", help="Bucket URL (e.g., https://bucket.s3.amazonaws.com/)")
    parser.add_argument("output_dir", nargs="?", default="./exports")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between requests (default: 0.5)")
    args = parser.parse_args()
    download_bucket(args.bucket_url, args.output_dir, delay=args.delay)


if __name__ == "__main__":
    main()
