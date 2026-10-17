"""
DRIVE FM -- hero car (white early-2000s Japanese liftback coupe), built from scratch.

Run (headless Blender as a Python module):
    /home/claude/.venv-bpy/bin/python assets-src/blender/hero_car.py \
        [--out public/assets/cars/hero.glb] [--blend /tmp/hero.blend] [--cycles DIR] [--stats]

  --out     glTF binary to write (default public/assets/cars/hero.glb, relative to the repo)
  --blend   also save the built scene as a .blend (handy for inspection)
  --cycles  render quick Cycles shape-check turntables into DIR (8 angles + chase + side)
  --stats   print triangle counts and measured dimensions

Conventions (docs/ASSET-CONVENTIONS.md): metres, Blender Z-up with the nose on -Y (game +Z),
origin on the ground between the axles, car's left = +X. Nodes: body, wheel_FL/FR/RL/RR
(hub-centred, axle on local X), lamp_head_L/R, lamp_tail_L/R, lamp_fog_L/R. Materials are
labels only (paint, trim, glass, ...); the game shades everything.

How the body is built
---------------------
The body is a loft of authored "lines" (rows), exactly like a lines plan: each row is a 3D
curve running nose to tail (keel, rocker, skirt crease, scoop crease, shoulder crease, belt,
roof rail, A-pillar/windscreen edge, hatch edge, centreline...). At every station the rows
give one half cross-section, which is resampled with a Catmull-Rom spline (broken at
creases), mirrored, and stitched into a closed quad ring. Near the nose and tail the
stations fan out (each row ends at its own y) so the rows wrap round the corners; the
remaining front and rear bumper faces are Coons-patch caps. Wheel arches, the front intake
and fog lamp pockets are exact booleans. Lamps, grille slats, plates etc. are closed decal
shells projected onto the body surface (BVH ray casts), so their outlines are exact and they
carry their own ink. Glass is part of the shell (faces between the right rows/stations).
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

# ----------------------------------------------------------------------------------------
# Key dimensions (metres). Nose is -Y.
# ----------------------------------------------------------------------------------------
WHEELBASE = 2.60
Y_FA = -WHEELBASE / 2          # front axle
Y_RA = +WHEELBASE / 2          # rear axle
TRACK = 1.50
TYRE_R = 0.31                  # 205/50R16-ish
TYRE_W = 0.205
RIM_R = 0.203                  # 16" rim
ARCH_R = 0.362                 # wheel arch opening radius
ARCH_ZC = 0.316                # arch centre height (a little above the hub: squat stance)

Y_MIN, Y_MAX = -2.20, 2.13     # station parameter range (nose tip .. rear bumper)
Y_FZ, Y_RZ = -1.65, 1.94       # end zones: stations fan out in front of/behind these

# Station y values (must contain the feature stations below exactly)
Y_COWL, Y_SAIL, Y_HEADER = -0.95, -0.72, -0.12
Y_BPIL0, Y_BPIL1 = 0.34, 0.40
Y_HATCH0, Y_DLO_END, Y_HATCH1, Y_LIP = 0.46, 1.18, 1.72, 1.94
STATIONS = [
    -2.20, -2.19, -2.175, -2.155, -2.13, -2.10, -2.06, -2.01, -1.95, -1.88, -1.80, -1.72, -1.65,
    -1.52, -1.38, -1.24, -1.10, Y_COWL,
    -0.84, Y_SAIL, -0.58, -0.43, -0.28, Y_HEADER,
    0.08, Y_BPIL0 - 0.12, Y_BPIL0, Y_BPIL1, Y_HATCH0,
    0.60, 0.75, 0.90, 1.05, Y_DLO_END, 1.36, 1.54, Y_HATCH1,
    1.79, 1.86, Y_LIP,
    1.96, 1.98, 2.00, 2.02, 2.045, 2.07, 2.10, 2.13,
]

# ----------------------------------------------------------------------------------------
# Small maths helpers
# ----------------------------------------------------------------------------------------
def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def cos_bump(x, c, w):
    d = abs(x - c) / w
    return 0.5 * (1 + math.cos(math.pi * d)) if d < 1 else 0.0


class Pchip:
    """Monotone piecewise-cubic interpolation (Fritsch-Carlson). Clamped outside the knots."""

    def __init__(self, xs, ys):
        self.xs, self.ys = list(xs), list(ys)
        n = len(xs)
        if n == 1:
            self.d = [0.0]
            return
        h = [xs[i + 1] - xs[i] for i in range(n - 1)]
        dl = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
        d = [0.0] * n
        if n == 2:
            d = [dl[0], dl[0]]
        else:
            for i in range(1, n - 1):
                if dl[i - 1] * dl[i] <= 0:
                    d[i] = 0.0
                else:
                    w1 = 2 * h[i] + h[i - 1]
                    w2 = h[i] + 2 * h[i - 1]
                    d[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i])
            d[0] = self._end(h[0], h[1], dl[0], dl[1])
            d[-1] = self._end(h[-1], h[-2], dl[-1], dl[-2])
        self.d = d

    @staticmethod
    def _end(h0, h1, m0, m1):
        d = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1)
        if d * m0 <= 0:
            return 0.0
        if m0 * m1 <= 0 and abs(d) > abs(3 * m0):
            return 3 * m0
        return d

    def __call__(self, x):
        xs, ys, d = self.xs, self.ys, self.d
        if x <= xs[0]:
            return ys[0] + d[0] * (x - xs[0]) if len(xs) > 1 else ys[0]
        if x >= xs[-1]:
            return ys[-1] + d[-1] * (x - xs[-1]) if len(xs) > 1 else ys[-1]
        lo, hi = 0, len(xs) - 1
        while hi - lo > 1:
            m = (lo + hi) // 2
            if xs[m] <= x:
                lo = m
            else:
                hi = m
        h = xs[hi] - xs[lo]
        t = (x - xs[lo]) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * d[lo]
                + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * d[hi])


class Curve1D:
    """Piecewise PCHIP with optional kinks (C0 corners) at given knot x values."""

    def __init__(self, knots, kinks=()):
        knots = sorted(knots)
        pieces, cur = [], [knots[0]]
        for k in knots[1:]:
            cur.append(k)
            if any(abs(k[0] - kk) < 1e-9 for kk in kinks):
                pieces.append(cur)
                cur = [k]
        if len(cur) > 1 or not pieces:
            pieces.append(cur)
        self.pieces = [(p[0][0], p[-1][0], Pchip([q[0] for q in p], [q[1] for q in p])) for p in pieces]

    def __call__(self, x):
        for a, b, f in self.pieces:
            if x <= b + 1e-12:
                return f(x)
        return self.pieces[-1][2](x)


# ----------------------------------------------------------------------------------------
# The lines. Each authored row: y0/y1 = where the row meets the front/rear bumper-face cap,
# knots = (y, x, z) along the row in real y, kinks = y values where the row may corner.
# ----------------------------------------------------------------------------------------
KINK_TOP = [Y_COWL, Y_HEADER, Y_HATCH1, Y_LIP]

ROWS = {
    # keel / floor centre line
    'K': dict(y0=-2.13, y1=2.10, kinks=[], knots=[
        (-2.13, 0, 0.175), (-2.05, 0, 0.162), (-1.90, 0, 0.152), (-1.60, 0, 0.145), (0.0, 0, 0.14),
        (1.60, 0, 0.145), (1.90, 0, 0.165), (2.02, 0, 0.20), (2.10, 0, 0.245)]),
    # rocker bottom corner (sill underside)
    'RB': dict(y0=-1.90, y1=2.04, kinks=[], knots=[
        (-1.90, 0.72, 0.215), (-1.84, 0.75, 0.20), (-1.76, 0.772, 0.19), (-1.65, 0.784, 0.18),
        (-1.30, 0.79, 0.172), (0.0, 0.79, 0.165), (1.30, 0.79, 0.172), (1.75, 0.784, 0.185),
        (1.90, 0.765, 0.20), (1.98, 0.735, 0.225), (2.04, 0.69, 0.27)]),
    # side-skirt top edge (crease), lower bumper line at the ends
    'SK': dict(y0=-1.905, y1=2.045, kinks=[], knots=[
        (-1.905, 0.735, 0.268), (-1.85, 0.77, 0.26), (-1.77, 0.795, 0.256), (-1.65, 0.814, 0.26),
        (-1.30, 0.83, 0.275), (-0.90, 0.836, 0.29), (0.0, 0.84, 0.30), (0.90, 0.84, 0.305),
        (1.30, 0.836, 0.31), (1.75, 0.826, 0.318), (1.88, 0.808, 0.321), (1.96, 0.78, 0.324),
        (2.045, 0.715, 0.332)]),
    # upper edge of the door scoop (crease rising rearwards)
    'UC': dict(y0=-1.91, y1=2.05, kinks=[], knots=[
        (-1.91, 0.745, 0.33), (-1.85, 0.78, 0.345), (-1.77, 0.805, 0.36), (-1.65, 0.822, 0.375),
        (-1.30, 0.826, 0.39), (-0.90, 0.829, 0.40), (-0.40, 0.83, 0.445), (0.20, 0.832, 0.515),
        (0.85, 0.834, 0.59), (1.30, 0.834, 0.585), (1.75, 0.826, 0.55), (1.88, 0.812, 0.535),
        (1.96, 0.785, 0.515), (2.05, 0.72, 0.462)]),
    # shoulder crease: the long character line
    'SCR': dict(y0=-1.92, y1=2.055, kinks=[], knots=[
        (-1.92, 0.75, 0.40), (-1.87, 0.778, 0.47), (-1.80, 0.80, 0.545), (-1.72, 0.817, 0.615),
        (-1.60, 0.828, 0.672), (-1.45, 0.834, 0.703), (-1.30, 0.836, 0.715), (-0.95, 0.837, 0.742),
        (-0.60, 0.838, 0.772), (0.0, 0.839, 0.808), (0.80, 0.84, 0.848), (1.30, 0.84, 0.868),
        (1.70, 0.834, 0.876), (1.85, 0.82, 0.872), (1.94, 0.805, 0.862), (1.99, 0.792, 0.79),
        (2.03, 0.772, 0.67), (2.055, 0.74, 0.53)]),
    # belt: window sill in the cabin; fender top in front; rear-quarter top behind
    'BL': dict(y0=-1.93, y1=2.06, kinks=[], knots=[
        (-1.93, 0.75, 0.455), (-1.89, 0.77, 0.53), (-1.83, 0.782, 0.6), (-1.75, 0.786, 0.66),
        (-1.63, 0.784, 0.705), (-1.45, 0.778, 0.722), (-1.20, 0.772, 0.745), (-1.05, 0.768, 0.775),
        (Y_COWL, 0.762, 0.822), (-0.80, 0.762, 0.852), (-0.55, 0.764, 0.872), (0.0, 0.768, 0.898),
        (0.40, 0.77, 0.92), (0.80, 0.77, 0.945), (Y_DLO_END, 0.768, 0.965), (1.50, 0.762, 0.968),
        (1.75, 0.752, 0.962), (1.88, 0.742, 0.955), (1.94, 0.736, 0.948), (1.99, 0.74, 0.86),
        (2.025, 0.742, 0.72), (2.06, 0.725, 0.575)]),
    # roof rail = side glass top edge; A-pillar outer edge; hood/fender line in front
    'RR': dict(y0=-2.05, y1=2.095, kinks=[Y_COWL, Y_HEADER], knots=[
        (-2.05, 0.53, 0.47), (-2.01, 0.565, 0.54), (-1.95, 0.60, 0.592), (-1.86, 0.63, 0.628),
        (-1.70, 0.655, 0.665), (-1.45, 0.672, 0.712), (-1.20, 0.69, 0.765), (Y_COWL, 0.705, 0.845),
        (-0.55, 0.66, 1.05), (Y_HEADER, 0.597, 1.245),
        (0.10, 0.59, 1.262), (0.30, 0.59, 1.258), (Y_HATCH0, 0.595, 1.245), (0.70, 0.612, 1.208),
        (0.90, 0.64, 1.145), (1.05, 0.68, 1.075), (Y_DLO_END, 0.73, 1.005), (1.40, 0.738, 0.99),
        (1.60, 0.738, 0.982), (1.80, 0.73, 0.972), (1.94, 0.712, 0.962), (2.00, 0.705, 0.88),
        (2.045, 0.69, 0.72), (2.095, 0.655, 0.592)]),
    # roof-rail inner = windscreen edge; C-pillar sail behind
    'RI': dict(y0=-2.11, y1=2.11, kinks=[Y_COWL, Y_HEADER], knots=[
        (-2.11, 0.40, 0.474), (-2.065, 0.43, 0.555), (-1.995, 0.47, 0.605), (-1.88, 0.505, 0.64),
        (-1.65, 0.54, 0.684), (-1.30, 0.585, 0.753), (-1.10, 0.62, 0.797), (Y_COWL, 0.655, 0.847),
        (-0.55, 0.635, 1.055), (Y_HEADER, 0.57, 1.262),
        (0.10, 0.563, 1.28), (0.30, 0.563, 1.277), (Y_HATCH0, 0.568, 1.266), (0.75, 0.585, 1.226),
        (1.05, 0.615, 1.152), (1.35, 0.648, 1.068), (1.72, 0.665, 0.99), (1.94, 0.652, 0.968),
        (2.00, 0.645, 0.89), (2.055, 0.62, 0.72), (2.11, 0.575, 0.598)]),
    # roof inner = hatch glass edge
    'R1': dict(y0=-2.155, y1=2.12, kinks=KINK_TOP, knots=[
        (-2.155, 0.27, 0.48), (-2.11, 0.29, 0.565), (-2.035, 0.31, 0.607), (-1.90, 0.33, 0.642),
        (-1.65, 0.36, 0.69), (-1.30, 0.39, 0.765), (Y_COWL, 0.43, 0.854),
        (-0.55, 0.435, 1.072), (Y_HEADER, 0.415, 1.283),
        (0.10, 0.41, 1.303), (0.30, 0.41, 1.30), (Y_HATCH0, 0.418, 1.288), (0.75, 0.445, 1.251),
        (1.05, 0.475, 1.185), (1.35, 0.505, 1.097), (1.55, 0.52, 1.04), (Y_HATCH1, 0.53, 0.995),
        (1.83, 0.533, 0.982), (Y_LIP, 0.53, 0.975), (2.00, 0.525, 0.88), (2.06, 0.51, 0.71),
        (2.12, 0.47, 0.605)]),
    # top centre line
    'T': dict(y0=-2.20, y1=2.13, kinks=KINK_TOP, knots=[
        (-2.20, 0, 0.49), (-2.185, 0, 0.535), (-2.15, 0, 0.58), (-2.09, 0, 0.615), (-1.98, 0, 0.645),
        (-1.80, 0, 0.677), (-1.50, 0, 0.732), (-1.30, 0, 0.772), (-1.10, 0, 0.818), (Y_COWL, 0, 0.858),
        (-0.55, 0, 1.082), (Y_HEADER, 0, 1.292),
        (0.10, 0, 1.313), (0.30, 0, 1.311), (Y_HATCH0, 0, 1.30), (0.75, 0, 1.264), (1.05, 0, 1.20),
        (1.35, 0, 1.113), (1.55, 0, 1.055), (Y_HATCH1, 0, 1.01), (1.83, 0, 0.995), (Y_LIP, 0, 0.988),
        (1.965, 0, 0.94), (1.99, 0, 0.85), (2.015, 0, 0.755), (2.04, 0, 0.685), (2.07, 0, 0.648),
        (2.10, 0, 0.625), (2.13, 0, 0.61)]),
}

# Wheel-arch flares: extra half-width per row (front, rear) peaking at the axle.
FLARE = {'RO': (0.008, 0.010), 'SK': (0.012, 0.016), 'SC1': (0.018, 0.022), 'UC': (0.024, 0.028),
         'FL': (0.027, 0.031), 'SCR': (0.016, 0.020), 'SH': (0.006, 0.008)}
FLARE_W = (0.58, 0.62)

# Door scoop depth along y (inset of the SC1 row between skirt and scoop crease)
SCOOP = Curve1D([(-2.3, 0.0), (-0.95, 0.0), (-0.45, 0.012), (0.20, 0.022), (0.75, 0.028), (1.0, 0.028),
                 (1.35, 0.0), (2.2, 0.0)])

# Half-section row order and how many extra spline points go in each segment.
N_FLOOR = 10      # floor segments K..RB (must equal the top group's segment count)
SIDE_ROWS = ['RB', 'RO', 'SK', 'SC1', 'UC', 'FL', 'SCR', 'SH', 'BL']
SIDE_EXTRA = [1, 0, 0, 0, 0, 0, 1, 0]
TOP_ROWS = ['BL', 'G1', 'RR', 'RI', 'R1', 'R2', 'T']
TOP_EXTRA = [1, 0, 0, 1, 1, 1]
CREASE_ROWS = {'SK', 'UC', 'SCR', 'BL', 'RR', 'RI'}


class Row:
    def __init__(self, spec):
        self.y0, self.y1 = spec['y0'], spec['y1']
        kn = spec['knots']
        self.fx = Curve1D([(k[0], k[1]) for k in kn], spec['kinks'])
        self.fz = Curve1D([(k[0], k[2]) for k in kn], spec['kinks'])

    def y_at(self, Y):
        if Y < Y_FZ:
            s = (Y - Y_MIN) / (Y_FZ - Y_MIN)
            return lerp(self.y0, Y_FZ, s)
        if Y > Y_RZ:
            s = (Y - Y_RZ) / (Y_MAX - Y_RZ)
            return lerp(Y_RZ, self.y1, s)
        return Y

    def at(self, Y):
        y = self.y_at(Y)
        return Vector((self.fx(y), y, self.fz(y)))


ROW_OBJS = {k: Row(v) for k, v in ROWS.items()}


def flare(name, y):
    if name not in FLARE:
        return 0.0
    a_f, a_r = FLARE[name]
    return a_f * cos_bump(y, Y_FA, FLARE_W[0]) + a_r * cos_bump(y, Y_RA, FLARE_W[1])


def outward_normal(a, b):
    """Normal (in the section, pointing away from the car centre) of chord a->b."""
    t = b - a
    # section plane is ~XZ; rotate the chord by -90 deg about Y
    n = Vector((t.z, 0.0, -t.x))
    # make it point outward (+x or +z)
    c = (a + b) * 0.5
    if n.x * c.x + n.z * (c.z - 0.7) < 0:
        n = -n
    return n.normalized() if n.length > 1e-9 else Vector((1, 0, 0))


def section_rows(Y):
    """All named row points at station Y (left half, x >= 0)."""
    P = {k: r.at(Y) for k, r in ROW_OBJS.items()}
    P['K'].x = 0.0
    P['T'].x = 0.0
    y_mid = P['SCR'].y
    cab = smoothstep(-1.10, -0.90, y_mid) * (1 - smoothstep(1.10, 1.30, y_mid))
    # derived rows
    P['RO'] = lerp(P['RB'], P['SK'], 0.5) + outward_normal(P['RB'], P['SK']) * 0.012
    P['SC1'] = lerp(P['SK'], P['UC'], 0.5) - outward_normal(P['SK'], P['UC']) * SCOOP(lerp(P['SK'].y, P['UC'].y, 0.5))
    P['FL'] = lerp(P['UC'], P['SCR'], 0.5) + outward_normal(P['UC'], P['SCR']) * 0.004
    P['SH'] = lerp(P['SCR'], P['BL'], 0.45) + outward_normal(P['SCR'], P['BL']) * 0.012
    P['G1'] = lerp(P['BL'], P['RR'], 0.5) + outward_normal(P['BL'], P['RR']) * (0.004 + 0.010 * cab)
    r2 = lerp(P['R1'], P['T'], 0.5)
    r2.z = P['T'].z - 0.28 * (P['T'].z - P['R1'].z)
    P['R2'] = r2
    for name in list(P.keys()):
        f = flare(name, P[name].y)
        if f:
            P[name] = P[name] + Vector((f, 0, 0))
    # floor rows between keel and rocker
    floor = []
    for i in range(1, N_FLOOR):
        t = i / N_FLOOR
        p = Vector((P['RB'].x * t,
                    lerp(P['K'].y, P['RB'].y, t * t),
                    P['K'].z + (P['RB'].z - P['K'].z) * max(0.0, (t - 0.8) / 0.2) ** 2))
        floor.append(p)
    return P, floor


def catmull(p0, p1, p2, p3, t, alpha=0.5):
    """Centripetal Catmull-Rom between p1 and p2."""
    def tj(ti, a, b):
        return ti + max((b - a).length, 1e-6) ** alpha
    t0 = 0.0
    t1 = tj(t0, p0, p1)
    t2 = tj(t1, p1, p2)
    t3 = tj(t2, p2, p3)
    tt = lerp(t1, t2, t)
    a1 = p0 * ((t1 - tt) / (t1 - t0)) + p1 * ((tt - t0) / (t1 - t0))
    a2 = p1 * ((t2 - tt) / (t2 - t1)) + p2 * ((tt - t1) / (t2 - t1))
    a3 = p2 * ((t3 - tt) / (t3 - t2)) + p3 * ((tt - t2) / (t3 - t2))
    b1 = a1 * ((t2 - tt) / (t2 - t0)) + a2 * ((tt - t0) / (t2 - t0))
    b2 = a2 * ((t3 - tt) / (t3 - t1)) + a3 * ((tt - t1) / (t3 - t1))
    return b1 * ((t2 - tt) / (t2 - t1)) + b2 * ((tt - t1) / (t2 - t1))


def resample_group(pts, extras, names, mirror_end=None):
    """pts: key points of one smooth group (list), extras[i]: points inserted in segment i.
    mirror_end: 'last' if the group ends on the centre line (use mirrored neighbour)."""
    out, out_names = [], []
    n = len(pts)
    for i in range(n - 1):
        p1, p2 = pts[i], pts[i + 1]
        p0 = pts[i - 1] if i > 0 else p1 * 2 - p2
        if i + 2 < n:
            p3 = pts[i + 2]
        elif mirror_end == 'last':
            q = pts[i]
            p3 = Vector((-q.x, q.y, q.z))
        else:
            p3 = p2 * 2 - p1
        out.append(p1)
        out_names.append(names[i])
        for k in range(extras[i]):
            out.append(catmull(p0, p1, p2, p3, (k + 1) / (extras[i] + 1)))
            out_names.append(None)
    return out, out_names


def half_section(Y):
    """Resampled half section from keel (index 0) to top centre (last), plus row names."""
    P, floor = section_rows(Y)
    pts = [P['K']] + floor + [P['RB']]
    names = ['K'] + ['F%d' % i for i in range(1, N_FLOOR)] + ['RB']
    # side group: split at creases into smooth runs
    side_pts, side_names = [], []
    run_p, run_n, run_e = [P['RB']], ['RB'], []
    for i in range(1, len(SIDE_ROWS)):
        nm = SIDE_ROWS[i]
        run_p.append(P[nm])
        run_n.append(nm)
        run_e.append(SIDE_EXTRA[i - 1])
        if nm in CREASE_ROWS or i == len(SIDE_ROWS) - 1:
            rp, rn = resample_group(run_p, run_e, run_n)
            side_pts += rp
            side_names += rn
            run_p, run_n, run_e = [P[nm]], [nm], []
    top_pts, top_names = [], []
    run_p, run_n, run_e = [P['BL']], ['BL'], []
    for i in range(1, len(TOP_ROWS)):
        nm = TOP_ROWS[i]
        run_p.append(P[nm])
        run_n.append(nm)
        run_e.append(TOP_EXTRA[i - 1])
        if nm in CREASE_ROWS or i == len(TOP_ROWS) - 1:
            rp, rn = resample_group(run_p, run_e, run_n, mirror_end='last' if nm == 'T' else None)
            top_pts += rp
            top_names += rn
            run_p, run_n, run_e = [P[nm]], [nm], []
    top_pts.append(P['T'])
    top_names.append('T')
    allp = pts[:-1] + side_pts + top_pts
    alln = names[:-1] + side_names + top_names
    return allp, alln


# ----------------------------------------------------------------------------------------
# Scene / materials
# ----------------------------------------------------------------------------------------
PALETTE = {  # preview colours only (the game uses its own palette by material name)
    'paint': (0.91, 0.89, 0.84), 'accent': (0.03, 0.03, 0.04), 'trim': (0.012, 0.012, 0.02),
    'glass': (0.01, 0.017, 0.05), 'metal': (0.58, 0.63, 0.70), 'tyre': (0.015, 0.015, 0.02),
    'rim': (0.58, 0.61, 0.69), 'headlamp': (0.74, 0.80, 0.89), 'taillamp': (0.55, 0.01, 0.03),
    'indicator': (0.87, 0.33, 0.01), 'clearlens': (0.69, 0.72, 0.79), 'reverse': (0.85, 0.87, 0.9),
    'interior': (0.02, 0.02, 0.03), 'plate': (0.87, 0.87, 0.81), 'grille': (0.008, 0.008, 0.012),
    'underbody': (0.008, 0.008, 0.01),
}
MAT_NAMES = list(PALETTE.keys())


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


def make_materials():
    mats = {}
    for name in MAT_NAMES:
        m = bpy.data.materials.new(name)
        col = PALETTE[name]
        m.diffuse_color = (*col, 1.0)
        nt = m.node_tree
        if nt is not None:
            bsdf = nt.nodes.get('Principled BSDF')
            if bsdf:
                bsdf.inputs['Base Color'].default_value = (*col, 1.0)
                rough = {'glass': 0.08, 'paint': 0.3, 'metal': 0.2, 'rim': 0.25, 'tyre': 0.8,
                         'headlamp': 0.1, 'clearlens': 0.1, 'taillamp': 0.15}.get(name, 0.5)
                bsdf.inputs['Roughness'].default_value = rough
                if name in ('metal', 'rim'):
                    bsdf.inputs['Metallic'].default_value = 0.8
        mats[name] = m
    return mats


class MeshBuilder:
    """Collects verts/faces with material names; becomes one Blender object."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mat_index = {n: i for i, n in enumerate(MAT_NAMES)}

    def v(self, p):
        return self.bm.verts.new(p)

    def f(self, vs, mat, smooth=True):
        try:
            face = self.bm.faces.new(vs)
        except ValueError:
            return None
        face.material_index = self.mat_index[mat]
        face.smooth = smooth
        return face

    def to_object(self, name, mats, link=True):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for n in MAT_NAMES:
            me.materials.append(mats[n])
        ob = bpy.data.objects.new(name, me)
        if link:
            bpy.context.scene.collection.objects.link(ob)
        return ob


