"""Generates the extension icons (blue rounded square + white download arrow). Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw
import os
out = os.path.join(os.path.dirname(__file__), '..', 'src', 'icons'); os.makedirs(out, exist_ok=True)
for size in (16, 32, 48, 128):
    S = size * 8
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S // 4, fill=(37, 99, 235, 255))
    w = max(S // 11, 2); cx = S // 2
    d.line([(cx, S * 0.20), (cx, S * 0.58)], fill='white', width=w)
    d.line([(S * 0.30, S * 0.42), (cx, S * 0.62)], fill='white', width=w); d.line([(S * 0.70, S * 0.42), (cx, S * 0.62)], fill='white', width=w)
    d.line([(S * 0.24, S * 0.78), (S * 0.76, S * 0.78)], fill='white', width=w)
    im.resize((size, size), Image.LANCZOS).save(os.path.join(out, f'icon{size}.png'))
