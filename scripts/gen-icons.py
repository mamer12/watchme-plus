"""Generates the Watchme+ "W+" icons (PNG) and favicon.svg. Run: python3 scripts/gen-icons.py"""
from PIL import Image, ImageDraw
import os

RED = (225, 29, 72)
RED_DARK = (159, 18, 57)
BG = (20, 20, 20)
WHITE = (255, 255, 255)
OUT = os.path.join(os.path.dirname(__file__), '..', 'public')

# Mark geometry on a 100x100 grid: a heavy "W" and a superscript "+".
W_POINTS = [(x - 4, y + 4) for x, y in [(14, 26), (27, 26), (35, 58), (44, 30), (54, 30), (63, 58), (71, 26),
                                         (84, 26), (69, 78), (57, 78), (49, 50), (41, 78), (29, 78)]]
PLUS = [((79, 8), (86, 27)), ((73, 14), (92, 21))]


def draw_mark(size, scale, offset, rounded, bg=True):
    ss = 4
    S = size * ss
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg:
        if rounded:
            d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)
        else:
            d.rectangle([0, 0, S, S], fill=BG)

    def tx(p):
        return (offset * S + p[0] / 100 * S * scale, offset * S + p[1] / 100 * S * scale)

    shadow = [(x + 0.0, y + 2.2) for x, y in W_POINTS]
    d.polygon([tx(p) for p in shadow], fill=RED_DARK)
    d.polygon([tx(p) for p in W_POINTS], fill=RED)
    for a, b in PLUS:
        d.rectangle([tx(a), tx(b)], fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path, optimize=True)
    print('wrote', path)


save(draw_mark(192, 1.0, 0.0, True), 'icons/icon-192.png')
save(draw_mark(512, 1.0, 0.0, True), 'icons/icon-512.png')
# Maskable: full-bleed background, mark inside the 80% safe zone.
save(draw_mark(512, 0.72, 0.14, False), 'icons/maskable-512.png')
save(draw_mark(180, 0.84, 0.08, False), 'apple-touch-icon.png')
save(draw_mark(32, 1.0, 0.0, True), 'favicon-32.png')

pts = ' '.join(f'{x},{y}' for x, y in W_POINTS)
shadow = ' '.join(f'{x},{y + 2.2}' for x, y in W_POINTS)
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#141414"/>
<polygon points="{shadow}" fill="#9F1239"/>
<polygon points="{pts}" fill="#E11D48"/>
<rect x="79" y="8" width="7" height="19" fill="#fff"/><rect x="73" y="14" width="19" height="7" fill="#fff"/>
</svg>
'''
with open(os.path.join(OUT, 'favicon.svg'), 'w') as f:
    f.write(svg)
print('wrote favicon.svg')