# ----------------------------------------------------------------------------------------
# Body shell
# ----------------------------------------------------------------------------------------
def build_body_shell(mats):
    mb = MeshBuilder()
    rings, names = [], None
    for Y in STATIONS:
        half, nm = half_section(Y)
        if names is None:
            names = nm
        rings.append(half)
    N = len(names)
    idx = {n: i for i, n in enumerate(names) if n}
    h_rb, h_bl = idx['RB'], idx['BL']
    nb = h_rb
    nt = N - 1 - h_bl
    ns = h_bl - h_rb
    assert nb == nt, 'floor segments (%d) must match top segments (%d)' % (nb, nt)
    M = 2 * (N - 1)

    def ring_index(h, side):
        if h == 0 or h == N - 1 or side > 0:
            return h
        return M - h

    verts = []
    for j, half in enumerate(rings):
        vr = [None] * M
        for h, p in enumerate(half):
            vr[h] = mb.v(p)
        for h in range(1, N - 1):
            p = half[h]
            vr[M - h] = mb.v((-p.x, p.y, p.z))
        verts.append(vr)

    def seg_half(k):
        """half index range (lo) of ring segment k..k+1, and which side."""
        if k < N - 1:
            return k, +1
        return M - (k + 1), -1   # segment between M-h-1 .. M-h  ->  half seg (h, h+1) with h = M-k-1

    S = len(STATIONS)
    face_info = {}
    for j in range(S - 1):
        ya, yb = STATIONS[j], STATIONS[j + 1]
        ymid = 0.5 * (ya + yb)
        for k in range(M):
            k2 = (k + 1) % M
            hlo, side = seg_half(k)
            mat = 'paint'
            if hlo < h_rb:
                mat = 'underbody'
            elif hlo < idx['SK'] and STATIONS[j] >= 1.98:
                mat = 'trim'
            # glass & trim by row/station
            if Y_COWL <= ymid <= Y_HEADER and hlo >= idx['RI']:
                mat = 'glass'
            if Y_HATCH0 <= ymid <= Y_HATCH1 and hlo >= idx['R1']:
                mat = 'glass'
            if idx['BL'] <= hlo < idx['RR']:
                if Y_COWL <= ymid <= Y_SAIL:
                    mat = 'trim'
                elif Y_SAIL <= ymid <= Y_DLO_END:
                    mat = 'trim' if Y_BPIL0 <= ymid <= Y_BPIL1 else 'glass'
            face = mb.f([verts[j][k], verts[j][k2], verts[j + 1][k2], verts[j + 1][k]], mat)
            if face:
                face_info[face] = (j, hlo)

    # Coons caps at both ends
    for j in (0, S - 1):
        half = rings[j]
        vr = verts[j]
        B = [vr[ring_index(h_rb - i, +1)] for i in range(nb)] + [vr[0]] + \
            [vr[ring_index(i, -1)] for i in range(1, nb + 1)]
        Tt = [vr[ring_index(h_bl + i, +1)] for i in range(nt)] + [vr[N - 1]] + \
             [vr[ring_index(N - 1 - i, -1)] for i in range(1, nt + 1)]
        L = [vr[ring_index(h_rb + i, +1)] for i in range(ns + 1)]
        R = [vr[ring_index(h_rb + i, -1)] for i in range(ns + 1)]

        def arcp(vl):
            d = [0.0]
            for a, b in zip(vl[:-1], vl[1:]):
                d.append(d[-1] + (b.co - a.co).length)
            return [x / d[-1] for x in d]
        sB, sT, vL, vR = arcp(B), arcp(Tt), arcp(L), arcp(R)
        nu = 2 * nb
        grid = [[None] * (ns + 1) for _ in range(nu + 1)]
        for i in range(nu + 1):
            grid[i][0] = B[i]
            grid[i][ns] = Tt[i]
        for jj in range(ns + 1):
            grid[0][jj] = L[jj]
            grid[nu][jj] = R[jj]
        P00, P10, P01, P11 = B[0].co, B[nu].co, Tt[0].co, Tt[nu].co
        for i in range(1, nu):
            s = 0.5 * (sB[i] + sT[i])
            for jj in range(1, ns):
                v = 0.5 * (vL[jj] + vR[jj])
                p = (B[i].co * (1 - v) + Tt[i].co * v + L[jj].co * (1 - s) + R[jj].co * s
                     - (P00 * (1 - s) * (1 - v) + P10 * s * (1 - v) + P01 * (1 - s) * v + P11 * s * v))
                grid[i][jj] = mb.v(p)
        for i in range(nu):
            for jj in range(ns):
                mat = 'trim' if (j > 0 and jj < 3) else 'paint'
                mb.f([grid[i][jj], grid[i + 1][jj], grid[i + 1][jj + 1], grid[i][jj + 1]], mat)

    bm = mb.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    dissolve_floor(bm)
    ob = mb.to_object('body_shell', mats)
    return ob, dict(names=names, idx=idx, rings=rings)


