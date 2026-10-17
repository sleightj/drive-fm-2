"""
people_lib.py -- helpers for people.py (DRIVE FM pedestrians).

Contents
  * small math helpers
  * PNG writer + a numpy SDF painter for the shared detail atlas
  * MeshBuilder: closed low-poly shells (lofts of profile rings), per-vertex bone
    weights, per-face material slot, per-corner atlas UVs ("decals")
  * Skeleton: joint layout from body-build numbers, bone list (names per
    docs/ASSET-CONVENTIONS.md + extra gear bones)
  * Pose solver: rigid per-bone transforms G in armature space -> pose-bone basis,
    2-bone analytic IK, procedural gaits (walk / walk_fast / skate / idle)
  * Blender assembly + glTF export + a GLB inspector used for verification

Everything is deterministic: no unseeded randomness, no time or environment input.
Coordinates: Blender, metres, Z up, the character faces -Y, its left is +X.
"""

import math
import json
import struct
import zlib

import numpy as np
import bpy  # noqa: F401  (makes mathutils importable)
from mathutils import Vector, Matrix, Quaternion

# --------------------------------------------------------------------------------------
# math
# --------------------------------------------------------------------------------------

TAU = math.tau


def V(x, y=None, z=None):
    if y is None:
        return Vector(x)
    return Vector((x, y, z))


