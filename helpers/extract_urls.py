#!/usr/bin/env python3
"""
Extract URLs from S3 bucket listing XML files.

Usage:
    python extract_urls.py <bucket_url> <input_dir> [output_file]

Example:
    python extract_urls.py https://datg-nap7-cdn-public-origin-prod.s3.amazonaws.com/ ./test_export urls.txt
"""

import glob
import os
import re
import sys


def main():
    if len(sys.argv) < 3:
        print("Usage: python extract_urls.py <bucket_url> <input_dir> [output_file]")
        sys.exit(1)

    bucket_url = sys.argv[1].rstrip("/")
    input_dir = sys.argv[2]
    output_file = sys.argv[3] if len(sys.argv) > 3 else "urls.txt"

    xml_files = sorted(glob.glob(os.path.join(input_dir, "page_*.xml")))
    if not xml_files:
        print(f"No page_*.xml files found in {input_dir}")
        sys.exit(1)

    print(f"Found {len(xml_files)} XML files")

    seen = set()
    count = 0
    with open(output_file, "w", encoding="utf-8") as out:
        for xml_file in xml_files:
            with open(xml_file, "r", encoding="utf-8") as f:
                for line in f:
                    for key in re.findall(r"<Key>(.*?)</Key>", line):
                        if key and key not in seen:
                            seen.add(key)
                            out.write(bucket_url + "/" + key + "\n")
                            count += 1

    print(f"Wrote {count:,} URLs to {output_file}")


if __name__ == "__main__":
    main()