def dissolve_floor(bm):
    """Merge the flat underbody quads into a few polygons (nobody sees the floor)."""
    bm.normal_update()
    ub = MAT_NAMES.index('underbody')
    flat = set(f for f in bm.faces if f.material_index == ub and f.normal.z < -0.995)
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and all(f in flat for f in e.link_faces)]
    bmesh.ops.dissolve_edges(bm, edges=edges, use_verts=True)
    # the sloped floor near the ends: merge strips that are flat across
    ubf = [f for f in bm.faces if f.material_index == ub]
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and all(f.material_index == ub for f in e.link_faces)]
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(2.0), verts=[], edges=edges)


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def cylinder_x(name, mats, x0, x1, y, z, r, segs, mat='underbody'):
    mb = MeshBuilder()
    a = [mb.v((x0, y + r * math.cos(2 * math.pi * i / segs), z + r * math.sin(2 * math.pi * i / segs)))
         for i in range(segs)]
    b = [mb.v((x1, y + r * math.cos(2 * math.pi * i / segs), z + r * math.sin(2 * math.pi * i / segs)))
         for i in range(segs)]
    for i in range(segs):
        mb.f([a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]], mat)
    mb.f(list(reversed(a)), mat)
    mb.f(b, mat)
    bmesh.ops.recalc_face_normals(mb.bm, faces=mb.bm.faces)
    return mb.to_object(name, mats)