def clamp(x, a, b):
    return a if x < a else b if x > b else x


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = clamp(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smoothstep(e0, e1, x):
    return smooth((x - e0) / (e1 - e0))


def qx(a):
    return Quaternion((1, 0, 0), a)


def qy(a):
    return Quaternion((0, 1, 0), a)


def qz(a):
    return Quaternion((0, 0, 1), a)


def qaxis(axis, a):
    return Quaternion(Vector(axis).normalized(), a)


def ypr(yaw=0.0, pitch=0.0, roll=0.0):
    """Rotation in rest axes: roll about Y (forward axis), then pitch about X
    (+ = lean forward for an upward bone), then yaw about Z."""
    return qz(yaw) @ qx(pitch) @ qy(roll)


def T(v):
    return Matrix.Translation(Vector(v))


def M4(q):
    return q.to_matrix().to_4x4()


def frame_rot(d0, s0, d1, s1):
    """Rotation taking orthonormal frame (d0, s0) to (d1, s1); s are orthogonalised."""
    d0 = d0.normalized()
    s0 = (s0 - d0 * s0.dot(d0)).normalized()
    d1 = d1.normalized()
    s1 = (s1 - d1 * s1.dot(d1)).normalized()
    F0 = Matrix((d0, s0, d0.cross(s0))).transposed()
    F1 = Matrix((d1, s1, d1.cross(s1))).transposed()
    return (F1 @ F0.transposed()).to_quaternion()


def hermite(p0, m0, p1, m1, s):
    s2, s3 = s * s, s * s * s
    return p0 * (2 * s3 - 3 * s2 + 1) + m0 * (s3 - 2 * s2 + s) + p1 * (-2 * s3 + 3 * s2) + m1 * (s3 - s2)


# --------------------------------------------------------------------------------------
# PNG + SDF painter (atlas)
# --------------------------------------------------------------------------------------

def write_png(path, rgba_u8):
    """rgba_u8: HxWx4 uint8, row 0 = top. Straight alpha."""
    h, w, _ = rgba_u8.shape
    raw = b''.join(b'\x00' + rgba_u8[y].tobytes() for y in range(h))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    data = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(data)


def srgb(hexcol):
    """'#rrggbb' -> (r, g, b) floats in sRGB 0..1 (atlas stores sRGB)."""
    h = hexcol.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def lin(hexcol):
    """'#rrggbb' -> linear RGBA for Blender material factors."""
    out = []
    for c in srgb(hexcol):
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


class Canvas:
    """Premultiplied RGBA float canvas; shapes are painted from signed distance fields."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.rgb = np.zeros((h, w, 3), np.float64)
        self.a = np.zeros((h, w), np.float64)

    def cell(self, x0, y0, x1, y1, ox, oy, ppu, yup=True):
        """Local coordinate grid for a pixel rect. (ox, oy) = pixel position of the local
        origin, ppu = pixels per local unit. Returns a Cell."""
        return Cell(self, x0, y0, x1, y1, ox, oy, ppu, yup)

    def to_u8(self):
        a = np.clip(self.a, 0, 1)
        rgb = np.where(a[..., None] > 1e-6, self.rgb / np.maximum(a[..., None], 1e-6), 0.0)
        out = np.zeros((self.h, self.w, 4), np.uint8)
        out[..., :3] = np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8)
        out[..., 3] = np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
        # fully transparent texels keep black RGB (bilinear bleed is ink-coloured)
        out[out[..., 3] == 0, :3] = 0
        return out


class Cell:
    def __init__(self, cv, x0, y0, x1, y1, ox, oy, ppu, yup):
        self.cv, self.x0, self.y0, self.x1, self.y1 = cv, x0, y0, x1, y1
        self.ppu = ppu
        px = np.arange(x0, x1) + 0.5
        py = np.arange(y0, y1) + 0.5
        PX, PY = np.meshgrid(px, py)
        self.X = (PX - ox) / ppu
        self.Y = ((oy - PY) if yup else (PY - oy)) / ppu

    def paint(self, sdf, col, opacity=1.0, mirror=False):
        """sdf in local units (negative inside). col: '#hex'."""
        cov = np.clip(0.5 - sdf * self.ppu, 0.0, 1.0) * opacity
        c = np.array(srgb(col))
        sl = (slice(self.y0, self.y1), slice(self.x0, self.x1))
        rgb = self.cv.rgb[sl]
        a = self.cv.a[sl]
        self.cv.rgb[sl] = rgb * (1 - cov[..., None]) + c * cov[..., None]
        self.cv.a[sl] = a * (1 - cov) + cov

    def ink(self, sdf, col, width, ink='#120e1c'):
        """Fill with a bold outline (outline drawn first, `width` local units)."""
        if width > 0:
            self.paint(sdf - width, ink)
        self.paint(sdf, col)


# --- SDF primitives over numpy grids (X, Y in local units) ----------------------------

def sd_circle(X, Y, cx, cy, r):
    return np.hypot(X - cx, Y - cy) - r


def sd_ellipse(X, Y, cx, cy, rx, ry):
    k = np.hypot((X - cx) / rx, (Y - cy) / ry)
    return (k - 1.0) * min(rx, ry)


def sd_box(X, Y, cx, cy, hx, hy, r=0.0, rot=0.0):
    x, y = X - cx, Y - cy
    if rot:
        c, s = math.cos(rot), math.sin(rot)
        x, y = c * x + s * y, -s * x + c * y
    qx_ = np.abs(x) - (hx - r)
    qy_ = np.abs(y) - (hy - r)
    out = np.hypot(np.maximum(qx_, 0), np.maximum(qy_, 0)) + np.minimum(np.maximum(qx_, qy_), 0)
    return out - r


def sd_seg(X, Y, ax, ay, bx, by, r):
    pax, pay = X - ax, Y - ay
    bax, bay = bx - ax, by - ay
    h = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay + 1e-12), 0, 1)
    return np.hypot(pax - bax * h, pay - bay * h) - r


def sd_poly(X, Y, pts):
    """Exact signed distance to a closed polygon (list of (x, y)); even-odd inside."""
    n = len(pts)
    d = np.full(X.shape, 1e9)
    inside = np.zeros(X.shape, bool)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        d = np.minimum(d, sd_seg(X, Y, ax, ay, bx, by, 0.0))
        cond = ((ay > Y) != (by > Y)) & (X < (bx - ax) * (Y - ay) / (by - ay + 1e-12) + ax)
        inside ^= cond
    return np.where(inside, -d, d)


def sd_segments(X, Y, segs):
    """Signed distance to a set of closed outlines given as segments [(ax,ay,bx,by)]."""
    d = np.full(X.shape, 1e9)
    inside = np.zeros(X.shape, bool)
    for ax, ay, bx, by in segs:
        d = np.minimum(d, sd_seg(X, Y, ax, ay, bx, by, 0.0))
        if ay != by:
            cond = ((ay > Y) != (by > Y)) & (X < (bx - ax) * (Y - ay) / (by - ay) + ax)
            inside ^= cond
    return np.where(inside, -d, d)


def sd_arc(X, Y, cx, cy, r, a0, a1, w):
    """Stroke of thickness 2w along a circular arc from angle a0 to a1 (radians, CCW)."""
    ang = np.arctan2(Y - cy, X - cx)
    mid = (a0 + a1) / 2
    half = (a1 - a0) / 2
    rel = np.angle(np.exp(1j * (ang - mid)))
    on = np.abs(rel) <= half
    d_ring = np.abs(np.hypot(X - cx, Y - cy) - r) - w
    e0 = sd_circle(X, Y, cx + r * math.cos(a0), cy + r * math.sin(a0), w)
    e1 = sd_circle(X, Y, cx + r * math.cos(a1), cy + r * math.sin(a1), w)
    return np.where(on, d_ring, np.minimum(e0, e1))


def sd_star(X, Y, cx, cy, r_out, r_in, n=5, rot=math.pi / 2):
    pts = []
    for i in range(2 * n):
        r = r_out if i % 2 == 0 else r_in
        a = rot + math.pi * i / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return sd_poly(X, Y, pts)


def u_(*ds):
    out = ds[0]
    for d in ds[1:]:
        out = np.minimum(out, d)
    return out


def sub_(a, b):
    return np.maximum(a, -b)


def inter_(a, b):
    return np.maximum(a, b)


def text_segments(text, font_path, size=1.0):
    """Outline segments of `text` set in the given font (Blender text -> mesh boundary).
    Returns (segments, (xmin, ymin, xmax, ymax)) in font units scaled by `size`."""
    import bpy
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = text
    cu.font = bpy.data.fonts.load(font_path, check_existing=True)
    cu.size = size
    cu.resolution_u = 6
    ob = bpy.data.objects.new('txt', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    count = {}
    for p in me.polygons:
        for ek in p.edge_keys:
            count[ek] = count.get(ek, 0) + 1
    segs = []
    for (a, b), c in sorted(count.items()):
        if c == 1:
            pa, pb = me.vertices[a].co, me.vertices[b].co
            segs.append((pa.x, pa.y, pb.x, pb.y))
    xs = [s[0] for s in segs] + [s[2] for s in segs]
    ys = [s[1] for s in segs] + [s[3] for s in segs]
    ob.evaluated_get(dg).to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    return segs, (min(xs), min(ys), max(xs), max(ys))


def fit_segments(segs, bbox, cx, cy, w=None, h=None):
    """Scale/translate segments so their bbox is centred at (cx, cy) with width w (or height h)."""
    x0, y0, x1, y1 = bbox
    s = (w / (x1 - x0)) if w is not None else (h / (y1 - y0))
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    return [((ax - mx) * s + cx, (ay - my) * s + cy, (bx - mx) * s + cx, (by - my) * s + cy)
            for ax, ay, bx, by in segs]


# --------------------------------------------------------------------------------------
# Mesh builder
# --------------------------------------------------------------------------------------

def prof(n, rx, fy, by=None, p=2.0, start=90.0, rx_in=None, warp=None, angles=None):
    """Superellipse ring profile with n points as [(x, y)] where x = lateral (+ = the
    character's left / the tube's 'lat' side) and y = forward. Vertex 0 sits at `start`
    degrees (90 = front centre, so even n also puts a vertex at the back centre).
    fy/by = forward/backward extent, rx/rx_in = extent on +x / -x side."""
    by = fy if by is None else by
    rx_in = rx if rx_in is None else rx_in
    pts = []
    angs = angles if angles is not None else [start + 360.0 * k / n for k in range(n)]
    for k, a in enumerate(angs):
        th = math.radians(a)
        c, s = math.cos(th), math.sin(th)
        x = math.copysign(abs(c) ** (2.0 / p), c) * (rx if c >= 0 else rx_in)
        y = math.copysign(abs(s) ** (2.0 / p), s) * (fy if s >= 0 else by)
        if warp:
            x, y = warp(k, th, x, y)
        pts.append((x, y))
    return pts


def ring(c, d, pts, w, fwd=(0, -1, 0), lat=(1, 0, 0), tilt=None):
    """A loft ring centred at c with axis d. Profile y maps to `fwd` (made perpendicular to
    d), profile x to the lateral axis (sign chosen to agree with `lat`)."""
    c = Vector(c)
    d = Vector(d).normalized()
    f = Vector(fwd)
    ey = f - d * f.dot(d)
    if ey.length < 1e-6:
        ey = Vector(lat).cross(d)
    ey.normalize()
    ex = ey.cross(d)
    if ex.dot(Vector(lat)) < 0:
        ex = -ex
    return dict(c=c, ex=ex, ey=ey, d=d, pts=pts, w=w)


def pt_ring(c, w):
    """Degenerate ring (apex) for cones/domes."""
    return dict(c=Vector(c), pts=None, w=w)


class MB:
    """Accumulates one character mesh."""

    def __init__(self):
        self.verts = []
        self.wts = []
        self.faces = []
        self.fmat = []
        self.fflat = []
        self.ftag = []
        self.fuv = {}
        self.shells = []  # (first_face, last_face_excl, name)

    # -- raw --
    def v(self, p, w):
        self.verts.append(Vector(p))
        self.wts.append(dict(w) if not callable(w) else dict(w(Vector(p))))
        return len(self.verts) - 1

    def f(self, idx, mat, flat=False, tag=None):
        self.faces.append(tuple(idx))
        self.fmat.append(mat)
        self.fflat.append(flat)
        self.ftag.append(tag)
        return len(self.faces) - 1

    def tri_count(self):
        return sum(len(f) - 2 for f in self.faces)

    # -- shells --
    def begin(self):
        return len(self.faces)

    def end(self, first, name=''):
        """Close a shell: make winding outward (positive signed volume)."""
        vol = 0.0
        for fi in range(first, len(self.faces)):
            f = self.faces[fi]
            p0 = self.verts[f[0]]
            for k in range(1, len(f) - 1):
                vol += p0.dot(self.verts[f[k]].cross(self.verts[f[k + 1]]))
        if vol < 0:
            for fi in range(first, len(self.faces)):
                self.faces[fi] = tuple(reversed(self.faces[fi]))
        self.shells.append((first, len(self.faces), name))
        return abs(vol) / 6.0

    def loft(self, rings, mat, flat=False, tag=None, matfn=None, cap0=True, cap1=True, name='', closed=False):
        """Closed tube through rings (dicts from ring()/pt_ring()). A ring with pts=None is a
        single apex vertex. matfn(i, k) -> material for the quad between ring i and i+1
        at profile edge k. Returns rows of vertex indices."""
        first = self.begin()
        rows = []
        n = None
        for r in rings:
            if r['pts'] is None:
                p = r['c']
                rows.append([self.v(p, r['w'] if not callable(r['w']) else r['w'](p))])
            else:
                row = []
                n = len(r['pts'])
                for k, (x, y) in enumerate(r['pts']):
                    p = r['c'] + r['ex'] * x + r['ey'] * y
                    w = r['w'](p) if callable(r['w']) else r['w']
                    row.append(self.v(p, w))
                rows.append(row)
        nseg = len(rows) if closed else len(rows) - 1
        for i in range(nseg):
            a, b = rows[i], rows[(i + 1) % len(rows)]
            for k in range(n):
                k1 = (k + 1) % n
                m = matfn(i, k) if matfn else mat
                if len(a) == 1:
                    self.f([a[0], b[k1], b[k]], m, flat, tag)
                elif len(b) == 1:
                    self.f([a[k], a[k1], b[0]], m, flat, tag)
                else:
                    self.f([a[k], a[k1], b[k1], b[k]], m, flat, tag)
        if not closed:
            if cap0 and len(rows[0]) > 1:
                self.f(list(reversed(rows[0])), matfn(-1, -1) if matfn else mat, flat, tag)
            if cap1 and len(rows[-1]) > 1:
                self.f(list(rows[-1]), matfn(len(rows) - 1, -1) if matfn else mat, flat, tag)
        self.end(first, name)
        return rows

    def grid_shell(self, P, W, mat, flat=False, tag=None, matfn=None, name=''):
        """Closed shell from a lat-long grid P[i][k] (i rows bottom->top, closed in k);
        the first and last rows may be single apex points."""
        rings = []
        for i, row in enumerate(P):
            if len(row) == 1:
                rings.append(dict(c=Vector(row[0]), pts=None, w=W[i][0]))
            else:
                rings.append(dict(raw=row, w=W[i]))
        first = self.begin()
        rows = []
        n = None
        for r in rings:
            if r.get('pts', 1) is None:
                rows.append([self.v(r['c'], r['w'])])
            else:
                n = len(r['raw'])
                rows.append([self.v(p, r['w'][k]) for k, p in enumerate(r['raw'])])
        for i in range(len(rows) - 1):
            a, b = rows[i], rows[i + 1]
            for k in range(n):
                k1 = (k + 1) % n
                m = matfn(i, k) if matfn else mat
                if len(a) == 1:
                    self.f([a[0], b[k1], b[k]], m, flat, tag)
                elif len(b) == 1:
                    self.f([a[k], a[k1], b[0]], m, flat, tag)
                else:
                    self.f([a[k], a[k1], b[k1], b[k]], m, flat, tag)
        if len(rows[0]) > 1:
            self.f(list(reversed(rows[0])), matfn(-1, -1) if matfn else mat, flat, tag)
        if len(rows[-1]) > 1:
            self.f(list(rows[-1]), matfn(len(rows) - 1, -1) if matfn else mat, flat, tag)
        self.end(first, name)
        return rows

    def face_normal(self, fi):
        f = self.faces[fi]
        n = Vector((0, 0, 0))
        for k in range(len(f)):
            a = self.verts[f[k]]
            b = self.verts[f[(k + 1) % len(f)]]
            n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        return n.normalized() if n.length > 1e-12 else n

    def face_center(self, fi):
        f = self.faces[fi]
        c = Vector((0, 0, 0))
        for i in f:
            c += self.verts[i]
        return c / len(f)

    # -- atlas decals --
    def decal(self, faces, rect, origin, ax_u, ax_v, ppm, center_px, mirror=False, atlas=512,
              need=None, label=''):
        """Planar projection of `faces` into the atlas pixel rect (x0, y0, x1, y1).
        Local (u, v) = ((p - origin).ax_u, (p - origin).ax_v) in metres; pixel =
        center_px + (u, -v) * ppm. mirror=True uses |u| (symmetric half-cells).
        Faces whose corners would leave the rect stay blank. `need` = (u0, v0, u1, v1) metre
        box that must be fully covered by mapped faces (warns otherwise)."""
        x0, y0, x1, y1 = rect
        origin, ax_u, ax_v = Vector(origin), Vector(ax_u).normalized(), Vector(ax_v).normalized()
        mapped, lost = 0, 0
        for fi in faces:
            uvs = []
            ok = True
            for vi in self.faces[fi]:
                q = self.verts[vi] - origin
                u, v = q.dot(ax_u), q.dot(ax_v)
                if mirror:
                    u = abs(u)
                px = center_px[0] + u * ppm
                py = center_px[1] - v * ppm
                if not (x0 + 0.75 <= px <= x1 - 0.75 and y0 + 0.75 <= py <= y1 - 0.75):
                    ok = False
                uvs.append((px / atlas, py / atlas))
            if ok:
                self.fuv[fi] = uvs
                mapped += 1
            elif need is not None:
                # does this face overlap the required box?
                us, vs = [], []
                for vi in self.faces[fi]:
                    q = self.verts[vi] - origin
                    us.append(abs(q.dot(ax_u)) if mirror else q.dot(ax_u))
                    vs.append(q.dot(ax_v))
                if not (max(us) < need[0] or min(us) > need[2] or max(vs) < need[1] or min(vs) > need[3]):
                    lost += 1
        if need is not None and lost:
            print(f'  [decal {label}] WARNING {lost} faces over the painted area fall outside the cell')
        return mapped


# --------------------------------------------------------------------------------------
# Skeleton
# --------------------------------------------------------------------------------------

REQUIRED_BONES = [
    'root', 'hips', 'spine', 'chest', 'neck', 'head',
    'shoulder.L', 'upper_arm.L', 'forearm.L', 'hand.L',
    'shoulder.R', 'upper_arm.R', 'forearm.R', 'hand.R',
    'thigh.L', 'shin.L', 'foot.L', 'toe.L',
    'thigh.R', 'shin.R', 'foot.R', 'toe.R',
]
EXTRA_BONES = ['bag', 'tie', 'hair', 'hair.L', 'hair.R']
ARM_DROP = math.radians(65.0)  # rest A-pose: arms 65 degrees below horizontal (25 from vertical)


class Build:
    """Body-build numbers (metres). Defaults = an average adult, ~1.76 m with shoes."""

    def __init__(self, **kw):
        self.ankle_h = 0.105      # ankle joint height above the ground (shoe sole incl.)
        self.shin = 0.415
        self.thigh = 0.425
        self.hip_w = 0.092        # hip joint x
        self.pelvis_up = 0.035    # hips bone head above hip joints
        self.l_hips = 0.11
        self.l_spine = 0.15
        self.l_chest = 0.17
        self.l_neck = 0.085
        self.l_head = 0.20
        self.sh_drop = 0.035      # shoulder joints below the neck base
        self.clav_in = 0.03
        self.shoulder_w = 0.185   # shoulder joint x
        self.upper_arm = 0.29
        self.forearm = 0.265
        self.hand = 0.095         # wrist -> knuckles
        self.ball_fwd = 0.135     # ankle -> ball (toe joint), forward
        self.ball_h = 0.035
        self.toe_len = 0.085
        self.heel_back = 0.07     # heel (back of the sole) behind the ankle
        self.head_scale = 1.0
        self.skates = False
        for k, v in kw.items():
            if not hasattr(self, k):
                raise KeyError(k)
            setattr(self, k, v)

    def copy(self, **kw):
        b = Build()
        b.__dict__.update(self.__dict__)
        for k, v in kw.items():
            if not hasattr(b, k):
                raise KeyError(k)
            setattr(b, k, v)
        return b


def skeleton(b):
    """Joint dictionary J and bone list [(name, head, tail, parent, roll_axis)]."""
    J = {}
    knee_z = b.ankle_h + b.shin
    hip_z = knee_z + b.thigh
    J['hip_z'] = hip_z
    hips = V(0, 0, hip_z + b.pelvis_up)
    spine = hips + V(0, 0, b.l_hips)
    chest = spine + V(0, 0, b.l_spine)
    neck = chest + V(0, 0, b.l_chest)
    head = neck + V(0, 0, b.l_neck)
    head_t = head + V(0, 0, b.l_head)
    J.update(hips=hips, spine=spine, chest=chest, neck=neck, head=head, head_top=head_t)
    sh_z = neck.z - b.sh_drop
    J['sh_z'] = sh_z
    fwd = V(0, -1, 0)
    up = V(0, 0, 1)
    bones = [
        ('root', V(0, 0, 0), V(0, 0, 0.25), None, fwd),
        ('hips', hips, spine, 'root', fwd),
        ('spine', spine, chest, 'hips', fwd),
        ('chest', chest, neck, 'spine', fwd),
        ('neck', neck, head, 'chest', fwd),
        ('head', head, head_t, 'neck', fwd),
    ]
    for s, sx in (('L', 1), ('R', -1)):
        cl = V(sx * b.clav_in, 0, sh_z)
        sh = V(sx * b.shoulder_w, 0, sh_z)
        d = V(sx * math.cos(ARM_DROP), 0, -math.sin(ARM_DROP))
        el = sh + d * b.upper_arm
        wr = el + d * b.forearm
        ht = wr + d * b.hand
        hj = V(sx * b.hip_w, 0, hip_z)
        kn = V(sx * b.hip_w, 0, knee_z)
        an = V(sx * b.hip_w, 0, b.ankle_h)
        ball = V(sx * b.hip_w, -b.ball_fwd, b.ball_h)
        toe = V(sx * b.hip_w, -b.ball_fwd - b.toe_len, b.ball_h)
        heel = V(sx * b.hip_w, b.heel_back, 0.0)
        J.update({f'clav.{s}': cl, f'sh.{s}': sh, f'elbow.{s}': el, f'wrist.{s}': wr, f'hand_tip.{s}': ht,
                  f'arm_dir.{s}': d, f'hipj.{s}': hj, f'knee.{s}': kn, f'ankle.{s}': an, f'ball.{s}': ball,
                  f'toe.{s}': toe, f'heel.{s}': heel})
    for s in ('L', 'R'):
        bones += [
            (f'shoulder.{s}', J[f'clav.{s}'], J[f'sh.{s}'], 'chest', fwd),
            (f'upper_arm.{s}', J[f'sh.{s}'], J[f'elbow.{s}'], f'shoulder.{s}', fwd),
            (f'forearm.{s}', J[f'elbow.{s}'], J[f'wrist.{s}'], f'upper_arm.{s}', fwd),
            (f'hand.{s}', J[f'wrist.{s}'], J[f'hand_tip.{s}'], f'forearm.{s}', fwd),
        ]
    for s in ('L', 'R'):
        bones += [
            (f'thigh.{s}', J[f'hipj.{s}'], J[f'knee.{s}'], 'hips', fwd),
            (f'shin.{s}', J[f'knee.{s}'], J[f'ankle.{s}'], f'thigh.{s}', fwd),
            (f'foot.{s}', J[f'ankle.{s}'], J[f'ball.{s}'], f'shin.{s}', up),
            (f'toe.{s}', J[f'ball.{s}'], J[f'toe.{s}'], f'foot.{s}', up),
        ]
    return J, bones


def extra_bones(J, spec):
    """Gear bones. spec: dict name -> (head, tail). Every variant gets all EXTRA_BONES
    (parents fixed: bag/tie -> chest, hair* -> head) so the layout is identical."""
    hd = J['head']
    defaults = {
        'bag': (J['chest'] + V(0, 0.16, 0.05), J['chest'] + V(0, 0.16, -0.10)),
        'tie': (J['neck'] + V(0, -0.1, -0.03), J['neck'] + V(0, -0.12, -0.2)),
        'hair': (hd + V(0, 0.09, 0.12), hd + V(0, 0.14, -0.02)),
        'hair.L': (hd + V(0.09, 0.02, 0.15), hd + V(0.14, 0.04, 0.0)),
        'hair.R': (hd + V(-0.09, 0.02, 0.15), hd + V(-0.14, 0.04, 0.0)),
    }
    defaults.update(spec or {})
    parents = {'bag': 'chest', 'tie': 'chest', 'hair': 'head', 'hair.L': 'head', 'hair.R': 'head'}
    out = []
    for n in EXTRA_BONES:
        h, t = defaults[n]
        out.append((n, Vector(h), Vector(t), parents[n], V(0, -1, 0) if abs((t - h).normalized().y) < 0.9 else V(0, 0, 1)))
    return out


# --------------------------------------------------------------------------------------
# Pose solver
# --------------------------------------------------------------------------------------

I4 = Matrix.Identity(4)


def fk(Gp, pivot, q):
    """Child transform: rotate by q (expressed in the parent-carried rest axes) about the
    child's rest head `pivot`."""
    return Gp @ T(pivot) @ M4(q) @ T(-pivot)


def ik2(root, target, l1, l2, pole):
    """Analytic two-bone IK. Returns (mid, end, reach_ratio, bend_dir)."""
    d = target - root
    dist = d.length
    e = d / max(dist, 1e-9)
    dc = clamp(dist, abs(l1 - l2) + 1e-4, (l1 + l2) * 0.9999)
    ca = clamp((l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc), -1.0, 1.0)
    a = math.acos(ca)
    p = pole - e * pole.dot(e)
    if p.length < 1e-8:
        p = Vector((0, -1, 0)) - e * e.y * -1
    p.normalize()
    mid = root + (e * math.cos(a) + p * math.sin(a)) * l1
    end = root + e * dc
    return mid, end, dist / (l1 + l2), p


class Rig:
    """Rest data read back from the Blender armature (so rolls match exactly)."""

    def __init__(self, arm_obj, J):
        a = arm_obj.data
        self.J = J
        self.order = [b.name for b in a.bones]
        self.rest = {b.name: b.matrix_local.copy() for b in a.bones}
        self.head = {b.name: b.head_local.copy() for b in a.bones}
        self.tail = {b.name: b.tail_local.copy() for b in a.bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in a.bones}
        for s in ('L', 'R'):
            setattr(self, 'leg' + s, ((J[f'knee.{s}'] - J[f'hipj.{s}']).length, (J[f'ankle.{s}'] - J[f'knee.{s}']).length))
            setattr(self, 'arm' + s, ((J[f'elbow.{s}'] - J[f'sh.{s}']).length, (J[f'wrist.{s}'] - J[f'elbow.{s}']).length))

    def basis(self, G):
        out = {}
        for n in self.order:
            p = self.parent[n]
            Gp = G[p] if p else I4
            R = self.rest[n]
            out[n] = R.inverted() @ Gp.inverted() @ G[n] @ R
        return out

    def solve(self, c):
        """c: per-frame control dict (see gaits). Returns (G, diag)."""
        J = self.J
        G = {'root': I4.copy()}
        hh = self.head['hips']
        G['hips'] = T(hh + c['hips_off']) @ M4(c['hips_rot']) @ T(-hh)
        G['spine'] = fk(G['hips'], self.head['spine'], c.get('spine', Quaternion()))
        G['chest'] = fk(G['spine'], self.head['chest'], c.get('chest', Quaternion()))
        G['neck'] = fk(G['chest'], self.head['neck'], c.get('neck', Quaternion()))
        G['head'] = fk(G['neck'], self.head['head'], c.get('head', Quaternion()))
        diag = {}
        # legs
        for s in ('L', 'R'):
            ft = c['foot.' + s]
            hj0 = self.head['thigh.' + s]
            kn0 = self.head['shin.' + s]
            an0 = self.head['foot.' + s]
            hj = G['hips'] @ hj0
            l1, l2 = getattr(self, 'leg' + s)
            kn, end, ratio, p = ik2(hj, ft['ankle'], l1, l2, ft['pole'])
            diag['reach.' + s] = ratio
            diag['miss.' + s] = (end - ft['ankle']).length
            fwd = Vector((0, -1, 0))
            Rth = frame_rot(kn0 - hj0, fwd, kn - hj, p)
            Rsh = frame_rot(an0 - kn0, fwd, end - kn, p)
            G['thigh.' + s] = T(hj) @ M4(Rth) @ T(-hj0)
            G['shin.' + s] = T(kn) @ M4(Rsh) @ T(-kn0)
            G['foot.' + s] = T(end) @ M4(ft['rot']) @ T(-an0)
            G['toe.' + s] = fk(G['foot.' + s], self.head['toe.' + s], qx(-ft.get('toe', 0.0)))
        # arms
        for s in ('L', 'R'):
            ac = c['arm.' + s]
            G['shoulder.' + s] = fk(G['chest'], self.head['shoulder.' + s], ac.get('sh', Quaternion()))
            sh0 = self.head['upper_arm.' + s]
            el0 = self.head['forearm.' + s]
            wr0 = self.head['hand.' + s]
            if ac['mode'] == 'fk':
                G['upper_arm.' + s] = fk(G['shoulder.' + s], sh0, ac['ua'])
                G['forearm.' + s] = fk(G['upper_arm.' + s], el0, ac['fa'])
                G['hand.' + s] = fk(G['forearm.' + s], wr0, ac.get('hand', Quaternion()))
            else:
                root = G['shoulder.' + s] @ sh0
                l1, l2 = getattr(self, 'arm' + s)
                tgt = ac['target'](G) if callable(ac['target']) else ac['target']
                pole = ac['pole'](G) if callable(ac['pole']) else ac['pole']
                el, end, ratio, p = ik2(root, tgt, l1, l2, pole)
                diag['armreach.' + s] = ratio
                back = Vector((0, 1, 0))
                d0 = J['arm_dir.' + s]
                Rua = frame_rot(d0, back, el - root, p)
                Rfa = frame_rot(d0, back, end - el, p)
                if ac.get('twist'):
                    Rfa = qaxis(end - el, ac['twist']) @ Rfa
                G['upper_arm.' + s] = T(root) @ M4(Rua) @ T(-sh0)
                G['forearm.' + s] = T(el) @ M4(Rfa) @ T(-el0)
                if 'hand_abs' in ac:
                    ha = ac['hand_abs'](G) if callable(ac['hand_abs']) else ac['hand_abs']
                    G['hand.' + s] = T(end) @ M4(ha) @ T(-wr0)
                else:
                    G['hand.' + s] = fk(G['forearm.' + s], wr0, ac.get('hand', Quaternion()))
        # extras
        for n, par in (('bag', 'chest'), ('tie', 'chest'), ('hair', 'head'), ('hair.L', 'head'), ('hair.R', 'head')):
            e = c.get(n)
            if e is None:
                G[n] = fk(G[par], self.head[n], Quaternion())
            elif isinstance(e, Quaternion):
                G[n] = fk(G[par], self.head[n], e)
            else:  # callable(G) -> absolute transform
                G[n] = e(G)
        return G, diag


# --------------------------------------------------------------------------------------
# Gaits
# --------------------------------------------------------------------------------------

def lowpass(x, k):
    X = np.fft.rfft(np.asarray(x, float))
    X[k + 1:] = 0
    return np.fft.irfft(X, len(x))


WALK = dict(
    # feet
    step_w=0.085, toe_out=0.10, duty=0.62, a1=0.10, a2=0.36, pitch_hs=0.32, pitch_to=0.62,
    lift=0.03, y_shift=0.03, swing_in=0.0,
    # hips / torso
    hip_drop=0.03, bounce=0.016, sway=0.022, hip_yaw=0.12, hip_roll=0.06, hip_pitch=0.04,
    hip_fwd=0.0, reach=0.975, lean=0.04, chest_yaw=0.32, chest_roll=0.04, chest_pitch=0.0,
    neck_pitch=0.0, head_pitch=0.0, head_roll=0.0, head_bob=0.03, head_yaw=0.0,
    # arms
    arm_swing=0.42, arm_bias=0.06, arm_out=0.16, elbow=0.32, elbow_swing=0.45, sh_fwd=0.12,
    shrug=0.0, sh_bob=0.04, hand_flex=0.15, arm_lag=0.04,
    arm_L='swing', arm_R='swing', swing_L=1.0, swing_R=1.0,
    # extras
    bag='none', tie=0.0, hair_swing=0.0,
    flat=False,
)


class Clip:
    def __init__(self, name, frames, fps, speed, controls):
        self.name, self.frames, self.fps, self.speed, self.controls = name, frames, fps, speed, controls


def _foot_points(J, s):
    return J['ankle.' + s], J['ball.' + s], J['heel.' + s]


def walk_foot_fn(J, st, s, S):
    """Returns f(u) -> (ankle, rot, toe_bend, contact) for one foot over its own phase u."""
    sx = 1 if s == 'L' else -1
    A0, B0, H0 = _foot_points(J, s)
    T0 = J['toe.' + s]
    d, a1, a2 = st['duty'], st['a1'], st['a2']
    Rz = qz(sx * st['toe_out'])
    dx = sx * (st['step_w'] - abs(J['hipj.L'].x))
    span = S * d
    flat = st['flat']
    P0 = Vector((H0.x, (H0.y + J['toe.' + s].y) / 2, 0.0))  # skate centre (flat feet)
    # heel strike so mid-stance ankle sits under the hip (+ y_shift backwards)
    y_hs = -span / 2 + (H0.y - A0.y) + st['y_shift']
    p_hs, p_to = st['pitch_hs'], st['pitch_to']

    sole = J.get('sole.' + s) or [(False, Vector((H0.x, H0.y, 0.0))), (False, Vector((B0.x, B0.y, 0.0))),
                                  (True, Vector((T0.x, T0.y, 0.0)))]

    def sole_min(A, R, toe):
        Bw = A + R @ (B0 - A0)
        Rt = R @ qx(-toe)
        return min((Bw + Rt @ (p - B0)).z if is_toe else (A + R @ (p - A0)).z for is_toe, p in sole)

    def stance(u):
        A, R, q = stance0(u)
        if not flat:
            m = sole_min(A, R, q)
            if m < 0.0:          # a big boot heel/toe would sink while rolling: ride up on it
                A = A + Vector((0, 0, -m))
        return A, R, q

    def stance0(u):
        if flat:
            Pt = Vector((P0.x + dx, y_hs + (P0.y - H0.y) + S * u, 0.0))
            return Pt + Rz @ (A0 - P0), Rz.copy(), 0.0
        Ht = Vector((H0.x + dx, y_hs + S * u, H0.z))
        if u < a1:
            p = p_hs * (1 - smooth(u / a1))
            R = Rz @ qx(-p)
            return Ht + R @ (A0 - H0), R, 0.0
        if u < a2:
            return Ht + Rz @ (A0 - H0), Rz.copy(), 0.0
        Bt = Vector((H0.x + dx, y_hs + S * a2, H0.z)) + Rz @ (B0 - H0) + Vector((0, S * (u - a2), 0))
        q = p_to * ((u - a2) / (d - a2)) ** 2
        R = Rz @ qx(q)
        return Bt + R @ (A0 - B0), R, q

    eps = 1e-4
    A_to = stance(d)[0]
    v_to = (stance(d)[0] - stance(d - eps)[0]) / eps
    A_hs = stance(0.0)[0]
    v_hs = (stance(eps)[0] - stance(0.0)[0]) / eps
    qrate = 0.0 if flat else 2 * p_to / (d - a2)

    def f(u):
        u = u % 1.0
        if u < d:
            A, R, q = stance(u)
            return A, R, q, True
        s_ = (u - d) / (1 - d)
        A = hermite(A_to, v_to * (1 - d), A_hs, v_hs * (1 - d), s_)
        A.z += st['lift'] * math.sin(math.pi * s_) * (1.0 - 0.25 * s_)
        A.x -= sx * st['swing_in'] * math.sin(math.pi * s_)
        if flat:
            pu = 0.08 * math.sin(math.pi * s_) * (s_ - 0.3)
            R = Rz @ qx(-pu)
            return A, R, 0.0, False
        pu = hermite(-p_to, -qrate * (1 - d), p_hs, 0.0, s_)
        R = Rz @ qx(-pu)
        toe = p_to * (1 - smoothstep(0.0, 0.45, s_))
        # toe clearance: lift the ankle if any sole point would dip below the ground
        # (the pitched foot un-bending its toe early in swing)
        want = 0.012 * smoothstep(0.0, 0.12, s_) * (1.0 - smoothstep(0.75, 1.0, s_))
        deficit = want - sole_min(A, R, toe)
        if deficit > 0:
            A = A + Vector((0, 0, deficit))
        return A, R, toe, False
    return f


def arm_fk(J, s, swing, elbow, st, out=None, shq=None, hand=None, twist=0.0):
    """FK arm controls. swing > 0 = forward. out = angle of the arm from vertical."""
    sx = 1 if s == 'L' else -1
    out = st['arm_out'] if out is None else out
    rest_from_vertical = math.pi / 2 - ARM_DROP
    add = sx * (rest_from_vertical - out)
    d = J['arm_dir.' + s]
    bend_axis = d.cross(Vector((0, -1, 0))).normalized()
    ua = qx(-swing) @ qy(add)
    if twist:
        ua = ua @ qaxis(d, sx * twist)
    fa = qaxis(bend_axis, elbow)
    hq = hand if hand is not None else qaxis(bend_axis, st['hand_flex'])
    return dict(mode='fk', sh=shq or Quaternion(), ua=ua, fa=fa, hand=hq)


def clav(s, fwd=0.0, up=0.0):
    sx = 1 if s == 'L' else -1
    return qz(-sx * fwd) @ qy(-sx * up)


def solve_hips_heights(rig, J, ctls, feet_key, reach, margin, harmonics):
    """Lower the nominal hip height where a leg could not reach its ankle target, then
    smooth (periodic low-pass) and re-clamp. Modifies ctl['hips_off'].z in place."""
    hh = rig.head['hips']
    allowed = []
    for c in ctls:
        lim = 1e9
        for s in ('L', 'R'):
            hj0 = rig.head['thigh.' + s]
            hj = hh + Vector((c['hips_off'].x, c['hips_off'].y, 0)) + c['hips_rot'] @ (hj0 - hh)
            l1, l2 = getattr(rig, 'leg' + s)
            R = reach * (l1 + l2)
            w = c['foot.' + s]['ankle'] - hj
            hor = w.x * w.x + w.y * w.y
            lim = min(lim, w.z + math.sqrt(max(R * R - hor, 0.0)))
        allowed.append(lim)
    nominal = [c['hips_off'].z for c in ctls]
    want = [min(n, a - margin) for n, a in zip(nominal, allowed)]
    sm = lowpass(want, harmonics) if harmonics else np.array(want)
    for c, z, a in zip(ctls, sm, allowed):
        c['hips_off'].z = float(min(z, a))
    return allowed


def gen_walk(rig, J, st, name, T_cycle, S, fps):
    nfr = int(round(T_cycle * fps))
    feet = {s: walk_foot_fn(J, st, s, S) for s in ('L', 'R')}
    ctls = []
    for f in range(nfr):
        ph = f / nfr
        c = {}
        for s, ph0 in (('L', 0.0), ('R', 0.5)):
            sx = 1 if s == 'L' else -1
            A, R, toe, contact = feet[s](ph - ph0)
            pole = qz(sx * st['toe_out'] * 0.6) @ Vector((sx * 0.12, -1, 0))
            c['foot.' + s] = dict(ankle=A, rot=R, toe=toe, pole=pole.normalized(), contact=contact)
        cph = math.cos(TAU * ph)
        sph = math.sin(TAU * (ph - 0.05))
        yaw_h = -st['hip_yaw'] * cph
        roll_h = -st['hip_roll'] * sph
        pitch_h = st['hip_pitch']
        c['hips_rot'] = ypr(yaw_h, pitch_h, roll_h)
        dz = -st['hip_drop'] + st['bounce'] * math.cos(2 * TAU * (ph - 0.3))
        c['hips_off'] = Vector((st['sway'] * sph, -st['hip_fwd'], dz))
        # torso: counter-rotate shoulders against the pelvis
        cy = st['chest_yaw'] * cph
        c['spine'] = ypr(cy * 0.45, st['lean'] * 0.5, -roll_h * 0.7)
        breathe = 0.0
        c['chest'] = ypr(cy * 0.55, st['lean'] * 0.5 + st['chest_pitch'] + breathe,
                         -roll_h * 0.3 + st['chest_roll'] * math.sin(TAU * (ph - 0.1)))
        tot_yaw = yaw_h + cy
        tot_pitch = pitch_h + st['lean'] + st['chest_pitch']
        bob = st['head_bob'] * math.cos(2 * TAU * (ph - 0.35))
        c['neck'] = ypr(-tot_yaw * 0.5, st['neck_pitch'] - tot_pitch * 0.4, -st['chest_roll'] * 0.5 * math.sin(TAU * (ph - 0.1)))
        c['head'] = ypr(-tot_yaw * 0.45 + st['head_yaw'], st['head_pitch'] - tot_pitch * 0.45 + bob,
                        st['head_roll'] + 0.04 * math.sin(TAU * (ph - 0.15)) * st['hip_roll'] / 0.06)
        # arms
        base = st['arm_swing'] * math.cos(TAU * (ph - st['arm_lag']))
        for s in ('L', 'R'):
            mode = st['arm_' + s]
            sw = (-base if s == 'L' else base) * st['swing_' + s] + st['arm_bias']
            shq = clav(s, st['sh_fwd'] * sw, st['shrug'] + st['sh_bob'] * math.cos(2 * TAU * (ph - 0.3)))
            if callable(mode):
                c['arm.' + s] = mode(rig, J, st, s, ph, sw, shq)
            else:
                el = st['elbow'] + st['elbow_swing'] * max(0.0, sw) / max(st['arm_swing'], 1e-3)
                c['arm.' + s] = arm_fk(J, s, sw, el, st, shq=shq)
        if callable(st['bag']):
            st['bag'](rig, J, st, c, ph, 'walk')
        if st['tie']:
            c['tie'] = qx(-st['tie'] * (0.6 + 0.4 * math.cos(2 * TAU * (ph - 0.1)))) @ qy(0.15 * math.sin(TAU * ph))
        if st['hair_swing']:
            hs = st['hair_swing']
            c['hair'] = qx(-hs * 0.5 * (1 + math.cos(2 * TAU * (ph - 0.15)))) @ qy(hs * 0.6 * math.sin(TAU * (ph - 0.1)))
            c['hair.L'] = qy(hs * 0.7 * math.sin(TAU * (ph - 0.12))) @ qx(-hs * 0.5 * math.cos(2 * TAU * (ph - 0.15)))
            c['hair.R'] = qy(hs * 0.7 * math.sin(TAU * (ph - 0.12))) @ qx(-hs * 0.5 * math.cos(2 * TAU * (ph - 0.15)))
        ctls.append(c)
    solve_hips_heights(rig, J, ctls, 'foot', st['reach'], 0.004, 4)
    return Clip(name, nfr, fps, S / T_cycle, ctls)


SKATE = dict(
    crouch=0.13, lean=0.42, push_w=0.34, push_back=0.24, set_fwd=0.18, glide_w=0.075, lift=0.11,
    push_yaw=0.55, glide_yaw=0.05, edge=0.2, sway=0.075, hip_yaw=0.16, chest_yaw=0.28,
    arm_swing=0.75, arm_side=0.35, elbow=0.55, reach=0.985, head_up=0.0,
)


def gen_skate(rig, J, st, sk, name, T_cycle, speed, fps):
    """Push-glide: each foot pushes out/back on its inside edge, lifts, recovers under the
    body, then glides. Wheels stay on the ground while pushing and gliding."""
    nfr = int(round(T_cycle * fps))
    ctls = []
    hipw = abs(J['hipj.L'].x)

    def foot(s, u):
        sx = 1 if s == 'L' else -1
        A0, B0, H0 = _foot_points(J, s)
        P0 = Vector((H0.x, (H0.y + J['toe.' + s].y) / 2, 0.0))
        u = u % 1.0
        # x: lateral offset from the centre line (outward positive), y: + backwards
        gx0, gy0 = sk['glide_w'], -sk['set_fwd']
        gx1, gy1 = sk['glide_w'] - 0.01, 0.02
        if u < 0.36:      # push
            t = u / 0.36
            e = t * t * (3 - 2 * t) * 0.6 + t * 0.4
            x = lerp(gx1, sk['push_w'], e)
            y = lerp(gy1, sk['push_back'], e)
            yaw = lerp(sk['glide_yaw'], sk['push_yaw'], smooth(t * 1.6))
            roll = -sk['edge'] * math.sin(math.pi * min(1.0, t * 1.1)) * 0.9 - sk['edge'] * 0.1
            z = 0.0
            pitch = 0.0
            contact = True
        elif u < 0.56:    # recovery (air)
            t = (u - 0.36) / 0.20
            x = lerp(sk['push_w'], gx0, smooth(t))
            y = lerp(sk['push_back'], gy0, smooth(t))
            yaw = lerp(sk['push_yaw'], sk['glide_yaw'], smooth(t))
            roll = lerp(-sk['edge'] * 0.1, 0.0, t)
            z = sk['lift'] * math.sin(math.pi * t) * (1.2 - 0.4 * t)
            pitch = 0.18 * math.sin(math.pi * t) * (0.6 - t)
            contact = False
        else:             # glide
            t = (u - 0.56) / 0.44
            x = lerp(gx0, gx1, t)
            y = lerp(gy0, gy1, t)
            yaw = sk['glide_yaw']
            roll = 0.04 * math.sin(math.pi * t)
            z = 0.0
            pitch = 0.0
            contact = True
        R = qz(sx * yaw) @ qy(sx * roll) @ qx(-pitch)
        Pt = Vector((sx * x, y + P0.y, z))
        A = Pt + R @ (A0 - P0)
        return A, R, contact

    for f in range(nfr):
        ph = f / nfr
        c = {}
        for s, ph0 in (('L', 0.0), ('R', 0.5)):
            sx = 1 if s == 'L' else -1
            A, R, contact = foot(s, ph - ph0)
            pole = (R @ Vector((0, -1, 0)) + Vector((sx * 0.25, 0, 0))).normalized()
            c['foot.' + s] = dict(ankle=A, rot=R, toe=0.0, pole=pole, contact=contact)
        # weight over the gliding foot: L glides around ph 0.78, R around 0.28
        sway = sk['sway'] * math.cos(TAU * (ph - 0.78))
        yaw_h = sk['hip_yaw'] * math.sin(TAU * (ph - 0.78))
        roll_h = -0.08 * math.cos(TAU * (ph - 0.78))
        c['hips_rot'] = ypr(yaw_h, sk['lean'] * 0.55, roll_h)
        dz = -sk['crouch'] + 0.02 * math.cos(2 * TAU * (ph - 0.1))
        c['hips_off'] = Vector((sway, 0.02, dz))
        cy = -sk['chest_yaw'] * math.sin(TAU * (ph - 0.8))
        c['spine'] = ypr(cy * 0.5, sk['lean'] * 0.25, -roll_h * 0.6)
        c['chest'] = ypr(cy * 0.5, sk['lean'] * 0.2 + st['chest_pitch'], -roll_h * 0.3)
        tot_pitch = sk['lean'] * 1.0 + st['chest_pitch']
        c['neck'] = ypr(-(yaw_h + cy) * 0.5, -tot_pitch * 0.45 + st['neck_pitch'], 0)
        c['head'] = ypr(-(yaw_h + cy) * 0.5 + st['head_yaw'], -tot_pitch * 0.5 + sk['head_up'] + st['head_pitch'], st['head_roll'])
        # arms: the push side arm swings back/out, the other forward/across
        a = math.sin(TAU * (ph - 0.2))
        for s in ('L', 'R'):
            sx = 1 if s == 'L' else -1
            mode = st['arm_' + s]
            sw = (-a if s == 'L' else a) * sk['arm_swing'] + 0.1
            out = st['arm_out'] + sk['arm_side'] * max(0.0, -sw) * 0.8 + 0.1
            shq = clav(s, 0.15 * sw, 0.05)
            if callable(mode):
                c['arm.' + s] = mode(rig, J, st, s, ph, sw * 0.4, shq)
            else:
                el = sk['elbow'] + 0.35 * max(0.0, sw)
                c['arm.' + s] = arm_fk(J, s, sw, el, st, out=out, shq=shq)
        if callable(st['bag']):
            st['bag'](rig, J, st, c, ph, 'skate')
        if st['tie']:
            c['tie'] = qx(-st['tie'] * 1.6) @ qy(0.2 * math.sin(TAU * ph))
        if st['hair_swing']:
            hs = st['hair_swing']
            c['hair'] = qx(-hs * 1.5 - hs * 0.3 * math.cos(2 * TAU * ph)) @ qy(hs * 0.8 * math.sin(TAU * (ph - 0.9)))
            c['hair.L'] = qx(-hs * 1.3) @ qy(hs * 0.8 * math.sin(TAU * (ph - 0.9)))
            c['hair.R'] = qx(-hs * 1.3) @ qy(hs * 0.8 * math.sin(TAU * (ph - 0.9)))
        ctls.append(c)
    solve_hips_heights(rig, J, ctls, 'foot', sk['reach'], 0.006, 4)
    return Clip(name, nfr, fps, speed, ctls)


def gen_idle(rig, J, st, name, T_cycle, fps, idle):
    """Weight shift, breathing, looking around; optional phone check (idle['phone'])."""
    nfr = int(round(T_cycle * fps))
    ctls = []
    hipw = abs(J['hipj.L'].x)
    feet = {}
    for s in ('L', 'R'):
        sx = 1 if s == 'L' else -1
        A0, B0, H0 = _foot_points(J, s)
        R = qz(sx * idle['toe_out'])
        dy = idle['stagger'] if s == 'R' else -idle['stagger'] * 0.3
        Ht = Vector((H0.x + sx * (idle['stance_w'] - hipw), H0.y + dy, H0.z))
        feet[s] = (Ht + R @ (A0 - H0), R)
    for f in range(nfr):
        ph = f / nfr
        c = {}
        for s in ('L', 'R'):
            sx = 1 if s == 'L' else -1
            A, R = feet[s]
            c['foot.' + s] = dict(ankle=A.copy(), rot=R.copy(), toe=0.0, pole=(R @ Vector((sx * 0.15, -1, 0))).normalized(), contact=True)
        w = math.sin(TAU * ph) * 0.8 + 0.2 * math.sin(2 * TAU * ph)
        sway = idle['shift'] * w
        roll_h = -idle['roll'] * w
        yaw_h = 0.05 * math.sin(TAU * (ph - 0.1))
        c['hips_rot'] = ypr(yaw_h, st['hip_pitch'] * 0.5, roll_h)
        c['hips_off'] = Vector((sway, 0.0, -idle['drop'] - 0.012 * abs(w)))
        br = math.sin(2 * TAU * ph)
        look = idle['look']
        hy = look * (smoothstep(0.12, 0.22, ph) - smoothstep(0.34, 0.44, ph)) \
            - look * 0.8 * (smoothstep(0.58, 0.68, ph) - smoothstep(0.8, 0.9, ph))
        c['spine'] = ypr(-yaw_h * 0.5 + hy * 0.1, st['lean'] * 0.4, -roll_h * 0.5)
        c['chest'] = ypr(hy * 0.15, st['lean'] * 0.4 + st['chest_pitch'] - 0.025 * br, -roll_h * 0.4)
        hp = st['head_pitch'] - (st['lean'] * 0.8 + st['chest_pitch']) * 0.5
        if idle.get('phone'):
            down = 0.42 * (1 - smoothstep(0.42, 0.5, ph) + smoothstep(0.62, 0.7, ph))
            hp += down
            hy *= 0.3
        c['neck'] = ypr(hy * 0.4, st['neck_pitch'] * 0.6 + hp * 0.35, roll_h * 0.3)
        c['head'] = ypr(hy * 0.6 + st['head_yaw'], hp * 0.65 + 0.015 * br, st['head_roll'] + 0.06 * w)
        for s in ('L', 'R'):
            sx = 1 if s == 'L' else -1
            mode = st['arm_' + s]
            shq = clav(s, 0.02 * br, st['shrug'] + 0.025 * br)
            if idle.get('phone') and s == 'R':
                c['arm.' + s] = idle['phone'](rig, J, st, s, ph, 0.0, shq)
            elif callable(mode):
                c['arm.' + s] = mode(rig, J, st, s, ph, 0.03 * w * sx, shq)
            else:
                sw = 0.05 + 0.04 * w * sx + 0.02 * br
                c['arm.' + s] = arm_fk(J, s, sw, st['elbow'] * 0.6 + 0.05 * br, st, shq=shq)
        if callable(st['bag']):
            st['bag'](rig, J, st, c, ph, 'idle')
        if st['tie']:
            c['tie'] = qx(-0.03 * br)
        if st['hair_swing']:
            c['hair.L'] = qy(0.04 * w)
            c['hair.R'] = qy(0.04 * w)
            c['hair'] = qy(0.04 * w)
        ctls.append(c)
    solve_hips_heights(rig, J, ctls, 'foot', 0.995, 0.002, 6)
    return Clip(name, nfr, fps, 0.0, ctls)


# --------------------------------------------------------------------------------------
# Blender assembly
# --------------------------------------------------------------------------------------

SLOTS = ['skin', 'hair', 'top', 'top2', 'bottom', 'shoes', 'accent', 'gear', 'detail']


def reset_scene(fps):
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = fps
    sc.render.fps_base = 1.0
    return sc


def make_armature(name, bones):
    import bpy
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    ebs = {}
    for n, h, t, par, roll in bones:
        eb = arm.edit_bones.new(n)
        eb.head = h
        eb.tail = t
        eb.use_deform = True
        if par:
            eb.parent = ebs[par]
            eb.use_connect = False
        eb.align_roll(roll)
        ebs[n] = eb
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def make_materials(colors):
    import bpy
    mats = {}
    for n in SLOTS:
        m = bpy.data.materials.new(n)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        col = lin(colors.get(n, '#ff00ff'))
        if bsdf:
            bsdf.inputs['Base Color'].default_value = col
            bsdf.inputs['Roughness'].default_value = 0.8
        m.diffuse_color = col
        mats[n] = m
    return mats


def make_mesh(name, mb, colors, arm_ob, blank_uv, sharp_deg=48.0):
    """Create the skinned mesh object from a MeshBuilder."""
    import bpy
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in mb.verts], [], mb.faces)
    me.validate(clean_customdata=False)
    mats = make_materials(colors)
    used = [n for n in SLOTS if n in set(mb.fmat)]
    for n in used:
        me.materials.append(mats[n])
    mi = {n: i for i, n in enumerate(used)}
    me.polygons.foreach_set('material_index', [mi[m] for m in mb.fmat])
    me.polygons.foreach_set('use_smooth', [not fl for fl in mb.fflat])
    # sharp edges: dihedral angle above threshold, or next to a flat face
    me.update()
    adj = {}
    for p in me.polygons:
        for ek in p.edge_keys:
            adj.setdefault(ek, []).append(p.index)
    cos_t = math.cos(math.radians(sharp_deg))
    sharp = []
    for e in me.edges:
        ps = adj.get(e.key, [])
        s = False
        if len(ps) == 2:
            a, b = me.polygons[ps[0]], me.polygons[ps[1]]
            if (not a.use_smooth) or (not b.use_smooth) or a.normal.dot(b.normal) < cos_t:
                s = True
        sharp.append(s)
    attr = me.attributes.get('sharp_edge') or me.attributes.new('sharp_edge', 'BOOLEAN', 'EDGE')
    attr.data.foreach_set('value', sharp)
    # UVs (per corner): decal faces get their projections, everything else the blank texel
    uvl = me.uv_layers.new(name='UVMap')
    data = []
    for p in me.polygons:
        uvs = mb.fuv.get(p.index)
        for k in range(p.loop_total):
            u, v = uvs[k] if uvs else blank_uv
            data += [u, 1.0 - v]   # Blender UV origin is bottom-left; atlas pixels are top-down
    uvl.data.foreach_set('uv', data)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    # weights: top 4, normalised
    groups = {}
    for n in [b.name for b in arm_ob.data.bones]:
        groups[n] = ob.vertex_groups.new(name=n)
    for i, w in enumerate(mb.wts):
        items = sorted(((k, x) for k, x in w.items() if x > 1e-4), key=lambda kv: (-kv[1], kv[0]))[:4]
        tot = sum(x for _, x in items)
        if tot <= 0:
            raise RuntimeError(f'{name}: vertex {i} has no weights ({w})')
        for k, x in items:
            if k not in groups:
                raise KeyError(f'{name}: unknown bone {k}')
            groups[k].add([i], x / tot, 'REPLACE')
    ob.parent = arm_ob
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm_ob
    return ob


