#!/usr/bin/env python3
"""
Combine all bucket listing XML pages into a single XML file.

Usage:
    python combine_bucket_xml.py <input_dir> [output_file]

Example:
    python combine_bucket_xml.py ./test_export combined.xml
"""

import os
import sys
import glob
import re
from pathlib import Path


def combine_xml(input_dir: str, output_file: str) -> None:
    xml_files = sorted(glob.glob(os.path.join(input_dir, "page_*.xml")))
    
    if not xml_files:
        print(f"No page_*.xml files found in {input_dir}")
        sys.exit(1)
    
    print(f"Found {len(xml_files)} XML files")
    
    # Read first file to get the header
    with open(xml_files[0], 'r', encoding='utf-8') as f:
        header = f.readline().strip()  # <?xml ...>
        first_line = f.readline()  # <ListBucketResult xmlns=...>
    
    # Extract bucket name and static elements from first file
    name_match = re.search(r'<Name>(.*?)</Name>', first_line)
    bucket_name = name_match.group(1) if name_match else "unknown"
    
    # Collect all Contents blocks
    contents_blocks = []
    seen_keys = set()
    
    for xml_file in xml_files:
        with open(xml_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Find all Contents blocks
        for match in re.finditer(r'<Contents>(.*?)</Contents>', content, re.DOTALL):
            block = match.group(0)
            key_match = re.search(r'<Key>(.*?)</Key>', block)
            if key_match:
                key = key_match.group(1)
                if key and key not in seen_keys:
                    seen_keys.add(key)
                    contents_blocks.append(block)
    
    # Build combined XML
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(header + '\n')
        f.write(first_line)
        f.write(f'\n  <KeyCount>{len(contents_blocks)}</KeyCount>\n')
        for block in contents_blocks:
            f.write('  ' + block.replace('\n', '') + '\n')
    
    print(f"Combined {len(contents_blocks)} unique keys into {output_file}")
    print(f"File size: {os.path.getsize(output_file) / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python combine_bucket_xml.py <input_dir> [output_file]")
        sys.exit(1)
    
    input_dir = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else "combined.xml"
    
    combine_xml(input_dir, output_file)