def boolean_cut(target, cutters, solver='EXACT'):
    for c in cutters:
        mod = target.modifiers.new('cut_' + c.name, 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = solver
        mod.object = c
        mod.material_mode = 'TRANSFER'
        c.hide_render = True
        c.hide_viewport = True
    apply_modifiers(target)
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)
    # the exact solver can leave sub-millimetre slivers where a cutter grazes a station line;
    # weld them so no zero-area or duplicate faces reach the export
    bm = bmesh.new()
    bm.from_mesh(target.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0015)
    bmesh.ops.dissolve_degenerate(bm, dist=0.0005, edges=bm.edges)
    seen = set()
    dup = []
    for f in bm.faces:
        key = frozenset(v.index for v in f.verts)
        if key in seen or len(key) < 3:
            dup.append(f)
        seen.add(key)
    bmesh.ops.delete(bm, geom=dup, context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context='EDGES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_edges], context='VERTS')
    bm.to_mesh(target.data)
    bm.free()
    # material slots: TRANSFER may append duplicates; remap by name to the canonical list
    remap_materials(target)


def remap_materials(ob):
    me = ob.data
    names = [m.name.split('.')[0] if m else 'paint' for m in me.materials]
    canon = {n: i for i, n in enumerate(MAT_NAMES)}
    idx_map = [canon.get(n, 0) for n in names]
    mi = [0] * len(me.polygons)
    me.polygons.foreach_get('material_index', mi)
    mi = [idx_map[i] if i < len(idx_map) else 0 for i in mi]
    me.materials.clear()
    for n in MAT_NAMES:
        me.materials.append(bpy.data.materials[n])
    me.polygons.foreach_set('material_index', mi)
    me.update()


def cut_wheel_arches(body, mats):
    cutters = []
    for yc, tag in ((Y_FA, 'F'), (Y_RA, 'R')):
        for sx in (1, -1):
            x0, x1 = (0.47, 1.4) if sx > 0 else (-1.4, -0.47)
            cutters.append(cylinder_x('arch_%s%d' % (tag, sx), mats, x0, x1, yc, ARCH_ZC, ARCH_R, 32))
    boolean_cut(body, cutters)


def mark_sharp(ob, angle_deg=40.0):
    """Sharp at material boundaries and at strong creases; everything shaded smooth."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    lim = math.radians(angle_deg)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2:
            e.smooth = False
            continue
        f1, f2 = e.link_faces
        sharp = f1.material_index != f2.material_index or f1.normal.angle(f2.normal, 0) > lim
        e.smooth = not sharp
    bm.to_mesh(ob.data)
    bm.free()


# ----------------------------------------------------------------------------------------
# Surface projections (rays are cast from outside towards the body, first hit wins).
# Every projection is authored for the car's left side (+X); sx=-1 mirrors it.
# ----------------------------------------------------------------------------------------
class SphereProj:
    """Directions from an interior centre c: u = azimuth from -Y towards +X, v = elevation."""

    def __init__(self, c, sx=1):
        self.c, self.sx = Vector(c), sx

    def uv(self, p):
        d = (Vector(p) - self.c).normalized()
        return (math.atan2(d.x, -d.y), math.asin(max(-1.0, min(1.0, d.z))))

    def uvw(self, p):
        return self.uv((p[0] * self.sx, p[1], p[2]))

    def ray(self, u, v):
        d = Vector((math.sin(u) * math.cos(v), -math.cos(u) * math.cos(v), math.sin(v)))
        o = self.c + d * 3.0
        return Vector((o.x * self.sx, o.y, o.z)), Vector((-d.x * self.sx, -d.y, -d.z))


class CylProj:
    """Horizontal rays round a vertical axis through (x0, y0): u = angle from +Y towards +X, v = z."""

    def __init__(self, x0, y0, sx=1):
        self.x0, self.y0, self.sx = x0, y0, sx

    def uv(self, p):
        return (math.atan2(p[0] - self.x0, p[1] - self.y0), p[2])

    def uvw(self, p):
        return self.uv((p[0] * self.sx, p[1], p[2]))

    def ray(self, u, v):
        d = Vector((math.sin(u), math.cos(u), 0.0))
        o = Vector((self.x0, self.y0, v)) + d * 3.0
        return Vector((o.x * self.sx, o.y, o.z)), Vector((-d.x * self.sx, -d.y, 0.0))


class PlaneProj:
    """Orthographic. side '+x' (left flank, uv=(y,z)), '-y' (front, uv=(x,z)), '+y' (rear, uv=(x,z))."""

    def __init__(self, side, sx=1):
        self.side, self.sx = side, sx

    def uv(self, p):
        return (p[1], p[2]) if self.side == '+x' else (p[0], p[2])

    def uvw(self, p):
        return self.uv((p[0] * self.sx, p[1], p[2]))

    def ray(self, u, v):
        if self.side == '+x':
            return Vector((3.0 * self.sx, u, v)), Vector((-self.sx, 0, 0))
        if self.side == '-y':
            return Vector((u * self.sx, -4.0, v)), Vector((0, 1, 0))
        return Vector((u * self.sx, 4.0, v)), Vector((0, -1, 0))


class Surface:
    """BVH over the body (and anything added to it so far)."""

    def __init__(self, bm):
        self.bm = bm
        self.rebuild()

    def rebuild(self):
        self.bm.normal_update()
        self.bvh = BVHTree.FromBMesh(self.bm)

    def hit(self, proj, u, v):
        o, d = proj.ray(u, v)
        loc, nrm, idx, dist = self.bvh.ray_cast(o, d, 20.0)
        if loc is None:
            raise RuntimeError('decal ray missed the body at uv=(%.3f, %.3f)' % (u, v))
        if nrm.dot(d) > 0:
            nrm = -nrm
        return loc, nrm


def catmull_open(pts, n_out):
    """Resample an open polyline (list of tuples) to n_out+1 points with Catmull-Rom (uniform t)."""
    P = [Vector((p[0], p[1], 0.0)) for p in pts]
    m = len(P) - 1
    out = []
    for k in range(n_out + 1):
        t = k / n_out * m
        i = min(int(t), m - 1)
        f = t - i
        p0 = P[i - 1] if i > 0 else P[0] * 2 - P[1]
        p3 = P[i + 2] if i + 2 <= m else P[m] * 2 - P[m - 1]
        p1, p2 = P[i], P[i + 1]
        q = 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f
                   + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
        out.append((q.x, q.y))
    return out


def tangent_frame(n):
    a = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
    t1 = n.cross(a).normalized()
    t2 = n.cross(t1).normalized()
    return t1, t2


class Details:
    """Adds closed detail shells into the body bmesh."""

    def __init__(self, bm, mats):
        self.bm = bm
        self.mi = {n: i for i, n in enumerate(MAT_NAMES)}
        self.surf = Surface(bm)
        self.lamps = {}

    # -- primitives ------------------------------------------------------------------
    def v(self, p):
        return self.bm.verts.new(p)

    def f(self, vs, mat, smooth=True):
        uniq = []
        for x in vs:
            if x not in uniq:
                uniq.append(x)
        if len(uniq) < 3:
            return None
        try:
            face = self.bm.faces.new(uniq)
        except ValueError:
            return None
        face.material_index = self.mi[mat]
        face.smooth = smooth
        return face

    # -- conforming patch --------------------------------------------------------------
    def patch(self, proj, grid, mat, lift=0.004, dome=0.0, sink=0.02, closed_u=False, dome_fn=None):
        """grid[k][s] = (u, v). Builds a closed shell: lifted top, side walls, bottom cap.
        Columns whose points coincide collapse to one vertex (pointed tips)."""
        K, S = len(grid), len(grid[0])
        cache = {}
        top = [[None] * S for _ in range(K)]
        base = {}
        for k in range(K):
            for s_ in range(S):
                u, v = grid[k][s_]
                key = (round(u, 7), round(v, 7))
                if key in cache:
                    top[k][s_] = cache[key]
                    continue
                p, n = self.surf.hit(proj, u, v)
                if dome_fn:
                    h = dome_fn(k / max(K - 1, 1), s_ / max(S - 1, 1))
                elif closed_u:
                    h = math.sin(0.5 * math.pi * s_ / max(S - 1, 1))
                else:
                    h = math.sin(math.pi * s_ / max(S - 1, 1)) * math.sin(math.pi * k / max(K - 1, 1)) ** 0.35
                vert = self.v(p + n * (lift + dome * h))
                base[vert] = (p, n)
                cache[key] = vert
                top[k][s_] = vert
        kr = range(K) if closed_u else range(K - 1)
        for k in kr:
            k2 = (k + 1) % K
            for s_ in range(S - 1):
                self.f([top[k][s_], top[k2][s_], top[k2][s_ + 1], top[k][s_ + 1]], mat)
        # boundary loop
        if closed_u:
            loop = [top[k][0] for k in range(K)]
        else:
            loop = [top[k][0] for k in range(K)] + [top[K - 1][s_] for s_ in range(1, S)] + \
                   [top[k][S - 1] for k in range(K - 2, -1, -1)] + [top[0][s_] for s_ in range(S - 2, 0, -1)]
        clean = []
        for x in loop:
            if not clean or clean[-1] is not x:
                clean.append(x)
        if len(clean) > 1 and clean[0] is clean[-1]:
            clean.pop()
        bot = []
        for x in clean:
            p, n = base[x]
            bot.append(self.v(p - n * sink))
        m = len(clean)
        for i in range(m):
            j = (i + 1) % m
            self.f([clean[i], clean[j], bot[j], bot[i]], mat)
        self.f(list(reversed(bot)), mat)
        return top

    def strip(self, proj, upper, lower, n_along, n_across, mat, **kw):
        """Elongated lens between two edge curves given as 3D guide points (left side)."""
        up = catmull_open([proj.uv(p) for p in upper], n_along)
        lo = catmull_open([proj.uv(p) for p in lower], n_along)
        grid = [[(lerp(up[k][0], lo[k][0], s_ / n_across), lerp(up[k][1], lo[k][1], s_ / n_across))
                 for s_ in range(n_across + 1)] for k in range(n_along + 1)]
        # exact tips where the edges meet
        for k in (0, n_along):
            if abs(up[k][0] - lo[k][0]) < 1e-6 and abs(up[k][1] - lo[k][1]) < 1e-6:
                grid[k] = [up[k]] * (n_across + 1)
        return self.patch(proj, grid, mat, **kw)

    def disc(self, proj, centre, r, mat, n=16, rings=2, squash=1.0, uv=None, **kw):
        """Round (or elliptical) lens of radius r centred on the surface under `centre` (left-side
        point) or under projection coordinates `uv`."""
        u0, v0 = uv if uv is not None else proj.uv(centre)
        p0, n0 = self.surf.hit(proj, u0, v0)
        t1, t2 = tangent_frame(n0)
        if abs(n0.z) < 0.9:   # keep ellipse axes horizontal / vertical-ish
            t1 = Vector((0, 0, 1)).cross(n0).normalized()
            t2 = n0.cross(t1).normalized()
        outline = []
        for i in range(n):
            a = 2 * math.pi * i / n
            q = p0 + t1 * (r * math.cos(a)) + t2 * (r * squash * math.sin(a))
            outline.append(proj.uvw(q))
        grid = []
        for i in range(n):
            col = []
            for s_ in range(rings + 1):
                f = 1 - s_ / rings
                col.append((lerp(u0, outline[i][0], f), lerp(v0, outline[i][1], f)))
            grid.append(col)
        self.patch(proj, grid, mat, closed_u=True, **kw)
        return p0, n0

    def outline_patch(self, proj, pts3, mat, rings=2, **kw):
        """Filled star-shaped outline (3D guide points, left side)."""
        uv = [proj.uv(p) for p in pts3]
        cu = sum(p[0] for p in uv) / len(uv)
        cv = sum(p[1] for p in uv) / len(uv)
        grid = [[(lerp(cu, p[0], 1 - s_ / rings), lerp(cv, p[1], 1 - s_ / rings)) for s_ in range(rings + 1)]
                for p in uv]
        return self.patch(proj, grid, mat, closed_u=True, **kw)

    # -- closed solids ------------------------------------------------------------------
    def loft(self, sections, mat, cap=True, mats_fn=None):
        """sections: list of closed loops (lists of 3D points, same count). Capped tube."""
        rings = [[self.v(p) for p in sec] for sec in sections]
        n = len(sections[0])
        for a_i, (a, b) in enumerate(zip(rings[:-1], rings[1:])):
            for i in range(n):
                i2 = (i + 1) % n
                m = mats_fn(a_i, i) if mats_fn else mat
                self.f([a[i], a[i2], b[i2], b[i]], m)
        if cap:
            self.f(list(reversed(rings[0])), mat)
            self.f(rings[-1], mat)
        return rings

    def box(self, centre, size, mat, rot=None):
        c = Vector(centre)
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        R = rot or Matrix.Identity(3)
        pts = [c + R @ Vector((sx * hx, sy * hy, sz * hz)) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
        vs = [self.v(p) for p in pts]
        for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            self.f([vs[i] for i in q], mat)


# ----------------------------------------------------------------------------------------
# Lamps and the other details (all authored on the left side, mirrored by projection)
# ----------------------------------------------------------------------------------------
HEAD_C = (0.30, -1.70, 0.40)
HEAD_UP = [(0.205, -2.175, 0.552), (0.32, -2.145, 0.603), (0.45, -2.095, 0.643), (0.58, -2.02, 0.675),
           (0.69, -1.915, 0.698), (0.765, -1.78, 0.712), (0.812, -1.62, 0.719), (0.838, -1.44, 0.716)]
HEAD_LO = [(0.205, -2.175, 0.552), (0.33, -2.14, 0.51), (0.48, -2.075, 0.485), (0.62, -1.998, 0.482),
           (0.725, -1.905, 0.495), (0.795, -1.77, 0.54), (0.828, -1.60, 0.635), (0.838, -1.44, 0.716)]
HEAD_N = 16

TAIL_AX = (0.40, 1.70)
TAIL_UP = [(0.272, 1.962, 0.946), (0.45, 1.958, 0.951), (0.60, 1.952, 0.948), (0.70, 1.94, 0.94),
           (0.77, 1.905, 0.928), (0.81, 1.845, 0.91), (0.832, 1.76, 0.888)]
TAIL_LO = [(0.335, 2.03, 0.726), (0.47, 2.032, 0.712), (0.60, 2.028, 0.712), (0.70, 2.01, 0.725),
           (0.77, 1.96, 0.76), (0.81, 1.875, 0.815), (0.832, 1.76, 0.888)]
TAIL_N = 16

FOG = (0.585, 0.29)            # (x, z) on the front bumper
INTAKE = dict(top=0.378, bot=0.212, half_top=0.30, half_bot=0.42, r=0.035, depth=0.07)
PLATE_R = dict(z=0.44, w=0.33, h=0.165)


def sub_curve(uvs, k0, k1, n):
    """Re-sample part [k0, k1] (float indices) of a sampled uv curve to n+1 points."""
    out = []
    for i in range(n + 1):
        t = lerp(k0, k1, i / n)
        a = min(int(t), len(uvs) - 2)
        f = t - a
        out.append((lerp(uvs[a][0], uvs[a + 1][0], f), lerp(uvs[a][1], uvs[a + 1][1], f)))
    return out


def inset_pair(up, lo, f):
    """Move two edge curves towards each other by fraction f (keeps a sub-lens inside its lens)."""
    nu = [(lerp(a[0], b[0], f), lerp(a[1], b[1], f)) for a, b in zip(up, lo)]
    nl = [(lerp(b[0], a[0], f), lerp(b[1], a[1], f)) for a, b in zip(up, lo)]
    return nu, nl


def grid_from_edges(up, lo, n_across):
    return [[(lerp(up[k][0], lo[k][0], s_ / n_across), lerp(up[k][1], lo[k][1], s_ / n_across))
             for s_ in range(n_across + 1)] for k in range(len(up))]


def rounded_rect(cx, cz, w, h, r, n_corner=3):
    pts = []
    for (qx, qz, a0) in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90),
                         (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n_corner + 1):
            a = math.radians(a0 + 90 * i / n_corner)
            pts.append((cx + qx + r * math.cos(a), cz + qz + r * math.sin(a)))
    return pts


def build_headlamps(D):
    for sx in (1, -1):
        D.strip(SphereProj(HEAD_C, sx), HEAD_UP, HEAD_LO, HEAD_N, 3, 'headlamp', lift=0.004, dome=0.008)
    D.surf.rebuild()
    for sx in (1, -1):
        proj = SphereProj(HEAD_C, sx)
        up = catmull_open([proj.uv(p) for p in HEAD_UP], HEAD_N)
        lo = catmull_open([proj.uv(p) for p in HEAD_LO], HEAD_N)
        # amber indicator along the lower edge of the inner tip
        iu, il = sub_curve(up, 0.6, 4.2, 6), sub_curve(lo, 0.6, 4.2, 6)
        iu = [(lerp(a[0], b[0], 0.55), lerp(a[1], b[1], 0.55)) for a, b in zip(iu, il)]
        il = [(lerp(b[0], a[0], 0.10), lerp(b[1], a[1], 0.10)) for a, b in zip(sub_curve(up, 0.6, 4.2, 6), il)]
        iu[0] = il[0] = (lerp(iu[0][0], il[0][0], 0.5), lerp(iu[0][1], il[0][1], 0.5))
        D.patch(proj, grid_from_edges(iu, il, 3), 'indicator', lift=0.0028, sink=0.006)
        # dark lower housing band carrying on from the indicator to the outer tip: by day the
        # lens is almost paint-white, so this is what makes the almond read in daylight
        bu, bl = sub_curve(up, 4.5, 14.9, 10), sub_curve(lo, 4.5, 14.9, 10)
        n_b = len(bu)
        hu, hl = [], []
        for i, (a, b) in enumerate(zip(bu, bl)):
            t = i / (n_b - 1)
            ft = lerp(0.62, 0.80, smoothstep(0.55, 1.0, t))     # top edge drops toward the outer tip
            hu.append((lerp(a[0], b[0], ft), lerp(a[1], b[1], ft)))
            hl.append((lerp(a[0], b[0], 0.90), lerp(a[1], b[1], 0.90)))
        hu[-1] = hl[-1] = (lerp(hu[-1][0], hl[-1][0], 0.5), lerp(hu[-1][1], hl[-1][1], 0.5))
        D.patch(proj, grid_from_edges(hu, hl, 2), 'trim', lift=0.0028, sink=0.006)
        D.surf.rebuild()
        # twin projectors: dark bezel + bright lens
        for kk, r in ((7.4, 0.040), (10.9, 0.044)):
            uu = sub_curve(up, kk, kk, 1)[0]
            ll = sub_curve(lo, kk, kk, 1)[0]
            c = (lerp(uu[0], ll[0], 0.45), lerp(uu[1], ll[1], 0.45))
            D.disc(proj, None, r, 'trim', uv=c, n=14, rings=1, lift=0.0015, sink=0.006)
        D.surf.rebuild()
        for kk, r in ((7.4, 0.028), (10.9, 0.031)):
            uu = sub_curve(up, kk, kk, 1)[0]
            ll = sub_curve(lo, kk, kk, 1)[0]
            c = (lerp(uu[0], ll[0], 0.45), lerp(uu[1], ll[1], 0.45))
            D.disc(proj, None, r, 'headlamp', uv=c, n=14, rings=1, lift=0.0015, dome=0.003, sink=0.004)
        D.surf.rebuild()
        mid = sub_curve(up, HEAD_N * 0.5, HEAD_N * 0.5, 1)[0], sub_curve(lo, HEAD_N * 0.5, HEAD_N * 0.5, 1)[0]
        c = (lerp(mid[0][0], mid[1][0], 0.5), lerp(mid[0][1], mid[1][1], 0.5))
        p, n = D.surf.hit(proj, *c)
        D.lamps['lamp_head_' + ('L' if sx > 0 else 'R')] = tuple(p)


def build_taillamps(D):
    for sx in (1, -1):
        D.strip(CylProj(*TAIL_AX, sx), TAIL_UP, TAIL_LO, TAIL_N, 3, 'clearlens', lift=0.004, dome=0.005)
    D.surf.rebuild()
    for sx in (1, -1):
        proj = CylProj(*TAIL_AX, sx)
        up = catmull_open([proj.uv(p) for p in TAIL_UP], TAIL_N)
        lo = catmull_open([proj.uv(p) for p in TAIL_LO], TAIL_N)
        # red wrap-round strip on the flank end
        # (sampled 3 across so it follows the domed lens instead of sinking under it as a chord)
        su, sl = sub_curve(up, 11.6, TAIL_N, 5), sub_curve(lo, 11.6, TAIL_N, 5)
        su, sl = inset_pair(su, sl, 0.16)
        su[-1] = sl[-1] = (lerp(su[-2][0], sl[-2][0], 0.5) * 0.3 + su[-1][0] * 0.7,
                           lerp(su[-2][1], sl[-2][1], 0.5) * 0.3 + su[-1][1] * 0.7)
        D.patch(proj, grid_from_edges(su, sl, 3), 'taillamp', lift=0.0022, sink=0.006)
        reds = []
        for (x, z, r, mat) in ((0.635, 0.83, 0.080, 'taillamp'), (0.42, 0.83, 0.074, 'taillamp'),
                               (0.528, 0.765, 0.024, 'indicator'), (0.528, 0.895, 0.024, 'reverse')):
            p, n = D.disc(proj, (x, 2.0, z), r, mat, n=18 if r > 0.05 else 10, rings=1, lift=0.0015,
                          dome=0.004 if r > 0.05 else 0.002, sink=0.006)
            if mat == 'taillamp':
                reds.append(p)
        D.surf.rebuild()
        # clear centres in the red rounds (the 'altezza' look)
        for (x, z, r) in ((0.635, 0.83, 0.026), (0.42, 0.83, 0.024)):
            D.disc(proj, (x, 2.0, z), r, 'clearlens', n=10, rings=1, lift=0.0015, sink=0.004)
        D.surf.rebuild()
        c = (reds[0] + reds[1]) * 0.5
        D.lamps['lamp_tail_' + ('L' if sx > 0 else 'R')] = tuple(c)


def build_front_lamps_and_plates(D):
    for sx in (1, -1):
        D.disc(PlaneProj('-y', sx), (FOG[0], 0, FOG[1]), 0.058, 'trim', n=14, rings=1, lift=0.003, sink=0.01)
    D.surf.rebuild()
    for sx in (1, -1):
        p, n = D.disc(PlaneProj('-y', sx), (FOG[0], 0, FOG[1]), 0.042, 'headlamp', n=14, rings=1,
                      lift=0.0015, dome=0.004, sink=0.006)
        D.lamps['lamp_fog_' + ('L' if sx > 0 else 'R')] = tuple(p)
    # rear plate on a dark recess-look bezel
    pr = PlaneProj('+y')
    bez = rounded_rect(0.0, PLATE_R['z'], PLATE_R['w'] + 0.03, PLATE_R['h'] + 0.026, 0.012)
    D.outline_patch(pr, [(x, 3.0, z) for x, z in bez], 'trim', rings=1, lift=0.003, sink=0.012)
    D.surf.rebuild()
    pl = rounded_rect(0.0, PLATE_R['z'], PLATE_R['w'], PLATE_R['h'], 0.008)
    D.outline_patch(pr, [(x, 3.0, z) for x, z in pl], 'plate', rings=1, lift=0.0025, sink=0.006)
    # rear reflectors on the bumper corners
    for sx in (1, -1):
        rr = rounded_rect(0.60, 0.372, 0.15, 0.024, 0.01, 2)
        D.outline_patch(PlaneProj('+y', sx), [(x, 3.0, z) for x, z in rr], 'taillamp', rings=1,
                        lift=0.0025, sink=0.008)
    D.surf.rebuild()


def build_body_lines(D):
    """Door shut lines, door handles and the fuel filler door: small closed shells."""
    w = 0.0045
    for sx in (1, -1):
        pj = PlaneProj('+x', sx)
        for line in ([(-0.856, 0.832), (-0.860, 0.60), (-0.866, 0.315)],
                     [(0.392, 0.905), (0.384, 0.62), (0.372, 0.312)]):
            upper = [(0.85, y - w, z) for y, z in line]
            lower = [(0.85, y + w, z) for y, z in line]
            D.strip(pj, upper, lower, 16, 1, 'trim', lift=0.0018, sink=0.004)
        hd = rounded_rect(0.255, 0.778, 0.11, 0.024, 0.01, 2)
        D.outline_patch(pj, [(0.85, y, z) for y, z in hd], 'trim', rings=1, lift=0.002, sink=0.006)
    # fuel filler door (right rear quarter): a dark shut-line plate with a paint door on top,
    # so it reads as a drawn outline from the chase / title cameras
    pr = PlaneProj('+x', -1)
    fd = rounded_rect(1.615, 0.800, 0.125, 0.112, 0.024, 3)
    D.outline_patch(pr, [(0.85, y, z) for y, z in fd], 'trim', rings=1, lift=0.0016, sink=0.006)
    D.surf.rebuild()
    fd = rounded_rect(1.615, 0.800, 0.107, 0.094, 0.017, 3)
    D.outline_patch(pr, [(0.85, y, z) for y, z in fd], 'paint', rings=1, lift=0.0016, sink=0.004)
    D.surf.rebuild()


def cut_intake(body, mats):
    """Boolean the lower front intake: a rounded trapezoid recess following the bumper face."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    surf = Surface(bm)
    I = INTAKE
    # trapezoid outline with rounded corners (front view, x/z)
    corners = [(I['half_top'], I['top']), (-I['half_top'], I['top']), (-I['half_bot'], I['bot']),
               (I['half_bot'], I['bot'])]
    pts = []
    n = len(corners)
    for i in range(n):
        p0, p1, p2 = Vector(corners[i - 1] + (0,)), Vector(corners[i] + (0,)), Vector(corners[(i + 1) % n] + (0,))
        a = (p0 - p1).normalized()
        b = (p2 - p1).normalized()
        q0, q1 = p1 + a * I['r'], p1 + b * I['r']
        for k in range(5):
            t = k / 4
            q = (q0 * (1 - t) ** 2 + p1 * 2 * t * (1 - t) + q1 * t * t)
            pts.append((q.x, q.y))
    pr = PlaneProj('-y')
    mb = MeshBuilder()
    front, back = [], []
    for (x, z) in pts:
        p, nrm = surf.hit(pr, x, z)
        front.append(mb.v(p + Vector((0, -0.2, 0))))
        back.append(mb.v(p + Vector((0, I['depth'], 0))))
    m = len(pts)
    for i in range(m):
        j = (i + 1) % m
        mb.f([front[i], front[j], back[j], back[i]], 'grille')
    mb.f(front, 'grille')
    mb.f(list(reversed(back)), 'grille')
    bmesh.ops.recalc_face_normals(mb.bm, faces=mb.bm.faces)
    bm.free()
    cutter = mb.to_object('intake_cutter', mats)
    boolean_cut(body, [cutter])


def build_lip(D, pts, out_dirs, mat, reach=0.04, drop=0.0):
    """Thin spoiler lip along a polyline of body edge points with outward (horizontal) directions."""
    secs = []
    up = Vector((0, 0, 1))
    for p, n in zip(pts, out_dirs):
        p = Vector(p)
        secs.append([p - n * 0.02 + up * 0.012, p + n * reach + up * (0.002 - drop),
                     p + n * (reach - 0.006) - up * (0.010 + drop), p - n * 0.02 - up * 0.016])
    D.loft(secs, mat)


def edge_dirs(pts):
    out = []
    for i in range(len(pts)):
        a = Vector(pts[max(i - 1, 0)])
        b = Vector(pts[min(i + 1, len(pts) - 1)])
        t = (b - a)
        t.z = 0
        t.normalize()
        n = Vector((t.y, -t.x, 0))
        out.append(n)
    # orient outward: away from the car centre in plan
    c = Vector((0, 0, 0))
    fixed = []
    for p, n in zip(pts, out):
        q = Vector((p[0], p[1], 0))
        if n.dot(q - c) < 0:
            n = -n
        fixed.append(n)
    return fixed


def build_lips(D, shell):
    rings, idx = shell['rings'], shell['idx']
    h_rb = idx['RB']
    S = len(STATIONS)
    # front: RB row from y=-1.72 to the nose, the bumper bottom edge, back along the other side
    jf = max(j for j, Y in enumerate(STATIONS) if Y <= -1.72)
    left = [tuple(rings[j][h_rb]) for j in range(jf, 0, -1)] + [tuple(rings[0][h]) for h in range(h_rb, 0, -1)]
    front = left + [(0.0, rings[0][0].y, rings[0][0].z)] + [(-p[0], p[1], p[2]) for p in reversed(left)]
    front = [(x, y, z + 0.004) for x, y, z in front][::2]
    build_lip(D, front, edge_dirs(front), 'trim', reach=0.035, drop=0.004)
    jr = min(j for j, Y in enumerate(STATIONS) if Y >= 1.80)
    left = [tuple(rings[j][h_rb]) for j in range(jr, S - 1)] + [tuple(rings[S - 1][h]) for h in range(h_rb, 0, -1)]
    rear = left + [(0.0, rings[S - 1][0].y, rings[S - 1][0].z)] + [(-p[0], p[1], p[2]) for p in reversed(left)]
    rear = [(x, y, z + 0.004) for x, y, z in rear][::2]
    build_lip(D, rear, edge_dirs(rear), 'trim', reach=0.025, drop=0.002)


def build_arch_lips(D):
    """Rolled lips round the wheel openings: they make the flares read in the cel shading."""
    R = ARCH_R
    for yc in (Y_FA, Y_RA):
        for sx in (1, -1):
            pj = PlaneProj('+x', sx)
            secs = []
            n = 24
            th0, th1 = math.radians(-14), math.radians(194)
            for i in range(n + 1):
                th = lerp(th0, th1, i / n)
                rho = Vector((0, math.cos(th), math.sin(th)))
                c = Vector((0, yc, ARCH_ZC))
                def xs(rad):
                    q = c + rho * rad
                    p, nrm = D.surf.hit(pj, q.y, q.z)
                    return abs(p.x)
                xa, xb = xs(R + 0.055), xs(R + 0.02)
                prof = [(xa - 0.003, R + 0.055), (xb + 0.013, R + 0.018), (xb - 0.002, R - 0.008)]
                sec = []
                for (x, rad) in prof:
                    q = c + rho * rad
                    sec.append(Vector((x * sx, q.y, q.z)))
                secs.append(sec)
            D.loft(secs, 'paint')


def build_exhaust(D):
    x, z, ro, ri = 0.45, 0.215, 0.040, 0.031
    y0, y1, yi = 1.90, 2.135, 2.06
    seg = 16
    def ring(r, y):
        return [D.v((x + r * math.cos(2 * math.pi * i / seg), y, z + r * math.sin(2 * math.pi * i / seg)))
                for i in range(seg)]
    a, b = ring(ro, y0), ring(ro, y1)
    c, d = ring(ri, y1), ring(ri, yi)
    for i in range(seg):
        j = (i + 1) % seg
        D.f([a[i], a[j], b[j], b[i]], 'metal')
        D.f([b[i], b[j], c[j], c[i]], 'metal')
        D.f([c[i], c[j], d[j], d[i]], 'grille')
    D.f(list(reversed(a)), 'metal')
    D.f(d, 'grille')


WING = dict(span=0.70, chord=0.25, le_y=1.715, le_z=1.105, aoa=7.0, post_x=0.42)
WING_SEC = ([(0, 0), (0.03, 0.011), (0.10, 0.017), (0.25, 0.020), (0.45, 0.018), (0.70, 0.012),
             (0.90, 0.006), (1.0, 0.003)],
            [(1.0, -0.001), (0.90, -0.006), (0.70, -0.014), (0.45, -0.020), (0.25, -0.022), (0.10, -0.018),
             (0.03, -0.010)])


def wing_point(c, h, cs=1.0, hs=1.0):
    W = WING
    a = math.radians(W['aoa'])
    yy = c * W['chord'] * cs
    zz = h * hs
    return (W['le_y'] + yy * math.cos(a) - zz * math.sin(a), W['le_z'] + yy * math.sin(a) + zz * math.cos(a))


def build_wing(D):
    W = WING
    top, bot = WING_SEC
    loop = top + bot
    stations = [(-W['span'], 0.86, 0.55), (-W['span'] + 0.014, 0.96, 0.85), (-W['span'] + 0.04, 1.0, 1.0),
                (-W['post_x'], 1.0, 1.0), (0.0, 1.0, 1.0), (W['post_x'], 1.0, 1.0),
                (W['span'] - 0.04, 1.0, 1.0), (W['span'] - 0.014, 0.96, 0.85), (W['span'], 0.86, 0.55)]
    secs = []
    for (x, cs, hs) in stations:
        off = (1 - cs) * 0.5
        sec = []
        for (c, h) in loop:
            y, z = wing_point(off + c * cs, h, 1.0, hs)
            sec.append(Vector((x, y, z)))
        secs.append(sec)
    D.loft(secs, 'paint')
    # stanchions (swept fins) and small end plates
    for sx in (1, -1):
        prof = [(1.758, 0.955), (1.885, 0.955), (1.895, 1.000), (1.872, 1.108), (1.792, 1.104), (1.775, 1.0)]
        x0, x1 = sx * (W['post_x'] - 0.013), sx * (W['post_x'] + 0.013)
        D.loft([[Vector((x0, y, z)) for y, z in prof], [Vector((x1, y, z)) for y, z in prof]], 'paint')
        ep = [(1.690, 1.080), (1.985, 1.112), (1.995, 1.168), (1.735, 1.150)]
        e0, e1 = sx * (W['span'] - 0.002), sx * (W['span'] + 0.010)
        D.loft([[Vector((e0, y, z)) for y, z in ep], [Vector((e1, y, z)) for y, z in ep]], 'paint')
    # high-mount stop lamp on the trailing edge
    a = math.radians(W['aoa'])
    yte, zte = wing_point(0.97, 0.004)
    D.box((0, yte - 0.004, zte + 0.004), (0.34, 0.026, 0.010), 'taillamp',
          rot=Matrix.Rotation(a, 3, 'X'))


def build_mirrors(D):
    for sx in (1, -1):
        cy, cz = -0.775, 0.958
        stations = [(0.830, 0.026, 0.008, 0.026), (0.855, 0.044, 0.011, 0.040), (0.890, 0.050, 0.013, 0.046),
                    (0.930, 0.050, 0.013, 0.047), (0.962, 0.045, 0.012, 0.043), (0.982, 0.032, 0.009, 0.032),
                    (0.991, 0.014, 0.005, 0.016)]
        secs = []
        n = 12
        for (x, df, db, h) in stations:
            sec = []
            for i in range(n):
                a = 2 * math.pi * i / n
                ca, sa = math.cos(a), math.sin(a)
                yy = (-df if ca < 0 else db) * (abs(ca) ** 0.7) * (1 if ca >= 0 else 1)
                yy = -df * abs(ca) ** 0.7 if ca < 0 else db * abs(ca) ** 0.5
                zz = h * math.copysign(abs(sa) ** 0.75, sa)
                sec.append(Vector((x * sx, cy + yy, cz + zz)))
            secs.append(sec)
        def mf(si, i):
            a = 2 * math.pi * (i + 0.5) / n
            return 'glass' if (1 <= si <= 4 and math.cos(a) > 0.45) else 'paint'
        D.loft(secs, 'paint', mats_fn=mf)
        # stalk to the sail
        prof = [(-0.805, 0.905), (-0.748, 0.905), (-0.756, 0.935), (-0.797, 0.94)]
        D.loft([[Vector((sx * 0.745, y, z)) for y, z in prof], [Vector((sx * 0.85, y + 0.012, z + 0.014)) for y, z in prof]],
               'trim')


def build_wipers(D):
    pj = PlaneProj('-y')
    for (xa, xb, dy) in ((-0.60, -0.06, 0.07), (0.0, 0.50, 0.055)):
        pts = []
        for x in (xa, (xa + xb) / 2, xb):
            # drop onto the windscreen from above
            o = Vector((x, Y_COWL + dy, 2.0))
            loc, nrm, _, _ = D.surf.bvh.ray_cast(o, Vector((0, 0, -1)), 5.0)
            pts.append((loc, nrm))
        secs = []
        for (p, n) in pts:
            t = Vector((0, 1, 0))
            t = (t - n * t.dot(n)).normalized()
            secs.append([p - t * 0.008 + n * 0.002, p + t * 0.008 + n * 0.002, p + t * 0.006 + n * 0.016,
                         p - t * 0.006 + n * 0.014])
        D.loft(secs, 'trim')


# ----------------------------------------------------------------------------------------
# Wheels: 205/50R16-ish tyre on a five-spoke alloy. Built once (face towards +X), hub at origin.
# ----------------------------------------------------------------------------------------
WHEEL_SEGS = 24


def revolve(mb, profile, segs, mat, closed=True, phase=0.0):
    """Revolve a list of (r, x) points about the X axis. Returns rings of verts."""
    rings = []
    for (r, x) in profile:
        ring = []
        for i in range(segs):
            a = 2 * math.pi * (i + phase) / segs
            ring.append(mb.v((x, r * math.cos(a), r * math.sin(a))))
        rings.append(ring)
    n = len(rings)
    for k in range(n if closed else n - 1):
        ra, rb = rings[k], rings[(k + 1) % n]
        for i in range(segs):
            i2 = (i + 1) % segs
            mb.f([ra[i], ra[i2], rb[i2], rb[i]], mat)
    return rings


def build_wheel_mesh(mats, name):
    mb = MeshBuilder()
    R, W = TYRE_R, TYRE_W
    hw = W / 2
    # tyre: closed profile (inboard bead -> tread -> outboard bead -> back across the bead seat)
    tyre = [(RIM_R, -hw + 0.010), (0.262, -hw - 0.001), (R - 0.004, -hw + 0.012), (R, -hw + 0.030),
            (R, hw - 0.024), (R - 0.006, hw - 0.008), (0.288, hw + 0.002), (0.252, hw + 0.004),
            (0.218, hw - 0.002), (RIM_R, hw - 0.010)]
    revolve(mb, tyre, WHEEL_SEGS, 'tyre')
    # rim barrel + outer lip (closed annulus profile). Lip is bright, barrel interior dark.
    lip = [(RIM_R - 0.004, hw - 0.012), (RIM_R + 0.005, hw + 0.002), (RIM_R - 0.012, hw + 0.006),
           (RIM_R - 0.024, hw - 0.020)]
    lip_r = revolve(mb, lip, WHEEL_SEGS, 'rim', closed=False)
    barrel = [(RIM_R - 0.024, hw - 0.020), (RIM_R - 0.024, -hw + 0.012), (RIM_R - 0.004, -hw + 0.012)]
    bar_r = revolve(mb, barrel, WHEEL_SEGS, 'trim', closed=False)
    # stitch the open profiles into one closed shell: lip end == barrel start, barrel end -> lip start
    for i in range(WHEEL_SEGS):
        i2 = (i + 1) % WHEEL_SEGS
        a, b = bar_r[-1], lip_r[0]
        mb.f([a[i], a[i2], b[i2], b[i]], 'trim')
    # merge the duplicated ring between lip and barrel later via remove_doubles
    # spokes: five, dished (face at the rim further out than at the hub), flared at the rim
    face_x_rim, face_x_hub = hw + 0.000, hw - 0.040
    depth = 0.030
    sections = [(0.050, 0.060), (0.100, 0.046), (0.160, 0.048), (RIM_R - 0.020, 0.064)]
    for k in range(5):
        ang = 2 * math.pi * k / 5 + math.pi / 2
        c, sn = math.cos(ang), math.sin(ang)
        rings = []
        for (r, w) in sections:
            t = (r - 0.05) / (RIM_R - 0.07)
            fx = lerp(face_x_hub, face_x_rim, t ** 0.8)
            ring = []
            # cross-section: front face slightly narrower than the back (chamfered sides)
            for (dy, dx) in ((-w / 2 + 0.006, 0.0), (w / 2 - 0.006, 0.0), (w / 2, -depth), (-w / 2, -depth)):
                # radial direction (c, sn) in YZ, tangential (-sn, c)
                yy = r * c + dy * (-sn)
                zz = r * sn + dy * c
                ring.append(mb.v((fx + dx, yy, zz)))
            rings.append(ring)
        for a, b in zip(rings[:-1], rings[1:]):
            for i in range(4):
                i2 = (i + 1) % 4
                mb.f([a[i], a[i2], b[i2], b[i]], 'rim')
        mb.f(list(reversed(rings[0])), 'rim')
        mb.f(rings[-1], 'rim')
    # hub: short cylinder with a domed centre cap
    hub = [(0.0, hw - 0.020), (0.030, hw - 0.020), (0.062, hw - 0.034), (0.066, hw - 0.060),
           (0.040, hw - 0.075), (0.0, hw - 0.075)]
    hub_r = revolve(mb, hub[1:-1], 10, 'rim', closed=False)
    top = mb.v((hw - 0.016, 0, 0))
    bot = mb.v((hw - 0.075, 0, 0))
    for i in range(10):
        i2 = (i + 1) % 10
        mb.f([top, hub_r[0][i], hub_r[0][i2]], 'metal')
        mb.f([bot, hub_r[-1][i2], hub_r[-1][i]], 'rim')
    bmesh.ops.remove_doubles(mb.bm, verts=mb.bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(mb.bm, faces=mb.bm.faces)
    return mb.to_object(name, mats, link=False)


def build_wheels(mats):
    proto = build_wheel_mesh(mats, 'wheel_proto')
    wheels = []
    for name, sx, y in (('wheel_FL', 1, Y_FA), ('wheel_FR', -1, Y_FA), ('wheel_RL', 1, Y_RA), ('wheel_RR', -1, Y_RA)):
        me = proto.data.copy()
        me.name = name
        if sx < 0:
            me.transform(Matrix.Rotation(math.pi, 4, 'Z'))
        ob = bpy.data.objects.new(name, me)
        ob.location = (sx * TRACK / 2, y, TYRE_R)
        bpy.context.scene.collection.objects.link(ob)
        mark_sharp(ob, 50.0)
        wheels.append(ob)
    bpy.data.meshes.remove(proto.data)
    return wheels


def add_empty(name, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = 0.08
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    return e


# ----------------------------------------------------------------------------------------
# Cycles shape-check renders
# ----------------------------------------------------------------------------------------
def setup_cycles(res=(960, 600)):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 24
    sc.cycles.device = 'CPU'
    try:
        sc.cycles.use_denoising = True
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    world = bpy.data.worlds.new('w')
    sc.world = world
    if world.node_tree is None:
        world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.55, 0.62, 0.75, 1)
    bg.inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(3)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    sc.collection.objects.link(sun)
    gm = bpy.data.materials.new('ground_preview')
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.25, 0.26, 0.3, 1)
    gme = bpy.data.meshes.new('ground_preview')
    gme.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
    gme.materials.append(gm)
    g = bpy.data.objects.new('ground_preview', gme)
    sc.collection.objects.link(g)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam, [sun, g, cam]


def look_at(cam, pos, tgt):
    cam.location = pos
    d = Vector(tgt) - Vector(pos)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def cycles_renders(outdir):
    os.makedirs(outdir, exist_ok=True)
    cam, extras = setup_cycles()
    sc = bpy.context.scene
    tgt = (0, 0, 0.6)
    R = 7.0
    shots = []
    for i in range(8):
        a = math.radians(i * 45)   # 0 = front (nose is -Y)
        shots.append(('turn%03d' % (i * 45), (R * math.sin(a), -R * math.cos(a), 1.2), tgt, 40, False))
    shots.append(('chase', (0, 6.2, 2.3), (0, -2.5, 0.9), 75, False))
    shots.append(('side', (9.0, 0, 0.62), (0, 0, 0.62), 4.7, True))
    shots.append(('title', (-2.6, -4.6, 0.8), (0.3, -0.6, 0.6), 55, False))
    shots.append(('o_top', (0, 0, 9.0), (0, 0.0001, 0), 4.7, True))
    shots.append(('o_front', (0, -9.0, 0.62), (0, 0, 0.62), 2.6, True))
    shots.append(('o_rear', (0, 9.0, 0.62), (0, 0, 0.62), 2.6, True))
    for name, pos, t, fov, ortho in shots:
        if ortho:
            cam.data.type = 'ORTHO'
            cam.data.ortho_scale = fov
            cam.data.sensor_fit = 'HORIZONTAL'
        else:
            cam.data.type = 'PERSP'
            cam.data.angle = math.radians(fov)
            cam.data.sensor_fit = 'VERTICAL'
        look_at(cam, pos, t)
        if name == 'o_top':
            cam.rotation_euler = (0, 0, math.radians(90))
        sc.render.filepath = os.path.join(outdir, name + '.png')
        bpy.ops.render.render(write_still=True)
    for o in extras:
        bpy.data.objects.remove(o, do_unlink=True)


# ----------------------------------------------------------------------------------------
# Stats & export
# ----------------------------------------------------------------------------------------
def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def world_bbox(obs):
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in obs:
        for v in ob.data.vertices:
            w = ob.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=False, export_tangents=False,
        export_materials='EXPORT', export_cameras=False, export_extras=False,
        export_animations=False, export_skins=False, export_morph=False,
        export_vertex_color='NONE' if True else 'MATERIAL')