def bake_clip(arm_ob, rig, clip, loc_bones=('hips', 'bag')):
    """Solve every frame, write one action (all bones rotation, hips/bag location).
    Frame nfr duplicates frame 0 so the loop closes exactly."""
    import bpy
    act = bpy.data.actions.new(clip.name)
    arm_ob.animation_data_create()
    arm_ob.animation_data.action = act
    nfr = clip.frames
    rot = {n: [] for n in rig.order}
    loc = {n: [] for n in rig.order}
    diag_all = []
    for f in range(nfr + 1):
        c = clip.controls[f % nfr]
        G, diag = rig.solve(c)
        diag_all.append(diag)
        B = rig.basis(G)
        for n in rig.order:
            t, q, _ = B[n].decompose()
            if rot[n] and rot[n][-1].dot(q) < 0:
                q = -q
            rot[n].append(q)
            loc[n].append(t)
    for n in rig.order:
        pb = arm_ob.pose.bones[n]
        pb.rotation_mode = 'QUATERNION'
        for i in range(4):
            fc = act.fcurve_ensure_for_datablock(arm_ob, f'pose.bones["{n}"].rotation_quaternion', index=i, group_name=n)
            co = []
            for f in range(nfr + 1):
                co += [f, rot[n][f][i]]
            fc.keyframe_points.add(nfr + 1)
            fc.keyframe_points.foreach_set('co', co)
            fc.keyframe_points.foreach_set('interpolation', [1] * (nfr + 1))  # LINEAR
            fc.update()
        maxt = max(t.length for t in loc[n])
        if n in loc_bones or n == 'hips' or maxt > 5e-4:
            if n not in loc_bones and n != 'hips':
                print(f'  [{clip.name}] note: bone {n} carries translation {maxt:.4f} m')
            for i in range(3):
                fc = act.fcurve_ensure_for_datablock(arm_ob, f'pose.bones["{n}"].location', index=i, group_name=n)
                co = []
                for f in range(nfr + 1):
                    co += [f, loc[n][f][i]]
                fc.keyframe_points.add(nfr + 1)
                fc.keyframe_points.foreach_set('co', co)
                fc.keyframe_points.foreach_set('interpolation', [1] * (nfr + 1))
                fc.update()
    act.use_frame_range = True
    act.frame_start = 0
    act.frame_end = nfr
    act.use_cyclic = True
    act.use_fake_user = True
    arm_ob.animation_data.action = None
    return act, diag_all


