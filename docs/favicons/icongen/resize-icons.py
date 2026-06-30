#!/usr/bin/env python3
import sys
import os
import re
import base64
import io
from PIL import Image

def resize_icons(input_file, sizes=None, output_dir=None):
    if sizes is None:
        sizes = [16, 32, 48, 64, 96, 128, 256]
    
    if output_dir is None:
        output_dir = os.path.dirname(input_file) or '.'
    
    # Check if input is SVG with embedded PNG
    if input_file.lower().endswith('.svg'):
        with open(input_file, 'r') as f:
            svg_content = f.read()
        
        # Extract base64-encoded PNG from <image> element (strip HTML entities like &#10;)
        match = re.search(r'xlink:href="data:image/png;base64,([^"]+)"', svg_content)
        if match:
            print(f'Extracting embedded PNG from SVG...')
            b64_data = match.group(1).replace('&#10;', '').replace('&#13;', '').strip()
            png_data = base64.b64decode(b64_data)
            img = Image.open(io.BytesIO(png_data))
        else:
            print('Error: No embedded PNG found in SVG.')
            sys.exit(1)
    else:
        img = Image.open(input_file)
    
    for size in sizes:
        output_file = os.path.join(output_dir, f'icon{size}.png')
        print(f'Resizing to {size}px -> {output_file}')
        resized = img.resize((size, size), Image.LANCZOS)
        resized.save(output_file, 'PNG')
    
    print('Done.')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python resize-icons.py <input-file> [output-dir]')
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else None
    resize_icons(input_file, output_dir=output_dir)