def build():
    reset_scene()
    mats = make_materials()
    body, shell = build_body_shell(mats)
    cut_wheel_arches(body, mats)
    cut_intake(body, mats)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    D = Details(bm, mats)
    budget = [('shell', sum(len(f.verts) - 2 for f in bm.faces))]
    for fn in (build_headlamps, build_taillamps, build_front_lamps_and_plates, build_body_lines,
               build_arch_lips, build_exhaust, build_wing, build_mirrors, build_wipers):
        before = sum(len(f.verts) - 2 for f in bm.faces)
        fn(D)
        budget.append((fn.__name__[6:], sum(len(f.verts) - 2 for f in bm.faces) - before))
    before = sum(len(f.verts) - 2 for f in bm.faces)
    build_lips(D, shell)
    budget.append(('lips', sum(len(f.verts) - 2 for f in bm.faces) - before))
    print('  body parts (tris): ' + ', '.join('%s %d' % b for b in budget))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(body.data)
    bm.free()
    remap_materials(body)
    mark_sharp(body)
    body.name = 'body'
    body.data.name = 'body'
    wheels = build_wheels(mats)
    for nm in sorted(D.lamps):
        add_empty(nm, D.lamps[nm])
    return dict(body=body, mats=mats, shell=shell, wheels=wheels, lamps=D.lamps)