def export_glb(path):
    import bpy
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False, export_apply=False,
        export_yup=True, export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials='EXPORT', export_image_format='NONE', export_extras=True,
        export_skins=True, export_influence_nb=4, export_all_influences=False,
        export_def_bones=False, export_rest_position_armature=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_frame_range=False, export_anim_slide_to_zero=True, export_reset_pose_bones=True,
        export_optimize_animation_size=True, export_anim_single_armature=True,
        export_morph=False, export_lights=False, export_cameras=False)


# --------------------------------------------------------------------------------------
# GLB inspection (verification of what the game actually receives)
# --------------------------------------------------------------------------------------

def read_glb(path):
    data = open(path, 'rb').read()
    magic, ver, length = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67, 'not a glb'
    off = 12
    js, bin_ = None, b''
    while off < length:
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk)
        elif ctype == 0x004E4942:
            bin_ = chunk
        off += 8 + clen
    return js, bin_


_CT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
_NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def accessor(js, bin_, i):
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    n = _NC[a['type']]
    dt = np.dtype(_CT[a['componentType']]).newbyteorder('<')
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0)
    cnt = a['count']
    if stride and stride != n * dt.itemsize:
        rows = [np.frombuffer(bin_, dt, n, start + r * stride) for r in range(cnt)]
        return np.array(rows)
    return np.frombuffer(bin_, dt, cnt * n, start).reshape(cnt, n)


