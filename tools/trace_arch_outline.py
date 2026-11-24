"""Traces the inside edge of the forest painting's tree arch into the ball's collision outline.

    python tools/trace_arch_outline.py "<path to the forest painting>" [--out src/content/outlines/forest.ts]

Needs numpy, Pillow and opencv-python-headless. Writes a TypeScript data file (src/content/outlines/forest.ts by
default) holding the outline as a polyline in world units: from below the ball-loss line on the left, up the
left trunk's inner edge, along the underside of the branch, and down the right trunk to below the ball-loss
line on the right. The playable opening is on the right-hand side of the direction of travel.

How it traces:
  1. Solid = bark (orange-brown) or rock (grey). Leaves, grass, sunbeams and the blurred background are not
     solid, so leaves hanging into the opening are ignored.
  2. Per row, the trunks' inner edges (first run of mostly-solid pixels scanning out from the centre); per
     column, the branch underside (first mostly-solid run scanning up from the middle). Each profile is
     "closed" (running max then min, or min then max) so notches narrower than ~25 px - bark crevices, a leaf
     drawn over the bark - are filled instead of becoming pockets, then lightly smoothed.
  3. The opening is the set of pixels inside all three profiles; its contour is smoothed (Gaussian along the
     curve) and simplified (Douglas-Peucker), and the artificial bottom edge is cut off.
  4. Image px are converted to world units with the MAPPING below (the playfield plane, z = 0).

To use a different painting: update FOREST_ART in src/gameplay/config.ts for it (ceiling, centre, paddle
line), copy the same numbers into MAPPING (or pass them as flags), and rerun this script.
"""

import argparse
import math
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ------------------------------------------------------------------------------------------------ MAPPING
# Keep in sync with FOREST_ART in src/gameplay/config.ts (tests/outline.test.ts checks the generated file
# against it). Image px (px, py) -> world (x, y) on the playfield plane:
#   x = (px - CENTRE_PX) / PX_PER_UNIT,   y = FIELD_TOP - (py - CEILING_PX) / (PX_PER_UNIT * cos(PITCH))
PITCH_DEG = 14.0
CEILING_PX = 110.0
CENTRE_PX = 836.0
PADDLE_BOTTOM_PX = 841.0
FIELD_TOP = 10.4
# FOREST_PX_PER_UNIT in gameConfig.ts: (paddle bottom - ceiling) / ((10.4 + 9.25) cos(pitch) + paddle drawn drop)
_P = math.radians(PITCH_DEG)
PX_PER_UNIT = (PADDLE_BOTTOM_PX - CEILING_PX) / ((10.4 + 9.25) * math.cos(_P) + 0.55 * math.cos(_P) + 1.07 * math.sin(_P))
# The outline runs down to this image row on both sides (well below the ball-loss line, world y = -10.7).
BOTTOM_PX = 905.0
# Lowest image row scanned for the trunks (the grass line; below it the floor reflects the trunks). Rows below
# keep this row's edges, so the outline runs straight down from the root tips.
LAST_TRUNK_ROW = 841
# ---------------------------------------------------------------------------------------------------------

WINDOW = 6          # px: a run counts as solid when this many consecutive pixels are mostly solid
NOTCH = 25          # px: notches in a profile narrower than this are filled
SMOOTH_SIGMA = 4.0  # px: Gaussian smoothing along the contour
SIMPLIFY_EPS = 1.0  # px: Douglas-Peucker tolerance


def solid_mask(rgb):
    r, g, b = (rgb[..., i].astype(np.int32) for i in range(3))
    bark = (r > g * 0.95) & (r > 90) & (r > b + 40)
    rock = (np.abs(r - g) < 22) & (np.abs(g - b) < 22) & (r > 95) & (r < 235)
    return bark | rock


def first_run(values, start, step, stop):
    """Index of the first position (walking from start by step) where a WINDOW-long run is >= 80% solid."""
    i = start
    while (step > 0 and i + WINDOW <= stop) or (step < 0 and i - WINDOW >= stop):
        seg = values[i:i + WINDOW] if step > 0 else values[i - WINDOW + 1:i + 1]
        if seg.mean() >= 0.8:
            return i
        i += step
    return None


def running(fn, a, w):
    pad = w // 2
    p = np.pad(a, pad, mode='edge')
    return np.array([fn(p[i:i + w]) for i in range(len(a))])