def main(argv):
    args = argv[argv.index('--') + 1:] if '--' in argv else argv[1:]
    out = os.path.join(REPO, 'public/assets/cars/hero.glb')
    blend = cyc = None
    stats = False
    i = 0
    while i < len(args):
        a = args[i]
        if a == '--out':
            out = os.path.abspath(args[i + 1]); i += 1
        elif a == '--blend':
            blend = os.path.abspath(args[i + 1]); i += 1
        elif a == '--cycles':
            cyc = os.path.abspath(args[i + 1]); i += 1
        elif a == '--stats':
            stats = True
        elif a == '--dump-lines':
            import json
            data = []
            for Y in STATIONS:
                half, nm = half_section(Y)
                data.append(dict(Y=Y, pts=[tuple(p) for p in half], names=nm))
            with open(args[i + 1], 'w') as fh:
                json.dump(data, fh)
            i += 1
        i += 1
    res = build()
    obs = [o for o in bpy.data.objects if o.type == 'MESH']
    if stats or True:
        tot = 0
        for o in obs:
            t = tri_count(o)
            tot += t
            print('  %-10s %6d tris' % (o.name, t))
        lo, hi = world_bbox(obs)
        print('  total %d tris; bbox x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f' % (tot, lo.x, hi.x, lo.y, hi.y, lo.z, hi.z))
        print('  size L %.3f W %.3f H %.3f' % (hi.y - lo.y, hi.x - lo.x, hi.z - lo.z))
    export_glb(out)
    print('wrote', out)
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=blend)
    if cyc:
        cycles_renders(cyc)


if __name__ == '__main__':
    main(sys.argv)