def inspect_glb(path):
    js, bin_ = read_glb(path)
    info = {'file': path}
    tris = 0
    mats = set()
    max_infl = 0
    wsum_err = 0.0
    uv_ok = True
    for m in js['meshes']:
        for p in m['primitives']:
            assert p.get('mode', 4) == 4
            tris += js['accessors'][p['indices']]['count'] // 3
            mats.add(js['materials'][p['material']]['name'])
            at = p['attributes']
            uv_ok &= 'TEXCOORD_0' in at
            if 'WEIGHTS_0' in at:
                w = accessor(js, bin_, at['WEIGHTS_0']).astype(float)
                if js['accessors'][at['WEIGHTS_0']]['componentType'] != 5126:
                    w = w / 255.0
                max_infl = max(max_infl, int((w > 1e-4).sum(1).max()))
                wsum_err = max(wsum_err, float(np.abs(w.sum(1) - 1).max()))
            else:
                raise RuntimeError('mesh without skin weights')
    info['triangles'] = tris
    info['materials'] = sorted(mats)
    info['uv'] = uv_ok
    info['max_influences'] = max_infl
    info['weight_sum_err'] = round(wsum_err, 5)
    skin = js['skins'][0]
    joints = [js['nodes'][j]['name'] for j in skin['joints']]
    info['joints'] = joints
    info['joint0'] = joints[0]
    anims = {}
    for a in js.get('animations', []):
        tmax = 0.0
        for smp in a['samplers']:
            acc = js['accessors'][smp['input']]
            tmax = max(tmax, acc['max'][0])
        anims[a['name']] = round(tmax, 4)
    info['animations'] = anims
    # bounds of the mesh (Y up)
    mins, maxs = [], []
    for m in js['meshes']:
        for p in m['primitives']:
            acc = js['accessors'][p['attributes']['POSITION']]
            mins.append(acc['min'])
            maxs.append(acc['max'])
    info['bbox_min'] = [round(min(x[i] for x in mins), 3) for i in range(3)]
    info['bbox_max'] = [round(max(x[i] for x in maxs), 3) for i in range(3)]
    return info


# --------------------------------------------------------------------------------------
# Skin weights
# --------------------------------------------------------------------------------------

def _mix(*pairs):
    w = {}
    for k, x in pairs:
        if x > 0:
            w[k] = w.get(k, 0.0) + x
    return w


class Wt:
    def __init__(self, J, b):
        self.J, self.b = J, b
        self.hip_z = J['hip_z']
        self.knee_z = J['knee.L'].z
        self.ank_z = J['ankle.L'].z
        self.hips_z = J['hips'].z
        self.spine_z = J['spine'].z
        self.chest_z = J['chest'].z
        self.neck_z = J['neck'].z
        self.head_z = J['head'].z
        self.sh_z = J['sh_z']
        self.shw = abs(J['sh.L'].x)

    def torso(self, p, skirt=0.0, shoulder=0.55, hipbias=0.0):
        z = p.z
        zs, zc = self.spine_z + hipbias, self.chest_z
        if z <= zs - 0.05:
            w = {'hips': 1.0}
        elif z <= zs + 0.05:
            t = smoothstep(zs - 0.05, zs + 0.05, z)
            w = {'hips': 1 - t, 'spine': t}
        elif z <= zc - 0.05:
            w = {'spine': 1.0}
        elif z <= zc + 0.06:
            t = smoothstep(zc - 0.05, zc + 0.06, z)
            w = {'spine': 1 - t, 'chest': t}
        else:
            w = {'chest': 1.0}
        if z > self.neck_z - 0.01:
            t = smoothstep(self.neck_z - 0.01, self.neck_z + 0.06, z) * 0.6
            w = {k: v * (1 - t) for k, v in w.items()}
            w['neck'] = w.get('neck', 0) + t
        if shoulder and z > self.sh_z - 0.12:
            side = 'L' if p.x > 0 else 'R'
            t = smoothstep(0.35 * self.shw, 1.05 * self.shw, abs(p.x)) * smoothstep(self.sh_z - 0.12, self.sh_z, z) * shoulder
            if t > 0:
                w = {k: v * (1 - t) for k, v in w.items()}
                w['shoulder.' + side] = w.get('shoulder.' + side, 0) + t
        if skirt and z < self.hip_z + 0.04:
            d = clamp((self.hip_z + 0.04 - z) / 0.32, 0.0, 1.0)
            t = skirt * smooth(d)
            fl = smoothstep(-0.07, 0.07, p.x)
            w = {k: v * (1 - t) for k, v in w.items()}
            if fl > 0:
                w['thigh.L'] = w.get('thigh.L', 0) + t * fl
            if fl < 1:
                w['thigh.R'] = w.get('thigh.R', 0) + t * (1 - fl)
        return w

    def leg(self, s, p, foot=0.0, hipblend=0.5):
        z = p.z
        th, sh = 'thigh.' + s, 'shin.' + s
        if z > self.hip_z - 0.04:
            h = hipblend * smoothstep(self.hip_z - 0.04, self.hip_z + 0.1, z)
            return {'hips': h, th: 1 - h}
        if z > self.knee_z + 0.06:
            return {th: 1.0}
        if z > self.knee_z - 0.06:
            t = smoothstep(self.knee_z + 0.06, self.knee_z - 0.06, z)
            return {th: 1 - t, sh: t}
        if foot and z < self.ank_z + 0.05:
            t = foot * smoothstep(self.ank_z + 0.05, self.ank_z - 0.03, z)
            return {sh: 1 - t, 'foot.' + s: t}
        return {sh: 1.0}

    def arm(self, s, p, hand=0.0):
        J = self.J
        d = J['arm_dir.' + s]
        t = (p - J['sh.' + s]).dot(d)
        L1 = (J['elbow.' + s] - J['sh.' + s]).length
        L2 = (J['wrist.' + s] - J['elbow.' + s]).length
        ua, fa, sh = 'upper_arm.' + s, 'forearm.' + s, 'shoulder.' + s
        if t < 0.07:
            k = 0.45 * smoothstep(0.07, -0.04, t)
            return {sh: k, ua: 1 - k}
        if t < L1 - 0.055:
            return {ua: 1.0}
        if t < L1 + 0.055:
            k = smoothstep(L1 - 0.055, L1 + 0.055, t)
            return {ua: 1 - k, fa: k}
        if hand and t > L1 + L2 - 0.03:
            k = hand * smoothstep(L1 + L2 - 0.03, L1 + L2 + 0.02, t)
            return {fa: 1 - k, 'hand.' + s: k}
        return {fa: 1.0}

    def foot(self, s, p, toe_y=None):
        """Shoe weighting: foot behind the ball, toe in front."""
        yb = self.J['ball.' + s].y
        k = smoothstep(yb + 0.03, yb - 0.035, p.y)
        if k <= 0:
            return {'foot.' + s: 1.0}
        if k >= 1:
            return {'toe.' + s: 1.0}
        return {'foot.' + s: 1 - k, 'toe.' + s: k}


