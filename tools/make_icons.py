#!/usr/bin/env python3
"""Generate extension icons (a "tab to end" glyph on a rounded square) as PNGs.

Pure stdlib: draws into an RGBA buffer at 4x and box-downsamples for smooth edges.
"""
import struct, zlib, os

BG = (37, 99, 235, 255)      # #2563eb
FG = (255, 255, 255, 255)

def render(size):
    S = size * 4  # supersample
    px = [[(0, 0, 0, 0)] * S for _ in range(S)]
    r = S * 0.22  # corner radius

    def inside_rounded(x, y):
        cx = min(max(x, r), S - 1 - r)
        cy = min(max(y, r), S - 1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

    for y in range(S):
        for x in range(S):
            if inside_rounded(x, y):
                px[y][x] = BG

    # Glyph "⇥": shaft + arrowhead + stop bar, centered.
    cy = S // 2
    shaft_h = max(2, S // 10)
    shaft_x0, shaft_x1 = int(S * 0.16), int(S * 0.52)
    head_x0, head_x1 = shaft_x1, int(S * 0.70)
    bar_x0, bar_x1 = int(S * 0.76), int(S * 0.76) + max(2, S // 12)
    bar_y0, bar_y1 = int(S * 0.26), int(S * 0.74)

    for y in range(S):
        for x in range(S):
            if px[y][x] != BG:
                continue
            # shaft
            if shaft_x0 <= x < shaft_x1 and abs(y - cy) <= shaft_h:
                px[y][x] = FG
            # arrowhead (triangle)
            elif head_x0 <= x < head_x1:
                t = (x - head_x0) / max(1, head_x1 - head_x0)  # 0..1
                half = (1 - t) * (S * 0.20)
                if abs(y - cy) <= half:
                    px[y][x] = FG
            # stop bar
            elif bar_x0 <= x < bar_x1 and bar_y0 <= y < bar_y1:
                px[y][x] = FG

    # box downsample 4x
    out = []
    for y in range(size):
        row = []
        for x in range(size):
            rs = gs = bs = as_ = 0
            for dy in range(4):
                for dx in range(4):
                    pr, pg, pb, pa = px[y * 4 + dy][x * 4 + dx]
                    rs += pr * pa; gs += pg * pa; bs += pb * pa; as_ += pa
            if as_ == 0:
                row.append((0, 0, 0, 0))
            else:
                row.append((rs // as_, gs // as_, bs // as_, as_ // 16))
        out.append(row)
    return out

def write_png(path, pixels):
    h = len(pixels); w = len(pixels[0])
    raw = b''.join(
        b'\x00' + b''.join(struct.pack('4B', *p) for p in row) for row in pixels)
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)

def main():
    outdir = os.path.join(os.path.dirname(__file__), '..', 'extension', 'icons')
    os.makedirs(outdir, exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(os.path.join(outdir, f'icon{size}.png'), render(size))
        print(f'icon{size}.png')

if __name__ == '__main__':
    main()