def fill_gaps(a):
    """Linear interpolation over NaN gaps; edges keep the nearest value."""
    a = a.astype(float)
    idx = np.arange(len(a))
    ok = ~np.isnan(a)
    return np.interp(idx, idx[ok], a[ok])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('image')
    ap.add_argument('--out', default=os.path.join(ROOT, 'src', 'content', 'outlines', 'forest.ts'))
    ap.add_argument('--overlay', help='optional PNG: the outline drawn on the painting')
    args = ap.parse_args()

    rgb = np.asarray(Image.open(args.image).convert('RGB'))
    h, w, _ = rgb.shape
    solid = solid_mask(rgb)
    cx = int(CENTRE_PX)
    mid_y = int(CEILING_PX + (PADDLE_BOTTOM_PX - CEILING_PX) * 0.45)

    # Branch: per column, the underside scanning up from the middle of the opening (trunk columns are solid
    # at the start, so they come out as mid_y and are excluded from the opening above it).
    ceil = np.full(w, np.nan)
    for x in range(w):
        y = first_run(solid[:, x], mid_y, -1, 0)
        if y is not None:
            ceil[x] = y + 1
    ceil = fill_gaps(ceil)
    # Rows that cross the branch (above its lowest dip) are bounded by the branch profile alone; from there
    # down, per row, the trunks' inner edges scanning out from the centre column.
    band = int(np.max(ceil[int(cx - 0.3 * w):int(cx + 0.3 * w)])) + 2
    rows = np.arange(h)
    left = np.full(h, np.nan)
    right = np.full(h, np.nan)
    for y in range(band, LAST_TRUNK_ROW + 1):
        lx = first_run(solid[y], cx, -1, 0)
        rx = first_run(solid[y], cx, 1, w)
        if lx is not None:
            left[y] = lx + 1
        if rx is not None:
            right[y] = rx
    left[LAST_TRUNK_ROW + 1:] = left[LAST_TRUNK_ROW]
    right[LAST_TRUNK_ROW + 1:] = right[LAST_TRUNK_ROW]
    left[:band] = left[band]
    right[:band] = right[band]
    left = fill_gaps(left)
    right = fill_gaps(right)
    left[:band] = 0
    right[:band] = w - 1

    # Close notches: the left edge's notches are dips (max then min), the right edge's and the ceiling's are
    # bumps away from the opening (min then max for the right edge; for the ceiling a notch is a smaller y).
    left = running(np.min, running(np.max, left, NOTCH), NOTCH)
    right = running(np.max, running(np.min, right, NOTCH), NOTCH)
    ceil = running(np.min, running(np.max, ceil, NOTCH), NOTCH)

    # The opening: inside both trunks and below the branch, down to BOTTOM_PX (plus a margin to cut later).
    bottom = int(BOTTOM_PX) + 12
    yy, xx = np.mgrid[0:h, 0:w]
    free = (xx >= left[:, None]) & (xx <= right[:, None]) & (yy >= ceil[None, :]) & (yy <= bottom)
    free = cv2.morphologyEx(free.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(free)
    keep = labels == labels[mid_y, cx]
    contours, _ = cv2.findContours(keep.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(contours, key=len)[:, 0, :].astype(float)

    # Smooth along the (closed) contour.
    k = int(SMOOTH_SIGMA * 3)
    ker = np.exp(-0.5 * (np.arange(-k, k + 1) / SMOOTH_SIGMA) ** 2)
    ker /= ker.sum()
    sm = np.stack([np.convolve(np.r_[c[-k:, i], c[:, i], c[:k, i]], ker, mode='valid') for i in range(2)], 1)

    # Cut the artificial bottom edge: keep points above BOTTOM_PX, then order them bottom-left -> top -> bottom-right.
    above = sm[:, 1] <= BOTTOM_PX
    # Rotate so the sequence starts at the first kept point after the bottom run.
    start = np.argmax(~above)  # a bottom point
    sm = np.roll(sm, -start, axis=0)
    above = np.roll(above, -start)
    idx = np.nonzero(above)[0]
    path = sm[idx[0]:idx[-1] + 1]
    # cv2 traces external contours counter-clockwise in image coordinates (y down) starting at the top; make it
    # start on the left side at the bottom.
    if path[0, 0] > path[-1, 0]:
        path = path[::-1]
    path = np.vstack([[path[0, 0], BOTTOM_PX], path, [path[-1, 0], BOTTOM_PX]])
    simple = cv2.approxPolyDP(path.astype(np.float32).reshape(-1, 1, 2), SIMPLIFY_EPS, False)[:, 0, :].astype(float)

    ky = PX_PER_UNIT * math.cos(_P)
    world = [((px - CENTRE_PX) / PX_PER_UNIT, FIELD_TOP - (py - CEILING_PX) / ky) for px, py in simple]
    body = ',\n'.join(f'  {x:.4f}, {y:.4f}' for x, y in world)
    rel = os.path.relpath(args.image, ROOT) if os.path.isabs(args.image) else args.image
    ts = f"""// Generated by tools/trace_arch_outline.py from {os.path.basename(args.image)} - do not edit by hand.
// Rerun the script to regenerate (see its docstring), e.g. for a new painting.

/**
 * The inside edge of the forest painting's tree arch, as the ball's collision outline (see gameplay/arena/boundary.ts):
 * a polyline in world units (x0, y0, x1, y1, ...) running from below the ball-loss line on the left, up the
 * left trunk, along the underside of the branch and down the right trunk. The opening is on the right-hand
 * side of the direction of travel. {len(world)} points.
 */
export const FOREST_OUTLINE: readonly number[] = [
{body},
];

/** The image -> world mapping the outline was traced with (must match FOREST_ART in gameConfig.ts). */
export const FOREST_OUTLINE_MAPPING = {{
  widthPx: {w},
  heightPx: {h},
  centrePx: {CENTRE_PX},
  ceilingPx: {CEILING_PX},
  pxPerUnit: {PX_PER_UNIT:.6f},
  pitchDeg: {PITCH_DEG},
}} as const;
"""
    with open(args.out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(ts)
    print(f'{len(world)} points -> {args.out}')

    if args.overlay:
        from PIL import ImageDraw
        im = Image.open(args.image).convert('RGB')
        d = ImageDraw.Draw(im)
        pts = [tuple(p) for p in simple]
        d.line(pts, fill=(255, 0, 0), width=2)
        for p in pts:
            d.ellipse([p[0] - 2, p[1] - 2, p[0] + 2, p[1] + 2], outline=(255, 255, 0))
        # Ball-loss line and paddle line for reference.
        for wy, col in ((-10.7, (255, 0, 255)), (-8.7, (0, 200, 255))):
            py = CEILING_PX + (FIELD_TOP - wy) * ky
            d.line([(0, py), (w, py)], fill=col)
        im.save(args.overlay)


if __name__ == '__main__':
    main()