# --------------------------------------------------------------------------------------
# Surfaces (for straps, patches, pockets)
# --------------------------------------------------------------------------------------

class TorsoSurf:
    """Parametric outer surface of a vertical torso loft.
    rings: [(z, hw, front, back, yoff, p)], th = angle in degrees, 90 = front centre."""

    def __init__(self, rings, n3d=False):
        self.r = sorted(rings, key=lambda r: r[0])
        self.n3d = n3d   # True: true surface normal (domes, skulls); False: horizontal

    def params(self, z):
        r = self.r
        if z <= r[0][0]:
            return r[0]
        if z >= r[-1][0]:
            return r[-1]
        for a, b in zip(r, r[1:]):
            if a[0] <= z <= b[0]:
                t = (z - a[0]) / (b[0] - a[0])
                return tuple(lerp(x, y, t) for x, y in zip(a, b))

    def at(self, z, th, off=0.0):
        zz, hw, fr, bk, yoff, p = self.params(z)
        th_r = math.radians(th)
        c, s = math.cos(th_r), math.sin(th_r)
        x = math.copysign(abs(c) ** (2.0 / p), c) * hw
        y = math.copysign(abs(s) ** (2.0 / p), s) * (fr if s >= 0 else bk)
        pt = Vector((x, -(y + yoff), z))
        # outward normal: gradient of the superellipse in the XY plane
        nx = math.copysign(abs(c) ** (2 - 2.0 / p), c) / hw
        ny = math.copysign(abs(s) ** (2 - 2.0 / p), s) / (fr if s >= 0 else bk)
        n = Vector((nx, -ny, 0)).normalized()
        if self.n3d:
            e = 0.003
            lo, hi = max(z - e, self.r[0][0]), min(z + e, self.r[-1][0])
            if hi - lo > 1e-6:
                tz = self._p(hi, th) - self._p(lo, th)
                tt = self._p(z, th + 0.5) - self._p(z, th - 0.5)
                n3 = tt.cross(tz)
                if n3.length > 1e-9:
                    n3.normalize()
                    if n3.dot(n) < 0:
                        n3 = -n3
                    n = n3
        return pt + n * off, n

    def _p(self, z, th):
        zz, hw, fr, bk, yoff, p = self.params(z)
        th_r = math.radians(th)
        c, s = math.cos(th_r), math.sin(th_r)
        x = math.copysign(abs(c) ** (2.0 / p), c) * hw
        y = math.copysign(abs(s) ** (2.0 / p), s) * (fr if s >= 0 else bk)
        return Vector((x, -(y + yoff), z))


def patch(mb, S, us, vs, out, inn, mat, wfn, flat=False, tag=None, name='patch', matfn=None):
    """Closed plate following a parametric surface S(u, v) -> (point, normal).
    Grid us x vs; outer layer at +out, inner at +inn along the normal."""
    first = mb.begin()
    nu, nv = len(us), len(vs)
    O, I_ = [], []
    for u in us:
        ro, ri = [], []
        for v in vs:
            p, n = S(u, v)
            po, pi = p + n * out, p + n * inn
            ro.append(mb.v(po, wfn(p)))
            ri.append(mb.v(pi, wfn(p)))
        O.append(ro)
        I_.append(ri)
    for i in range(nu - 1):
        for j in range(nv - 1):
            m = matfn(i, j) if matfn else mat
            mb.f([O[i][j], O[i + 1][j], O[i + 1][j + 1], O[i][j + 1]], m, flat, tag)
            mb.f([I_[i][j], I_[i][j + 1], I_[i + 1][j + 1], I_[i + 1][j]], mat, flat, tag)
    # walls
    border = [(i, 0) for i in range(nu)] + [(nu - 1, j) for j in range(1, nv)] + \
             [(i, nv - 1) for i in range(nu - 2, -1, -1)] + [(0, j) for j in range(nv - 2, 0, -1)]
    for k in range(len(border)):
        a, b = border[k], border[(k + 1) % len(border)]
        mb.f([O[a[0]][a[1]], I_[a[0]][a[1]], I_[b[0]][b[1]], O[b[0]][b[1]]], mat, flat, tag)
    mb.end(first, name)
    return O, I_


def sticker(mb, S, us, vs, off, mat, wfn, tag=None, name='print'):
    """Single-sided sheet just above a surface (prints, logos): no thickness, so the ink
    hull draws no outline around it. Faces wind so their normal follows S's normal.
    Returns the face indices."""
    G = []
    for u in us:
        row = []
        for v in vs:
            p, n = S(u, v)
            row.append((mb.v(p + n * off, wfn(p) if callable(wfn) else wfn), n))
        G.append(row)
    out = []
    for i in range(len(us) - 1):
        for j in range(len(vs) - 1):
            q = [G[i][j][0], G[i + 1][j][0], G[i + 1][j + 1][0], G[i][j + 1][0]]
            nrm = G[i][j][1] + G[i + 1][j + 1][1]
            fi = mb.f(q, mat, False, tag)
            if mb.face_normal(len(mb.faces) - 1).dot(nrm) < 0:
                mb.faces[-1] = tuple(reversed(mb.faces[-1]))
            out.append(len(mb.faces) - 1)
    mb.shells.append((out[0], out[-1] + 1, name))
    return out


def prism(mb, pts, thick, mat, w, flat=True, tag=None, name='prism', matfn=None):
    """Extrude a closed polygon (3D points) by vector `thick` into a closed shell."""
    first = mb.begin()
    thick = Vector(thick)
    a = [mb.v(p, w) for p in pts]
    b = [mb.v(Vector(p) + thick, w) for p in pts]
    n = len(pts)
    mb.f(list(reversed(a)), mat, flat, tag)
    mb.f(list(b), matfn('top') if matfn else mat, flat, tag)
    for k in range(n):
        k1 = (k + 1) % n
        mb.f([a[k], a[k1], b[k1], b[k]], mat, flat, tag)
    mb.end(first, name)
    return a, b


def box(mb, c, ax, ay, az, hx, hy, hz, mat, w, flat=True, bevel=0.0, tag=None, name='box', matfn=None):
    """Oriented box centred at c with axes (ax, ay, az) and half sizes; bevel chamfers the
    four edges around the az axis (octagonal section)."""
    c, ax, ay, az = Vector(c), Vector(ax).normalized(), Vector(ay).normalized(), Vector(az).normalized()
    if bevel > 0:
        b = bevel
        sec = [(hx, hy - b), (hx - b, hy), (-hx + b, hy), (-hx, hy - b), (-hx, -hy + b), (-hx + b, -hy), (hx - b, -hy), (hx, -hy + b)]
    else:
        sec = [(hx, hy), (-hx, hy), (-hx, -hy), (hx, -hy)]
    pts = [c + ax * x + ay * y - az * hz for x, y in sec]
    return prism(mb, pts, az * (2 * hz), mat, w, flat, tag, name, matfn)


def tube_path(mb, path, radii, mat, w, n=6, up=(0, 0, 1), flat=False, tag=None, name='tube', cap0=True, cap1=True, ry=None, matfn=None, start=90.0):
    """Loft along a polyline; radii per point (rx) and optional ry. Ends can be apex points
    by giving radius 0 (cone tip). w: callable(p) or dict or list per point."""
    rings = []
    m = len(path)
    for i, p in enumerate(path):
        p = Vector(p)
        if i == 0:
            d = Vector(path[1]) - p
        elif i == m - 1:
            d = p - Vector(path[i - 1])
        else:
            d = (Vector(path[i + 1]) - Vector(path[i - 1]))
        wi = w[i] if isinstance(w, list) else w
        if radii[i] <= 0:
            rings.append(dict(c=p, pts=None, w=wi))
        else:
            r2 = ry[i] if ry else radii[i]
            rings.append(ring(p, d, prof(n, radii[i], r2, start=start), wi, fwd=up, lat=Vector(up).cross(d) if Vector(up).cross(d).length > 1e-6 else (1, 0, 0)))
    return mb.loft(rings, mat, flat=flat, tag=tag, name=name, cap0=cap0, cap1=cap1, matfn=matfn)


# --------------------------------------------------------------------------------------
# Body parts
# --------------------------------------------------------------------------------------

def vertical_loft(mb, rings, mat, wfn, n=12, matfn=None, flat=False, tag=None, name='', cap0=True, cap1=True, warp=None, angles=None):
    """Loft of horizontal rings (z, hw, front, back, yoff, p[, hw_in]) bottom -> top."""
    rr = []
    for r in rings:
        z, hw, fr, bk, yoff, p = r[:6]
        hw_in = r[6] if len(r) > 6 else None
        pts = prof(len(angles) if angles else n, hw, fr, bk, p=p, rx_in=hw_in, angles=angles, warp=(lambda k, th, x, y, z=z: warp(k, th, x, y, z)) if warp else None)
        rr.append(ring((0, -yoff, z), (0, 0, 1), pts, wfn))
    return mb.loft(rr, mat, flat=flat, tag=tag, matfn=matfn, name=name, cap0=cap0, cap1=cap1)


HEAD_RINGS = [  # (z, rx, front, back, yfwd, p) relative to the head bone head
    (-0.030, 0.020, 0.016, 0.018, 0.056, 2.0),
    (-0.008, 0.046, 0.040, 0.044, 0.034, 2.2),
    (0.030, 0.066, 0.066, 0.070, 0.014, 2.4),
    (0.075, 0.073, 0.077, 0.084, 0.005, 2.5),
    (0.118, 0.072, 0.074, 0.088, 0.000, 2.4),
    (0.158, 0.060, 0.058, 0.080, -0.006, 2.3),
    (0.182, 0.038, 0.034, 0.055, -0.010, 2.2),
]
HEAD_APEX = (0.194, -0.012)
EYE_Z = 0.075


class Head:
    pass


def build_head(mb, J, W, hs=1.0, wide=1.0, jaw=1.0, chin=1.0, n=10, ears=False, mat='skin'):
    O = J['head']
    H = Head()
    H.O, H.hs = O, hs
    rings = []
    for i, (z, rx, fr, bk, yf, p) in enumerate(HEAD_RINGS):
        k = jaw if i <= 1 else (lerp(jaw, 1.0, 0.5) if i == 2 else 1.0)
        c = chin if i == 0 else 1.0
        rings.append((O.z + z * hs, rx * hs * wide * k * c, fr * hs * c, bk * hs, yf * hs, p))
    H.rings = rings
    H.surf = TorsoSurf(rings)
    # hair surface: never narrower than the cheek ring below the cheeks
    cheek = rings[2]
    hr = [(z, max(rx, cheek[1] * 0.98), max(fr, cheek[2] * 0.9), max(bk, cheek[3]), min(yf, 0.02 * hs), p) if i <= 3
          else (z, rx, fr, bk, yf, p) for i, (z, rx, fr, bk, yf, p) in enumerate(rings)]
    hr.insert(0, (O.z - 0.12 * hs, cheek[1] * 0.98, cheek[2] * 0.85, cheek[3], 0.01 * hs, 2.4))
    H.hair_surf = TorsoSurf(hr, n3d=True)
    H.eye_z = O.z + EYE_Z * hs
    H.apex = V(0, -HEAD_APEX[1] * hs, O.z + HEAD_APEX[0] * hs)
    H.top_z = H.apex.z
    H.center = V(0, 0.01 * hs, O.z + 0.085 * hs)
    H.face_y = -(rings[3][2] + rings[3][4])
    H.half_w = rings[3][1]
    w = {'head': 1.0}
    rr = [ring((0, -yf, z), (0, 0, 1), prof(n, rx, fr, bk, p=p), w) for (z, rx, fr, bk, yf, p) in rings]
    rr.append(pt_ring(H.apex, w))
    H.first_face = len(mb.faces)
    mb.loft(rr, mat, tag='head', name='head')
    H.last_face = len(mb.faces)
    if ears:
        for sx in (1, -1):
            c = V(sx * (rings[3][1] - 0.002 * hs), 0.012 * hs, O.z + 0.058 * hs)
            box(mb, c, (0, -1, 0), (0, 0, 1), (sx, 0, 0), 0.016 * hs, 0.026 * hs, 0.009 * hs, mat, w, flat=False, bevel=0.007 * hs, name='ear')
    return H


def build_neck(mb, J, W, r=0.042, rf=None, mat='skin', bottom=None, n=8):
    rf = rf or r * 1.05
    zb = bottom if bottom is not None else J['neck'].z - 0.07
    zt = J['head'].z + 0.035
    pts = [(zb, 0.004), (J['neck'].z + 0.02, 0.006), (J['head'].z - 0.005, 0.01), (zt, 0.014)]
    rr = []
    for i, (z, y) in enumerate(pts):
        if i == 0:
            w = {'chest': 0.6, 'neck': 0.4}
        elif i == 1:
            w = {'neck': 1.0}
        elif i == 2:
            w = {'neck': 0.6, 'head': 0.4}
        else:
            w = {'head': 1.0}
        rr.append(ring((0, y, z), (0, 0, 1), prof(n, r, rf * (1.0 if i < 3 else 0.9), r * 1.05), w))
    mb.loft(rr, mat, name='neck')


