"""Generates the extension icons: indigo->violet gradient squircle with a play triangle and a download arrow.
Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw
import os
out = os.path.join(os.path.dirname(__file__), '..', 'src', 'icons'); os.makedirs(out, exist_ok=True)
A, B = (99, 102, 241), (139, 92, 246)
for size in (16, 32, 48, 128):
    S = size * 8
    grad = Image.new('RGBA', (S, S))
    px = grad.load()
    for y in range(S):
        for x in range(S):
            k = (x + y) / (2 * S)
            px[x, y] = tuple(int(A[i] + (B[i] - A[i]) * k) for i in range(3)) + (255,)
    mask = Image.new('L', (S, S), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * .24), fill=255)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); im.paste(grad, (0, 0), mask)
    w = max(int(S * .085), 2); cx = S // 2
    ov = Image.new('RGBA', (S, S), (0, 0, 0, 0))  # soft play triangle behind the arrow (alpha-composited)
    ImageDraw.Draw(ov).polygon([(S * .30, S * .16), (S * .30, S * .66), (S * .78, S * .41)], fill=(255, 255, 255, 60))
    im = Image.alpha_composite(im, ov); d = ImageDraw.Draw(im)
    d.line([(cx, S * .18), (cx, S * .60)], fill='white', width=w)
    d.line([(S * .30, S * .44), (cx, S * .64)], fill='white', width=w); d.line([(S * .70, S * .44), (cx, S * .64)], fill='white', width=w)
    d.line([(S * .22, S * .80), (S * .78, S * .80)], fill='white', width=w)
    im.resize((size, size), Image.LANCZOS).save(os.path.join(out, f'icon{size}.png'))