def hand_frame(J, s):
    sx = 1 if s == 'L' else -1
    a = J['arm_dir.' + s].copy()
    f = Vector((0, -1, 0))
    n = (a.cross(f) * sx).normalized()
    return J['wrist.' + s].copy(), a, f, n


def build_hand(mb, J, W, s, sc=1.2, curl=1.15, mat='skin', thumb_up=0.0, split=True):
    W0, a, f, n = hand_frame(J, s)
    w = {'hand.' + s: 1.0}
    k = sc

    def R(c, d, xp, xb, yt, yp, p=2.6, m=8, ww=w):
        return ring(c, d, prof(m, xp * k, yt * k, yp * k, p=p, rx_in=xb * k), ww, fwd=f, lat=n)
    palm = [
        R(W0 - a * 0.012 * k, a, 0.016, 0.014, 0.032, 0.032, ww={'hand.' + s: 0.7, 'forearm.' + s: 0.3}),
        R(W0 + a * 0.025 * k + n * 0.002 * k, a, 0.022, 0.018, 0.044, 0.042),
        R(W0 + a * 0.072 * k + n * 0.001 * k, a, 0.019, 0.017, 0.049, 0.047),
        R(W0 + a * 0.098 * k, a, 0.015, 0.015, 0.045, 0.046),
    ]
    mb.loft(palm, mat, name='palm')
    K = W0 + a * 0.094 * k + n * 0.002 * k
    groups = [(0.0, 0.046, 0.045)] if not split else [(0.024, 0.022, 0.021), (-0.022, 0.021, 0.02)]
    for off, wy_t, wy_p in groups:
        base = K + f * off * k
        pts, dirs = [base], []
        ang = 0.0
        segs = [(0.036, 0.3), (0.03, 0.75), (0.024, 1.1)] if split else [(0.04, 0.3), (0.034, 0.75), (0.026, 1.1)]
        if off < 0:
            segs = [(l * 0.92, c) for l, c in segs]
        for L, c in segs:
            ang = curl * c
            d = (a * math.cos(ang) + n * math.sin(ang))
            pts.append(pts[-1] + d * L * k)
        rr = []
        for i, p in enumerate(pts):
            if i == 0:
                d = a
            elif i == len(pts) - 1:
                d = pts[i] - pts[i - 1]
            else:
                d = pts[i + 1] - pts[i - 1]
            sh = 1.0 - 0.12 * i
            th = 0.0125 * (1.0 - 0.08 * i)
            rr.append(R(p, d, th, th, wy_t * sh, wy_p * sh, p=2.4, m=6))
        mb.loft(rr, mat, name='fingers')
    # thumb
    tb = W0 + a * 0.03 * k + f * 0.036 * k + n * 0.012 * k
    d1 = (a * 0.8 + f * 0.6 + n * (0.25 + thumb_up)).normalized()
    p1 = tb + d1 * 0.034 * k
    d2 = (a * 0.75 + f * 0.15 + n * 0.6).normalized()
    p2 = p1 + d2 * 0.03 * k
    tube_path(mb, [tb, p1, p2], [0.0145 * k, 0.0125 * k, 0.010 * k], mat, w, n=6, up=n, name='thumb')


# ---- footwear ------------------------------------------------------------------------

def shoe_rings(mb, J, W, s, rings, mat, n=8, p=3.0, rigid=False, name='shoe', matfn=None, tag=None):
    """rings: (y, hw_out, hw_in, z_bot, z_top) along the foot, heel -> toe."""
    sx = 1 if s == 'L' else -1
    x0 = J['ankle.' + s].x
    rr = []
    for y, ho, hi, zb, zt in rings:
        zc, hz = (zb + zt) / 2, (zt - zb) / 2
        wfn = (lambda q: {'foot.' + s: 1.0}) if rigid else (lambda q: W.foot(s, q))
        rr.append(ring((x0, y, zc), (0, -1, 0), prof(n, ho, hz, hz, p=p, start=90.0, rx_in=hi), wfn, fwd=(0, 0, 1), lat=(sx, 0, 0)))
    return mb.loft(rr, mat, name=name, matfn=matfn, tag=tag)


SNEAKER_SOLE = [(0.084, 0.034, 0.032, 0.006, 0.034), (0.064, 0.052, 0.048, 0.0, 0.036), (-0.03, 0.05, 0.04, 0.0, 0.034),
                (-0.14, 0.062, 0.056, 0.0, 0.034), (-0.215, 0.054, 0.05, 0.004, 0.036), (-0.256, 0.03, 0.028, 0.017, 0.041)]
SNEAKER_UPPER = [(0.072, 0.042, 0.04, 0.03, 0.128), (0.022, 0.05, 0.047, 0.03, 0.142), (-0.05, 0.053, 0.05, 0.03, 0.12),
                 (-0.135, 0.056, 0.053, 0.03, 0.09), (-0.2, 0.05, 0.047, 0.032, 0.076), (-0.242, 0.03, 0.028, 0.038, 0.063)]


def build_shoe(mb, J, W, s, kind='sneaker', upper='shoes', sole='accent', sc=1.0, tongue=True):
    """Footwear on the rest foot. Returns the upper's face range (for stripe decals)."""
    def S(rings, dz=0.0, kx=1.0, ky=1.0, kz=1.0):
        return [(y * ky, ho * kx, hi * kx, zb * kz + dz, zt * kz + dz) for y, ho, hi, zb, zt in rings]
    sx = 1 if s == 'L' else -1
    x0 = J['ankle.' + s].x
    if kind in ('sneaker', 'hightop', 'skateshoe'):
        sole_r = S(SNEAKER_SOLE, kx=sc, ky=sc)
        up = S(SNEAKER_UPPER, kx=sc, ky=sc)
        if kind == 'hightop':
            up[0] = (up[0][0], up[0][1], up[0][2], up[0][3], 0.17)
            up[1] = (up[1][0], up[1][1] * 1.03, up[1][2] * 1.03, up[1][3], 0.19)
            up[2] = (up[2][0], up[2][1], up[2][2], up[2][3], 0.135)
        if kind == 'skateshoe':
            up = [(y, ho * 1.06, hi * 1.06, zb, zt * 1.04) for y, ho, hi, zb, zt in up]
            sole_r = [(y, ho * 1.05, hi * 1.05, zb, zt * 0.92) for y, ho, hi, zb, zt in sole_r]
        shoe_rings(mb, J, W, s, sole_r, sole, p=4.0, name='sole')
        f0 = len(mb.faces)
        shoe_rings(mb, J, W, s, up, upper, p=3.0, name='upper', tag='upper')
        f1 = len(mb.faces)
        if tongue:
            top = up[1][4]
            c = V(x0, up[1][0] - 0.008, top - 0.004)
            box(mb, c, (sx, 0, 0), (0, -0.45, 1), (0, 1, 0.45), 0.03 * sc, 0.024, 0.009, upper,
                lambda q: W.foot(s, q), flat=True, bevel=0.008, name='tongue')
        return f0, f1
    if kind == 'boot':
        sole_r = S(SNEAKER_SOLE, kx=1.06 * sc, ky=1.02 * sc, kz=1.15)
        up = S(SNEAKER_UPPER, kx=1.08 * sc, ky=1.02 * sc)
        up[0] = (up[0][0], up[0][1], up[0][2], up[0][3] + 0.005, 0.2)
        up[1] = (up[1][0], up[1][1] * 1.08, up[1][2] * 1.08, up[1][3] + 0.005, 0.215)
        up[2] = (up[2][0], up[2][1] * 1.04, up[2][2] * 1.04, up[2][3] + 0.005, 0.15)
        up[3] = (up[3][0], up[3][1], up[3][2], up[3][3] + 0.005, 0.1)
        up = [(y, ho, hi, zb + 0.005, zt) for y, ho, hi, zb, zt in up]
        shoe_rings(mb, J, W, s, sole_r, sole, p=5.0, name='sole')
        f0 = len(mb.faces)
        shoe_rings(mb, J, W, s, up, upper, p=3.0, name='upper', tag='upper')
        f1 = len(mb.faces)
        # cuff band
        rr = []
        for z in (0.185, 0.222):
            rr.append(ring((x0, 0.02, z), (0, 0, 1), prof(8, 0.056 * sc, 0.058 * sc, 0.054, p=2.4), {'foot.' + s: 0.7, 'shin.' + s: 0.3}))
        mb.loft(rr, sole, name='bootcuff')
        return f0, f1
    if kind == 'loafer':
        sole_r = [(y * 0.95, ho * 0.86, hi * 0.86, zb, zb + 0.02) for y, ho, hi, zb, zt in SNEAKER_SOLE]
        sole_r[0] = (sole_r[0][0], sole_r[0][1], sole_r[0][2], 0.0, 0.032)
        sole_r[1] = (sole_r[1][0], sole_r[1][1], sole_r[1][2], 0.0, 0.032)
        up = [(y * 0.95, ho * 0.88, hi * 0.88, 0.016, zt * 0.82) for y, ho, hi, zb, zt in SNEAKER_UPPER]
        up[0] = (up[0][0], up[0][1], up[0][2], 0.028, 0.1)
        up[1] = (up[1][0], up[1][1], up[1][2], 0.024, 0.105)
        shoe_rings(mb, J, W, s, sole_r, sole, p=4.0, name='sole')
        f0 = len(mb.faces)
        shoe_rings(mb, J, W, s, up, upper, p=2.6, name='upper', tag='upper')
        return f0, len(mb.faces)
    if kind == 'platform':
        h = 0.055
        sole_r = [(0.084, 0.04, 0.038, 0.0, 0.05 + h * 0.6), (0.064, 0.056, 0.052, 0.0, 0.052 + h * 0.6),
                  (-0.03, 0.054, 0.046, 0.0, 0.048 + h * 0.5), (-0.14, 0.064, 0.058, 0.0, 0.04 + h * 0.35),
                  (-0.215, 0.056, 0.052, 0.003, 0.04 + h * 0.3), (-0.252, 0.034, 0.032, 0.012, 0.04 + h * 0.28)]
        up = [(0.068, 0.04, 0.038, 0.07, 0.15), (0.02, 0.048, 0.045, 0.07, 0.165), (-0.05, 0.05, 0.047, 0.06, 0.13),
              (-0.135, 0.054, 0.051, 0.05, 0.106), (-0.2, 0.048, 0.045, 0.052, 0.092), (-0.238, 0.03, 0.028, 0.055, 0.08)]
        shoe_rings(mb, J, W, s, sole_r, sole, p=5.0, name='sole')
        f0 = len(mb.faces)
        shoe_rings(mb, J, W, s, up, upper, p=2.8, name='upper', tag='upper')
        return f0, len(mb.faces)
    raise ValueError(kind)


def build_skate(mb, J, W, s, kind='inline', boot='shoes', frame='gear', wheel='accent', cuff='accent'):
    sx = 1 if s == 'L' else -1
    x0 = J['ankle.' + s].x
    w = {'foot.' + s: 1.0}
    rigid = lambda q: w
    if kind == 'inline':
        r = 0.036
        zb = 0.088   # boot sole bottom
        up = [(0.075, 0.046, 0.044, zb, 0.24), (0.02, 0.056, 0.053, zb, 0.27), (-0.06, 0.058, 0.055, zb, 0.18),
              (-0.14, 0.058, 0.055, zb, 0.135), (-0.205, 0.05, 0.048, zb + 0.004, 0.12), (-0.24, 0.03, 0.028, zb + 0.012, 0.11)]
        f0 = len(mb.faces)
        shoe_rings(mb, J, W, s, up, boot, p=3.0, rigid=True, name='skateboot', tag='upper')
        f1 = len(mb.faces)
        # chunky cuff strap at the top
        rr = [ring((x0, 0.022, z), (0, 0, 1), prof(8, 0.064, 0.066, 0.062, p=2.6), {'foot.' + s: 0.75, 'shin.' + s: 0.25}) for z in (0.215, 0.262)]
        mb.loft(rr, cuff, name='skatecuff')
        # sole plate + frame
        sole = [(0.085, 0.044, 0.042, zb - 0.018, zb + 0.006), (-0.235, 0.034, 0.032, zb - 0.018, zb + 0.008)]
        shoe_rings(mb, J, W, s, [(0.085, 0.046, 0.044, zb - 0.014, zb + 0.008), (0.0, 0.05, 0.047, zb - 0.014, zb + 0.008),
                                 (-0.16, 0.052, 0.05, zb - 0.014, zb + 0.008), (-0.24, 0.032, 0.03, zb - 0.01, zb + 0.012)],
                   frame, p=4, rigid=True, name='skatesole')
        fr = [(0.075, 0.016, 0.016, r * 0.95, zb - 0.01), (-0.205, 0.016, 0.016, r * 0.95, zb - 0.01)]
        shoe_rings(mb, J, W, s, fr, frame, n=6, p=5, rigid=True, name='frame')
        for y in (0.056, -0.02, -0.096, -0.172):
            rr = []
            for xo in (-0.012, 0.012):
                rr.append(ring((x0 + xo, y, r), (1, 0, 0), prof(8, r, r, r, p=2.0, start=0.0), w, fwd=(0, -1, 0), lat=(0, 0, 1)))
            mb.loft(rr, wheel, name='wheel', flat=False)
        return f0, f1
    if kind == 'quad':
        r = 0.03
        zb = 0.078
        up = [(0.07, 0.044, 0.042, zb, 0.2), (0.02, 0.054, 0.051, zb, 0.225), (-0.06, 0.056, 0.053, zb, 0.15),
              (-0.14, 0.056, 0.053, zb, 0.125), (-0.2, 0.05, 0.047, zb + 0.004, 0.112), (-0.236, 0.03, 0.028, zb + 0.012, 0.102)]
        f0 = len(mb.faces)
        shoe_rings(mb, J, W, s, up, boot, p=2.8, rigid=True, name='skateboot', tag='upper')
        f1 = len(mb.faces)
        rr = [ring((x0, 0.022, z), (0, 0, 1), prof(8, 0.06, 0.062, 0.058, p=2.6), {'foot.' + s: 0.75, 'shin.' + s: 0.25}) for z in (0.19, 0.228)]
        mb.loft(rr, cuff, name='skatecuff')
        shoe_rings(mb, J, W, s, [(0.08, 0.044, 0.042, zb - 0.016, zb + 0.008), (0.0, 0.05, 0.047, zb - 0.016, zb + 0.008),
                                 (-0.16, 0.052, 0.05, zb - 0.016, zb + 0.008), (-0.236, 0.032, 0.03, zb - 0.012, zb + 0.01)],
                   frame, p=4, rigid=True, name='skateplate')
        for y in (0.045, -0.155):
            # truck
            box(mb, (x0, y, zb - 0.026), (1, 0, 0), (0, -1, 0), (0, 0, 1), 0.05, 0.014, 0.012, frame, w, bevel=0.005, name='truck')
            for xo in (-0.052, 0.052):
                rr = []
                for xx in (-0.018, 0.018):
                    rr.append(ring((x0 + xo + xx, y, r), (1, 0, 0), prof(8, r, r, r, p=2.0, start=0.0), w, fwd=(0, -1, 0), lat=(0, 0, 1)))
                mb.loft(rr, wheel, name='wheel')
        # toe stop
        rr = [ring((x0, -0.232, z), (0, 0, 1), prof(6, 0.022, 0.022, 0.022), w) for z in (0.012, 0.07)]
        mb.loft(rr, cuff, name='toestop')
        return f0, f1
    raise ValueError(kind)


# ---- clothing lofts ------------------------------------------------------------------

def build_sleeve(mb, J, W, s, rings, mat, n=8, matfn=None, hand=0.0, name='sleeve', flat=False, tag=None, angles=None):
    """rings: (t, r_up, r_fwd, r_back, r_down) with t = metres along the arm from the
    shoulder joint (negative = inside the torso)."""
    d = J['arm_dir.' + s]
    sx = 1 if s == 'L' else -1
    rr = []
    for t, ru, rf, rb, rd in rings:
        c = J['sh.' + s] + d * t
        rr.append(ring(c, d, prof(n, ru, rf, rb, p=2.2, rx_in=rd, angles=angles), lambda q: W.arm(s, q, hand), fwd=(0, -1, 0), lat=(sx, 0, 0)))
    return mb.loft(rr, mat, matfn=matfn, name=name, flat=flat, tag=tag)


def build_leg(mb, J, W, s, rings, mat, n=8, foot=0.0, matfn=None, name='leg', hipblend=0.5, flat=False, tag=None, angles=None):
    """rings: (z, r_out, r_in, r_fwd, r_back, xoff, yoff_fwd)."""
    sx = 1 if s == 'L' else -1
    x0 = J['hipj.' + s].x
    rr = []
    for z, ro, ri, rf, rb, xo, yo in rings:
        rr.append(ring((x0 + sx * xo, -yo, z), (0, 0, -1), prof(n, ro, rf, rb, p=2.2, rx_in=ri, angles=angles),
                       lambda q: W.leg(s, q, foot, hipblend), fwd=(0, -1, 0), lat=(sx, 0, 0)))
    return mb.loft(rr, mat, matfn=matfn, name=name, flat=flat, tag=tag)


# ---- hair / hats ---------------------------------------------------------------------

def hair_cap(mb, H, hem, thick, n=14, rows=4, mat='hair', w=None, name='hair', flat=True, top_lift=0.0,
             inner=-0.008, surf=None, tag='hair', matfn=None, jitter=None, top_z=None):
    """Hair (or hat crown) hugging the skull. hem(th) -> absolute z of the lower edge at angle
    th (degrees, 90 = front centre); thick(th, t) -> outward offset (t: 0 at hem, 1 at the top).
    Returns rows of points (outer) for attaching clumps."""
    surf = surf or H.hair_surf
    w = w or {'head': 1.0}
    angles = [90.0 + 360.0 * k / n for k in range(n)]
    z_top = top_z if top_z is not None else H.rings[-1][0]
    first = mb.begin()
    rows_idx = []
    inner_apex = mb.v(H.center, w)
    row = []
    for th in angles:
        p, nn = H.hair_surf.at(hem(th), th, inner)
        row.append(mb.v(p, w))
    rows_idx.append(row)
    outer_pts = []
    # rows are spaced by arc length over the skull (hem -> top ring -> apex) so the crown
    # stays round instead of closing in a cone
    zmap = {}
    for th in angles:
        h0 = hem(th)
        zs = [lerp(h0, z_top, i / 24.0) for i in range(25)]
        pts = [surf.at(z, th, 0.0)[0] for z in zs] + [H.apex]
        acc = [0.0]
        for i in range(1, len(pts)):
            acc.append(acc[-1] + (pts[i] - pts[i - 1]).length)
        zmap[th] = (zs, acc)

    def z_at(th, frac):
        zs, acc = zmap[th]
        target = frac * acc[-1]
        for i in range(1, len(zs)):
            if acc[i] >= target:
                k = (target - acc[i - 1]) / max(acc[i] - acc[i - 1], 1e-9)
                return lerp(zs[i - 1], zs[i], k)
        return zs[-1]
    for j in range(rows):
        t = j / (rows - 1)
        row = []
        prow = []
        for th in angles:
            z = z_at(th, j / rows * 1.04)
            off = thick(th, t)
            p, nn = surf.at(z, th, off)
            if j == rows - 1:
                p.z += top_lift * 0.6
            if jitter:
                p = p + jitter(th, t, p)
            row.append(mb.v(p, w))
            prow.append(p)
        rows_idx.append(row)
        outer_pts.append(prow)
    top = H.apex + Vector((0, 0, sum(thick(a, 1.0) for a in angles) / len(angles) * 0.95 + top_lift))
    apex = mb.v(top, w)
    # faces
    allrows = [[inner_apex]] + rows_idx + [[apex]]
    for i in range(len(allrows) - 1):
        a, b = allrows[i], allrows[i + 1]
        for k in range(n):
            k1 = (k + 1) % n
            m = matfn(i, k) if matfn else mat
            if len(a) == 1:
                mb.f([a[0], b[k1], b[k]], m, flat, tag)
            elif len(b) == 1:
                mb.f([a[k], a[k1], b[0]], m, flat, tag)
            else:
                mb.f([a[k], a[k1], b[k1], b[k]], m, flat, tag)
    mb.end(first, name)
    return outer_pts, angles, top


def cone(mb, base, tip, r, mat, w, n=4, flat=True, ry=None, mid=None, bend=None, rot=0.0, name='spike', tag='hair', up=(0, 0, 1)):
    """Closed cone (hair spike / clump). Optional mid point for a bent clump."""
    base, tip = Vector(base), Vector(tip)
    path = [base]
    if mid is not None:
        path.append(Vector(mid))
    path.append(tip)
    d = (path[1] - path[0])
    upv = Vector(up)
    if abs(d.normalized().dot(upv)) > 0.95:
        upv = Vector((0, -1, 0))
    rings = []
    for i, p in enumerate(path):
        if i == len(path) - 1:
            rings.append(pt_ring(p, w))
        else:
            dd = (path[i + 1] - p)
            rr = r if i == 0 else r * 0.62
            ry_ = (ry if ry else r) * (1.0 if i == 0 else 0.62)
            rings.append(ring(p, dd, prof(n, rr, ry_, ry_, p=2.0, start=90.0 + rot), w, fwd=upv, lat=upv.cross(dd)))
    mb.loft(rings, mat, flat=flat, name=name, tag=tag)


def blob(mb, c, rx, ry, rz, mat, w, n=8, rows=5, flat=True, lump=None, name='blob', tag='hair'):
    """Low-poly ellipsoid; lump(th, ph) -> radius multiplier (deterministic)."""
    c = Vector(c)
    rr = [pt_ring(c - Vector((0, 0, rz)), w)]
    for j in range(1, rows):
        ph = -math.pi / 2 + math.pi * j / rows
        pts = []
        for k in range(n):
            th = math.radians(90.0 + 360.0 * k / n + (180.0 / n if j % 2 else 0.0))
            m = lump(th, ph) if lump else 1.0
            pts.append((math.cos(th) * math.cos(ph) * rx * m, math.sin(th) * math.cos(ph) * ry * m))
        rr.append(ring(c + Vector((0, 0, math.sin(ph) * rz)), (0, 0, 1), pts, w))
    rr.append(pt_ring(c + Vector((0, 0, rz)), w))
    mb.loft(rr, mat, flat=flat, name=name, tag=tag)


def slab_strip(mb, inner, outer, thick, mat, w, flat=True, name='slab', tag=None):
    """Closed slab between two matching polylines (inner/outer edge), extruded by `thick`
    (a vector) — brims, collars, flaps. All quads."""
    first = mb.begin()
    thick = Vector(thick)
    m = len(inner)
    ib = [mb.v(p, w) for p in inner]
    ob_ = [mb.v(p, w) for p in outer]
    it = [mb.v(Vector(p) + thick, w) for p in inner]
    ot = [mb.v(Vector(p) + thick, w) for p in outer]
    for k in range(m - 1):
        mb.f([ib[k], ob_[k], ob_[k + 1], ib[k + 1]], mat, flat, tag)   # bottom
        mb.f([it[k], it[k + 1], ot[k + 1], ot[k]], mat, flat, tag)     # top
        mb.f([ob_[k], ot[k], ot[k + 1], ob_[k + 1]], mat, flat, tag)   # outer wall
        mb.f([ib[k], ib[k + 1], it[k + 1], it[k]], mat, flat, tag)     # inner wall
    mb.f([ib[0], it[0], ot[0], ob_[0]], mat, flat, tag)
    mb.f([ib[-1], ob_[-1], ot[-1], it[-1]], mat, flat, tag)
    mb.end(first, name)


def headphones(mb, H, top_z, side_x, ear_y, ear_z, band='gear', cup='gear', pad='accent', w=None, r=0.047, n=10):
    w = w or {'head': 1.0}
    for sx in (1, -1):
        rr = []
        for xo, rad in ((-0.014, r * 0.86), (0.004, r), (0.02, r * 0.97), (0.03, r * 0.8)):
            rr.append(ring((sx * (side_x + xo), ear_y, ear_z), (sx, 0, 0), prof(n, rad, rad, rad, p=2.2, start=0.0), w, fwd=(0, 0, 1), lat=(0, -1, 0)))
        mb.loft(rr, cup, name='cup', matfn=lambda i, k: pad if (i == 3 and k == -1) else cup)
        rr = []
        for xo, rad in ((-0.026, r * 0.72), (-0.012, r * 0.84)):
            rr.append(ring((sx * (side_x + xo), ear_y, ear_z), (sx, 0, 0), prof(n, rad, rad, rad, p=2.2, start=0.0), w, fwd=(0, 0, 1), lat=(0, -1, 0)))
        mb.loft(rr, pad if pad != 'accent' else 'gear', name='cushion')
    # band
    path = []
    m = 9
    hz = top_z + 0.014 - (ear_z + 0.035)
    for i in range(m):
        ph = math.pi * i / (m - 1)
        x = (side_x + 0.004) * math.cos(ph)
        z = ear_z + 0.035 + hz * math.sin(ph) ** 0.8
        path.append(Vector((x, ear_y + 0.004, z)))
    tube_path(mb, path, [0.0075] * m, band, w, n=6, up=(0, 1, 0), ry=[0.016] * m, name='band', start=0.0)


def neck_headphones(mb, J, W, side_x=0.11, cup='gear', pad='accent', r=0.044):
    """Headphones resting around the neck, cups on the collarbones."""
    z0 = J['neck'].z + 0.005
    w = {'chest': 0.4, 'neck': 0.6}
    for sx in (1, -1):
        c = V(sx * side_x, -0.045, z0)
        ax = V(sx * 0.35, -0.6, 0.72).normalized()
        rr = []
        for o, rad in ((-0.014, r * 0.85), (0.004, r), (0.022, r * 0.82)):
            rr.append(ring(c + ax * o, ax, prof(8, rad, rad, rad, p=2.2, start=0.0), w, fwd=(0, 0, 1), lat=(sx, 0, 0)))
        mb.loft(rr, cup, matfn=lambda i, k: pad if (i == 2 and k == -1) else cup, name='neckcup')
    path = []
    m = 7
    for i in range(m):
        ph = math.pi * i / (m - 1)
        path.append(V((side_x - 0.01) * math.cos(ph), 0.035 + 0.05 * math.sin(ph), z0 + 0.012 + 0.012 * math.sin(ph)))
    tube_path(mb, path, [0.007] * m, 'gear', w, n=4, up=(0, 0, 1), ry=[0.015] * m, name='neckband', start=45.0)


def angles_with_strips(n, strips, start=90.0):
    """Even ring angles (degrees) plus narrow strips: strips = [(centre_deg, half_width_deg)].
    Returns (angles, strip_edge_indices) where index k means the face between angle k and k+1."""
    base = [(start + 360.0 * k / n) % 360.0 for k in range(n)]
    out = []
    for a in base:
        if any(abs(((a - c + 180) % 360) - 180) < hw * 1.2 for c, hw in strips):
            continue
        out.append(a)
    for c, hw in strips:
        out += [(c - hw) % 360.0, (c + hw) % 360.0]
    out = sorted(out)
    edges = []
    for c, hw in strips:
        lo = (c - hw) % 360.0
        edges.append(out.index(lo))
    return out, edges
