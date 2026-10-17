"""Shared geometry helpers for the DRIVE FM traffic car set.

Run with Blender as a Python module (bpy 5.x).  Everything here is deterministic: no
random numbers, no dependence on scene state other than what the functions create.

Authoring conventions (see docs/ASSET-CONVENTIONS.md):
  * metres, Blender Z up, nose towards Blender -Y (game +Z), car's left = +X;
  * vehicle origin on the ground, centred between the axles and on the centre line;
  * one `body` mesh + `wheel_FL/FR/RL/RR` meshes with hub-centred origins + lamp empties;
  * materials are only labels, named exactly per the slot table.

Cars are authored in "car coordinates" (x, s, z): s is the distance back from the
nose, so side-view numbers read like a blueprint.  `Car.P` converts to Blender space.

Most surface detail (glass, lamps, grilles, plates, shut lines) is made of *projected
decals*: a convex outline is projected onto the shells already built, the covered
patch is cut out of a copy of those shells with plane bisects, then thickened into a
closed slab that sits a few millimetres proud of the paint.  This keeps every part a
closed shell for the game's inverted-hull ink outline while letting lamps and windows
wrap over creases.
"""
import math
import bpy
import bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

# --------------------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------------------
MAT_NAMES = ('paint', 'accent', 'trim', 'glass', 'metal', 'tyre', 'rim', 'headlamp',
             'taillamp', 'indicator', 'clearlens', 'reverse', 'interior', 'plate',
             'grille', 'underbody', 'detail')
MI = {n: i for i, n in enumerate(MAT_NAMES)}


def srgb(hexstr):
    """'#rrggbb' -> linear RGBA tuple (glTF baseColorFactor is linear)."""
    h = hexstr.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


BASE_COLORS = {
    'paint': '#d8d8d4', 'accent': '#2a2d33', 'trim': '#1d1e22', 'glass': '#1b2633',
    'metal': '#c9cdd2', 'tyre': '#1b1b1c', 'rim': '#aeb2b8', 'headlamp': '#e9eef2',
    'taillamp': '#b3141c', 'indicator': '#f08a12', 'clearlens': '#d9dee4',
    'reverse': '#f4f4f2', 'interior': '#2b2b30', 'plate': '#f1f1ea', 'grille': '#121315',
    'underbody': '#161618', 'detail': '#ffffff',
}


def make_materials(colors):
    """Create (or refresh) one material per slot name; returns {name: Material}."""
    mats = {}
    for n in MAT_NAMES:
        m = bpy.data.materials.get(n) or bpy.data.materials.new(n)
        col = srgb(colors.get(n, BASE_COLORS[n]))
        m.diffuse_color = col
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Base Color'].default_value = col
            bsdf.inputs['Roughness'].default_value = 0.35 if n in ('paint', 'accent', 'glass', 'metal') else 0.7
            bsdf.inputs['Metallic'].default_value = 1.0 if n == 'metal' else 0.0
        mats[n] = m
    return mats


# --------------------------------------------------------------------------------------
# small vector helpers
# --------------------------------------------------------------------------------------
def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def arc_pts(cx, cy, r, a0, a1, n):
    """n+1 points on a circular arc (degrees), including both ends."""
    return [(cx + r * math.cos(math.radians(lerp(a0, a1, i / n))),
             cy + r * math.sin(math.radians(lerp(a0, a1, i / n)))) for i in range(n + 1)]


def rounded_rect(u0, v0, u1, v1, r, seg=2):
    """Convex rounded rectangle (counter-clockwise) in 2D."""
    r = min(r, abs(u1 - u0) / 2 - 1e-4, abs(v1 - v0) / 2 - 1e-4)
    if r <= 1e-4:
        return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    pts = []
    pts += arc_pts(u1 - r, v0 + r, r, -90, 0, seg)
    pts += arc_pts(u1 - r, v1 - r, r, 0, 90, seg)
    pts += arc_pts(u0 + r, v1 - r, r, 90, 180, seg)
    pts += arc_pts(u0 + r, v0 + r, r, 180, 270, seg)
    return pts


def ellipse(cu, cv, ru, rv, n=10, rot=0.0):
    """Convex ellipse outline (CCW), optionally rotated by rot radians."""
    c, s_ = math.cos(rot), math.sin(rot)
    out = []
    for k in range(n):
        a = 2 * math.pi * k / n
        u, v = ru * math.cos(a), rv * math.sin(a)
        out.append((cu + u * c - v * s_, cv + u * s_ + v * c))
    return out


def round_poly(pts, radius, seg=2):
    """Fillet every corner of a convex polygon (list of (u, v)).  radius may be a list."""
    n = len(pts)
    out = []
    for i in range(n):
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        p = Vector(pts[i])
        a = Vector(pts[i - 1])
        b = Vector(pts[(i + 1) % n])
        if r <= 1e-5:
            out.append(tuple(p))
            continue
        da = (a - p)
        db = (b - p)
        la, lb = da.length, db.length
        da.normalize()
        db.normalize()
        ang = math.acos(max(-1.0, min(1.0, da.dot(db))))
        if ang < 1e-3 or ang > math.pi - 1e-3:
            out.append(tuple(p))
            continue
        t = r / math.tan(ang / 2)
        t = min(t, la * 0.45, lb * 0.45)
        p0 = p + da * t
        p1 = p + db * t
        # quadratic-ish fillet: sample a circular arc tangent at p0 and p1
        bis = (da + db).normalized()
        rr = t * math.tan(ang / 2)
        c = p + bis * math.sqrt(t * t + rr * rr)
        v0 = p0 - c
        v1 = p1 - c
        a0 = math.atan2(v0.y, v0.x)
        a1 = math.atan2(v1.y, v1.x)
        d = a1 - a0
        while d > math.pi:
            d -= 2 * math.pi
        while d < -math.pi:
            d += 2 * math.pi
        for k in range(seg + 1):
            aa = a0 + d * k / seg
            out.append((c.x + rr * math.cos(aa), c.y + rr * math.sin(aa)))
    return out


def offset_convex(pts, d):
    """Offset a convex CCW polygon inward by d (negative grows it).  d may be a list,
    one distance per edge (edge i runs from pts[i] to pts[i+1])."""
    n = len(pts)
    lines = []
    for i in range(n):
        a = Vector(pts[i])
        b = Vector(pts[(i + 1) % n])
        e = (b - a).normalized()
        nrm = Vector((-e.y, e.x))  # inward for CCW
        di = d[i] if isinstance(d, (list, tuple)) else d
        lines.append((a + nrm * di, e))
    out = []
    for i in range(n):
        p1, e1 = lines[i - 1]
        p2, e2 = lines[i]
        den = e1.x * e2.y - e1.y * e2.x
        if abs(den) < 1e-9:
            out.append(tuple(p2))
            continue
        t = ((p2.x - p1.x) * e2.y - (p2.y - p1.y) * e2.x) / den
        q = p1 + e1 * t
        out.append((q.x, q.y))
    return out


def poly_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return a / 2


def ccw(pts):
    return list(pts) if poly_area(pts) > 0 else list(reversed(pts))


# --------------------------------------------------------------------------------------
# bmesh building blocks
# --------------------------------------------------------------------------------------
def set_mat(f, m):
    f.material_index = MI[m]


def bm_append(dst, src, matrix=None):
    """Copy all faces of src into dst (optionally transformed).  Handles mirroring."""
    flip = matrix is not None and matrix.determinant() < 0
    uv_s = src.loops.layers.uv.active
    uv_d = dst.loops.layers.uv.active
    if uv_s is not None and uv_d is None:
        uv_d = dst.loops.layers.uv.new('UVMap')
    vmap = {}
    for v in src.verts:
        vmap[v] = dst.verts.new(matrix @ v.co if matrix is not None else v.co.copy())
    for f in src.faces:
        loops = list(f.loops)
        if flip:
            loops.reverse()
        try:
            nf = dst.faces.new([vmap[l.vert] for l in loops])
        except ValueError:
            continue
        nf.material_index = f.material_index
        nf.smooth = f.smooth
        if uv_s is not None:
            for ln, lo in zip(nf.loops, loops):
                ln[uv_d].uv = lo[uv_s].uv
    return dst


def fix_normals(bm):
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.normal_update()


def mirror_x(bm):
    out = bmesh.new()
    bm_append(out, bm, Matrix.Scale(-1, 4, (1, 0, 0)))
    return out


def loft(bm, rings, mat='paint', seg_mats=None, caps=(True, True), cap_mats=None,
         poke=(False, False), closed=True, wrap=False):
    """Connect consecutive rings (lists of 3D points, equal length) with quads.

    seg_mats: None, a list (per ring segment j) or a callable (i, j) -> material name.
    caps: close the first / last ring with an n-gon (poke=True fans it from its centre,
    for non-planar rings).  wrap: also connect the last ring back to the first (torus).
    """
    vs = [[bm.verts.new(Vector(p)) for p in r] for r in rings]
    n = len(rings[0])
    nr = len(rings)
    faces = []
    span = nr if wrap else nr - 1
    for i in range(span):
        i2 = (i + 1) % nr
        for j in range(n if closed else n - 1):
            j2 = (j + 1) % n
            q = [vs[i][j], vs[i][j2], vs[i2][j2], vs[i2][j]]
            # drop exact duplicates (collapsed corners) to keep faces valid
            uq = []
            for v in q:
                if not uq or (uq[-1].co - v.co).length > 1e-7:
                    uq.append(v)
            if len(uq) > 1 and (uq[0].co - uq[-1].co).length <= 1e-7:
                uq.pop()
            if len(uq) < 3:
                continue
            try:
                f = bm.faces.new(uq)
            except ValueError:
                continue
            if callable(seg_mats):
                m = seg_mats(i, j)
            elif seg_mats:
                m = seg_mats[j]
            else:
                m = mat
            set_mat(f, m)
            faces.append(f)
    if not wrap and closed:
        for k, idx in ((0, 0), (1, nr - 1)):
            if not caps[k]:
                continue
            ring = vs[idx]
            try:
                f = bm.faces.new(ring)
            except ValueError:
                continue
            set_mat(f, cap_mats[k] if cap_mats else mat)
            if poke[k]:
                bmesh.ops.poke(bm, faces=[f])
    return vs


def part_loft(rings, **kw):
    bm = bmesh.new()
    loft(bm, rings, **kw)
    fix_normals(bm)
    return bm


def sweep_rings(path, section, centre, z_scale=None):
    """Rings for sweeping a closed 2D `section` (n, z) along a plan `path` [(x, y)].

    n is the offset along the path's outward normal (pointing away from `centre`).
    Corners are mitred so the section keeps its thickness.
    """
    P = [Vector(p) for p in path]
    C = Vector(centre)
    rings = []
    m = len(P)
    seg_n = []
    for i in range(m - 1):
        t = (P[i + 1] - P[i]).normalized()
        nn = Vector((-t.y, t.x))
        mid = (P[i] + P[i + 1]) / 2
        if nn.dot(mid - C) < 0:
            nn = -nn
        seg_n.append(nn)
    for i in range(m):
        if i == 0:
            nn = seg_n[0]
            sc = 1.0
        elif i == m - 1:
            nn = seg_n[-1]
            sc = 1.0
        else:
            nn = (seg_n[i - 1] + seg_n[i]).normalized()
            sc = 1.0 / max(0.5, nn.dot(seg_n[i]))
        ring = []
        for (n, z) in section:
            q = P[i] + nn * (n * sc)
            ring.append((q.x, q.y, z))
        rings.append(ring)
    return rings


def lathe_rings(prof, segs, phase=0.0):
    """Rings around the X axis for each (r, x) profile point."""
    rings = []
    for (r, x) in prof:
        ring = []
        for k in range(segs):
            a = 2 * math.pi * (k + phase) / segs
            ring.append((x, r * math.cos(a), r * math.sin(a)))
        rings.append(ring)
    return rings


def box_rings(x0, x1, y0, y1, z0, z1):
    return [[(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)],
            [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)]]


def part_box(x0, x1, y0, y1, z0, z1, mat):
    return part_loft(box_rings(x0, x1, y0, y1, z0, z1), mat=mat)


def part_cprism(poly_yz, x0, x1, c, mat, cmat=None, seg_mats=None):
    """Prism along X of a convex side-view polygon [(y, z)], edges chamfered by c."""
    poly = ccw(poly_yz)
    inner = offset_convex(poly, c) if c > 0 else poly
    rings = []
    if c > 0:
        rings.append([(x0, y, z) for (y, z) in inner])
        rings.append([(x0 + c, y, z) for (y, z) in poly])
        rings.append([(x1 - c, y, z) for (y, z) in poly])
        rings.append([(x1, y, z) for (y, z) in inner])
    else:
        rings.append([(x0, y, z) for (y, z) in poly])
        rings.append([(x1, y, z) for (y, z) in poly])
    return part_loft(rings, mat=mat, seg_mats=seg_mats, cap_mats=(cmat or mat, cmat or mat))


def part_beam(a, b, w, h, up, mat, taper=1.0):
    """Rectangular bar from point a to b; w across, h along `up` (closed shell)."""
    a = Vector(a)
    b = Vector(b)
    d = (b - a).normalized()
    u = Vector(up)
    side = d.cross(u).normalized()
    u = side.cross(d).normalized()
    def ring(p, s):
        return [tuple(p + side * (-w / 2 * s) + u * (-h / 2 * s)), tuple(p + side * (w / 2 * s) + u * (-h / 2 * s)),
                tuple(p + side * (w / 2 * s) + u * (h / 2 * s)), tuple(p + side * (-w / 2 * s) + u * (h / 2 * s))]
    return part_loft([ring(a, 1.0), ring(b, taper)], mat=mat)


def part_cyl(c, axis, r, length, segs, mat, cap_mat=None, r2=None):
    """Closed cylinder (or cone frustum) centred at c along unit axis."""
    c = Vector(c)
    ax = Vector(axis).normalized()
    ref = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))
    u = ax.cross(ref).normalized()
    v = ax.cross(u).normalized()
    r2 = r if r2 is None else r2
    rings = []
    for (rr, t) in ((r, -length / 2), (r2, length / 2)):
        rings.append([tuple(c + ax * t + (u * math.cos(2 * math.pi * k / segs) + v * math.sin(2 * math.pi * k / segs)) * rr)
                      for k in range(segs)])
    return part_loft(rings, mat=mat, cap_mats=(cap_mat or mat, cap_mat or mat))


def transform(bm, matrix):
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts[:])
    return bm


def boolean(bm, cutter, op='DIFFERENCE', solver='EXACT'):
    """Boolean between two closed bmeshes via a temporary modifier; returns a new bmesh."""
    mats = [bpy.data.materials.get(n) or bpy.data.materials.new(n) for n in MAT_NAMES]
    me_a = bpy.data.meshes.new('_bool_a')
    bm.to_mesh(me_a)
    me_b = bpy.data.meshes.new('_bool_b')
    cutter.to_mesh(me_b)
    for me in (me_a, me_b):
        for m in mats:
            me.materials.append(m)
    ob_a = bpy.data.objects.new('_bool_a', me_a)
    ob_b = bpy.data.objects.new('_bool_b', me_b)
    scn = bpy.context.scene
    scn.collection.objects.link(ob_a)
    scn.collection.objects.link(ob_b)
    mod = ob_a.modifiers.new('bool', 'BOOLEAN')
    mod.operation = op
    mod.object = ob_b
    mod.solver = solver
    mod.material_mode = 'INDEX'
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob_a.evaluated_get(dg)
    me_r = ev.to_mesh()
    out = bmesh.new()
    out.from_mesh(me_r)
    ev.to_mesh_clear()
    for ob in (ob_a, ob_b):
        bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me_a)
    bpy.data.meshes.remove(me_b)
    fix_normals(out)
    return out


# --------------------------------------------------------------------------------------
# projected decals
# --------------------------------------------------------------------------------------
class Target:
    """Accumulates the shells decals may be projected onto."""

    def __init__(self):
        self.bm = bmesh.new()
        self._bvh = None

    def add(self, bm, matrix=None):
        bm_append(self.bm, bm, matrix)
        self._bvh = None

    @property
    def bvh(self):
        if self._bvh is None:
            self.bm.normal_update()
            self._bvh = BVHTree.FromBMesh(self.bm)
        return self._bvh


def _patch(target, poly, D):
    """Faces of `target` inside the prism of convex `poly` (3D pts) along D, front-most only."""
    bm = target.bm.copy()
    c = sum(poly, Vector()) / len(poly)
    n = len(poly)
    for i in range(n):
        a = poly[i]
        b = poly[(i + 1) % n]
        pn = (b - a).cross(D)
        if pn.length < 1e-9:
            continue
        pn.normalize()
        if (c - a).dot(pn) > 0:
            pn = -pn
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-7, plane_co=a, plane_no=pn, clear_outer=True)
    bm.normal_update()
    bvh = target.bvh
    dead = []
    for f in bm.faces:
        if f.calc_area() < 1e-9 or f.normal.dot(-D) < 0.03:
            dead.append(f)
            continue
        cen = f.calc_center_median()
        hit = bvh.ray_cast(cen - D * 0.015, -D)
        if hit[0] is not None:
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    return bm


def solidify_patch(patch, out, inn, mat):
    """Thicken an open surface patch into a closed slab (outer +out, inner -inn)."""
    patch.normal_update()
    res = bmesh.new()
    vn = {}
    for v in patch.verts:
        acc = Vector()
        for l in v.link_loops:
            acc += l.face.normal * l.calc_angle()
        if acc.length < 1e-9:
            acc = Vector((0, 0, 1))
        vn[v] = acc.normalized()
    vo = {v: res.verts.new(v.co + vn[v] * out) for v in patch.verts}
    vi = {v: res.verts.new(v.co - vn[v] * inn) for v in patch.verts}
    for f in patch.faces:
        try:
            set_mat(res.faces.new([vo[v] for v in f.verts]), mat)
            set_mat(res.faces.new([vi[v] for v in reversed(f.verts)]), mat)
        except ValueError:
            pass
    for e in patch.edges:
        if len(e.link_faces) != 1:
            continue
        f = e.link_faces[0]
        for l in f.loops:
            if l.edge == e:
                a, b = l.vert, l.link_loop_next.vert
                break
        try:
            set_mat(res.faces.new([vo[b], vo[a], vi[a], vi[b]]), mat)
        except ValueError:
            pass
    fix_normals(res)
    return res


def cone_patch(patch, out, inn, mat):
    """Close an open patch into a shallow pyramid: the outer face sits `out` above the
    surface and every boundary edge fans down to one apex `inn` below the patch centre
    (one apex per connected island).  Half the triangles of solidify_patch."""
    patch.normal_update()
    res = bmesh.new()
    vn = {}
    for v in patch.verts:
        acc = Vector()
        for l in v.link_loops:
            acc += l.face.normal * l.calc_angle()
        vn[v] = acc.normalized() if acc.length > 1e-9 else Vector((0, 0, 1))
    vo = {v: res.verts.new(v.co + vn[v] * out) for v in patch.verts}
    # islands
    seen = set()
    for f0 in patch.faces:
        if f0 in seen:
            continue
        island = []
        stack = [f0]
        seen.add(f0)
        while stack:
            f = stack.pop()
            island.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g not in seen:
                        seen.add(g)
                        stack.append(g)
        area = 0.0
        cen = Vector()
        nrm = Vector()
        for f in island:
            a = f.calc_area()
            area += a
            cen += f.calc_center_median() * a
            nrm += f.normal * a
        cen /= max(area, 1e-12)
        nrm = nrm.normalized() if nrm.length > 1e-12 else Vector((0, 0, 1))
        apex = res.verts.new(cen - nrm * inn)
        fs = set(island)
        for f in island:
            try:
                set_mat(res.faces.new([vo[v] for v in f.verts]), mat)
            except ValueError:
                pass
            for l in f.loops:
                e = l.edge
                if sum(1 for g in e.link_faces if g in fs) != 1:
                    continue
                a, b = l.vert, l.link_loop_next.vert
                try:
                    set_mat(res.faces.new([vo[b], vo[a], apex]), mat)
                except ValueError:
                    pass
    fix_normals(res)
    return res


DECAL_MODE = 'cone'


def project_decal(target, pieces, D, mat, out=0.004, inn=0.02):
    """Project convex 3D outlines (list of pieces) along D onto target; returns
    (slab bmesh, centre of the outer face, average outward normal) or (None, ...)."""
    D = Vector(D).normalized()
    acc = bmesh.new()
    for poly in pieces:
        p = _patch(target, [Vector(q) for q in poly], D)
        bm_append(acc, p)
        p.free()
    if not acc.faces:
        acc.free()
        return None, None, None
    bmesh.ops.remove_doubles(acc, verts=acc.verts[:], dist=2e-5)
    # merge the coplanar fragments left by the bisects (keeps decals cheap)
    bmesh.ops.dissolve_limit(acc, angle_limit=math.radians(0.6), use_dissolve_boundaries=False,
                             verts=acc.verts[:], edges=acc.edges[:], delimit=set())
    acc.normal_update()
    area = 0.0
    cen = Vector()
    nrm = Vector()
    for f in acc.faces:
        a = f.calc_area()
        area += a
        cen += f.calc_center_median() * a
        nrm += f.normal * a
    cen /= max(area, 1e-9)
    nrm.normalize()
    if DECAL_MODE == 'cone':
        slab = cone_patch(acc, out, inn, mat)
    else:
        slab = solidify_patch(acc, out, inn, mat)
    acc.free()
    return slab, cen + nrm * out, nrm


def plane_frame(D, up_hint=(0, 0, 1)):
    """Orthonormal (U, V) spanning the plane perpendicular to D."""
    D = Vector(D).normalized()
    up = Vector(up_hint)
    if abs(up.dot(D)) > 0.95:
        up = Vector((0, 1, 0))
    U = up.cross(D).normalized()
    V = D.cross(U).normalized()
    return U, V


# --------------------------------------------------------------------------------------
# wheels
# --------------------------------------------------------------------------------------
def tyre_profile(R, w, rim_r):
    """Closed (r, x) section of a tyre; +x is the outer (visible) side."""
    sw = rim_r + (R - rim_r) * 0.55
    # the inner (hidden) side gets one point fewer than the visible side
    return [(rim_r - 0.010, -w * 0.42), (sw, -w * 0.50), (R - 0.012, -w * 0.42),
            (R, w * 0.36), (R - 0.022, w * 0.47), (sw, w * 0.50), (rim_r - 0.010, w * 0.42)]


def make_wheel(R, w, rim_r, style='cover', segs=16, dual=False):
    """Wheel mesh centred on the hub, axle along X, visible face towards +X.

    styles: 'cover' (full plastic wheel cover with vent slots), 'steel' (painted steel
    wheel, vent holes, small cap), 'alloy5' / 'alloy6' (spoked alloy), 'truck' (deep
    dish truck wheel with protruding hub), 'truck_rear' (rear dual, recessed hub).
    """
    bm = bmesh.new()
    tyre_x = [0.0]
    if dual:
        tyre_x = [w * 0.53, -w * 0.53]
    for tx in tyre_x:
        prof = [(r, x + tx) for (r, x) in tyre_profile(R, w, rim_r)]
        loft(bm, lathe_rings(prof, segs, 0.0), mat='tyre', wrap=True)
    fx = tyre_x[0] + w * 0.40  # x of the rim lip on the visible side
    bx = tyre_x[-1] - w * 0.40
    r = rim_r
    if style == 'cover':
        prof = [(r * 0.30, bx), (r + 0.006, bx + 0.01), (r + 0.006, fx), (r * 0.86, fx + 0.020),
                (r * 0.68, fx + 0.015), (r * 0.42, fx + 0.024), (r * 0.18, fx + 0.034)]
        def sm(i, j):
            if i == 4:   # vent slot band
                return 'grille' if j % 2 == 0 else 'rim'
            return 'rim'
        loft(bm, lathe_rings(prof, segs), seg_mats=sm, cap_mats=('rim', 'metal'))
    elif style == 'steel':
        prof = [(r * 0.30, bx), (r + 0.004, bx + 0.01), (r + 0.006, fx), (r - 0.014, fx - 0.004),
                (r * 0.80, fx - 0.030), (r * 0.66, fx - 0.032), (r * 0.50, fx - 0.026), (r * 0.40, fx - 0.012),
                (r * 0.24, fx - 0.004), (r * 0.15, fx + 0.006)]
        def sm(i, j):
            if i == 4:   # vent holes: 4 of them over 16 segments (two segs wide)
                return 'grille' if (j % 4) in (1, 2) else 'rim'
            if i >= 7:
                return 'metal'
            return 'rim'
        loft(bm, lathe_rings(prof, segs), seg_mats=sm, cap_mats=('rim', 'metal'))
    elif style in ('truck', 'truck_rear'):
        rec = -0.045 if style == 'truck_rear' else -0.02
        prof = [(r * 0.30, bx), (r + 0.004, bx + 0.01), (r + 0.006, fx), (r - 0.014, fx - 0.006),
                (r * 0.78, fx + rec - 0.01), (r * 0.62, fx + rec - 0.012), (r * 0.50, fx + rec - 0.006),
                (r * 0.40, fx + rec + 0.004), (r * 0.30, fx + rec + 0.03 if style == 'truck' else fx + rec + 0.012),
                (r * 0.20, fx + rec + 0.05 if style == 'truck' else fx + rec + 0.02)]
        def sm(i, j):
            if i == 4:
                return 'grille' if (j % 4) in (1, 2) else 'rim'
            if i >= 7:
                return 'metal'
            return 'rim'
        loft(bm, lathe_rings(prof, segs), seg_mats=sm, cap_mats=('rim', 'metal'))
    else:  # alloys
        nsp = 6 if style == 'alloy6' else 5
        prof = [(r * 0.30, bx), (r + 0.004, bx + 0.01), (r + 0.006, fx), (r - 0.010, fx + 0.006),
                (r - 0.022, fx - 0.004), (r * 0.86, fx - 0.035), (r * 0.30, fx - 0.045)]
        def sm(i, j):
            if i >= 4:
                return 'grille'
            return 'rim'
        loft(bm, lathe_rings(prof, segs), seg_mats=sm, cap_mats=('rim', 'grille'))
        # spokes (tapered bars) and hub
        for k in range(nsp):
            a = 2 * math.pi * (k + 0.25) / nsp
            d = Vector((0, math.cos(a), math.sin(a)))
            p0 = Vector((fx - 0.012, 0, 0)) + d * (r * 0.26)
            p1 = Vector((fx - 0.030, 0, 0)) + d * (r * 0.93)
            sp = part_beam(p0, p1, r * 0.26, 0.026, (1, 0, 0), 'rim', taper=0.62)
            bm_append(bm, sp)
            sp.free()
        hub = part_cyl((fx - 0.012, 0, 0), (1, 0, 0), r * 0.30, 0.04, 10, 'rim', cap_mat='metal', r2=r * 0.24)
        bm_append(bm, hub)
        hub.free()
    fix_normals(bm)
    for f in bm.faces:
        f.smooth = True
    return bm


# --------------------------------------------------------------------------------------
# the car
# --------------------------------------------------------------------------------------
class Car:
    """Accumulates the body of one vehicle in car coordinates (x, s, z)."""

    def __init__(self, name, wheelbase, s_front_axle, wheel_r, track_f, track_r=None,
                 tyre_w=0.155, rim_r=None, wheel_style='cover', rear_dual=False,
                 colors=None):
        self.name = name
        self.wb = wheelbase
        self.s_fa = s_front_axle
        self.s_ra = s_front_axle + wheelbase
        self.s_mid = s_front_axle + wheelbase / 2
        self.wheel_r = wheel_r
        self.track_f = track_f
        self.track_r = track_r or track_f
        self.tyre_w = tyre_w
        self.rim_r = rim_r or wheel_r * 0.58
        self.wheel_style = wheel_style
        self.rear_style = wheel_style
        self.rear_dual = rear_dual
        self.colors = dict(colors or {})
        self.body = bmesh.new()
        self.target = Target()
        self.lamps = {}
        self.parts = []
        self.notes = []

    # -- coordinates --------------------------------------------------------------------
    def P(self, x, s, z):
        return Vector((x, s - self.s_mid, z))

    @property
    def M(self):
        """Matrix taking car coords (x, s, z) to Blender space."""
        return Matrix.Translation((0, -self.s_mid, 0))

    # -- adding geometry ----------------------------------------------------------------
    def add(self, bm, target=False, mirror=False, car_space=True):
        """Add a part built in car coordinates (s along +Y).  mirror=True adds the X mirror too."""
        if target:
            # decals are cut from these exact triangles, so body and decal agree everywhere
            bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')
        mats = [self.M if car_space else Matrix.Identity(4)]
        if mirror:
            mats.append(mats[0] @ Matrix.Scale(-1, 4, (1, 0, 0)))
        for m in mats:
            bm_append(self.body, bm, m)
            if target:
                self.target.add(bm, m)
        return bm

    def loft(self, rings, target=False, mirror=False, **kw):
        bm = part_loft(rings, **kw)
        self.add(bm, target=target, mirror=mirror)
        return bm

    # -- decals ---------------------------------------------------------------------------
    def decal(self, pts3d, D, mat, out=0.004, inn=0.02, mirror=False, lamp=None, pieces=None):
        """Project a convex outline given in car coords (x, s, z) along direction D (car
        coords).  mirror=True also does the X-mirrored copy.  lamp=('head', 'L') records
        the lens centre as a lamp empty (the mirror gets the other side)."""
        variants = [(1, pts3d, D, pieces)]
        if mirror:
            mp = [(-p[0], p[1], p[2]) for p in pts3d] if pts3d else None
            mpieces = [[(-p[0], p[1], p[2]) for p in pc] for pc in pieces] if pieces else None
            variants.append((-1, list(reversed(mp)) if mp else None, (-D[0], D[1], D[2]),
                             [list(reversed(pc)) for pc in mpieces] if mpieces else None))
        res = None
        for sgn, pts, d, pcs in variants:
            pcs_w = [[self.P(*p) for p in pc] for pc in (pcs if pcs else [pts])]
            slab, cen, nrm = project_decal(self.target, pcs_w, Vector(d), mat, out=out, inn=inn)
            if slab is None:
                self.notes.append('decal %s missed the target at %s D=%s' % (mat, tuple(round(v, 2) for v in pcs_w[0][0]), tuple(round(v, 2) for v in d)))
                continue
            bm_append(self.body, slab)
            slab.free()
            if lamp:
                kind, side = lamp
                if sgn < 0:
                    side = {'L': 'R', 'R': 'L'}.get(side, side)
                self.lamps['lamp_%s_%s' % (kind, side)] = cen
            res = cen
        return res

    def surface_poly(self, corners, D, mat, inset=0.0, radius=0.0, seg=2, out=0.004, inn=0.02,
                     mirror=False, lamp=None):
        """Decal from 3D corner points (car coords, convex, roughly on the surface): the
        outline is flattened onto the plane perpendicular to D, inset per edge (scalar or
        list), filleted, then projected along D."""
        D = Vector(D).normalized()
        U, V = plane_frame(D)
        C = sum((Vector(c) for c in corners), Vector()) / len(corners)
        uv = [((Vector(c) - C).dot(U), (Vector(c) - C).dot(V)) for c in corners]
        if poly_area(uv) < 0:
            n = len(uv)
            uv = list(reversed(uv))
            if isinstance(inset, (list, tuple)):
                # edge k of the reversed outline is old edge n-2-k
                inset = [inset[(n - 2 - k) % n] for k in range(n)]
        if inset:
            uv = offset_convex(uv, inset)
        if radius:
            uv = round_poly(uv, radius, seg)
        pts = [tuple(C + U * u + V * v - D * 0.5) for (u, v) in uv]
        return self.decal(pts, D, mat, out, inn, mirror=mirror, lamp=lamp)

    def side_decal(self, poly_sz, mat, x=2.0, out=0.004, inn=0.02, mirror=True, lamp=None):
        """Decal from a side-view outline [(s, z)] projected from the left (+X) side."""
        pts = [(x, s, z) for (s, z) in ccw_side(poly_sz)]
        return self.decal(pts, (-1, 0, 0), mat, out, inn, mirror=mirror, lamp=lamp)

    def s_range(self):
        ys = [v.co.y for v in self.target.bm.verts]
        return min(ys) + self.s_mid, max(ys) + self.s_mid

    def front_decal(self, poly_xz, mat, out=0.004, inn=0.02, mirror=True, lamp=None, s=None, tilt=0.0):
        """Decal from a front-view outline [(x, z)] projected rearwards (+s).
        tilt (radians) tips the projection direction downwards (for sloped faces); the
        outline's z values are where it lands at station s (default: the nose)."""
        if s is None:
            s = self.s_range()[0] + 0.08
        D = (0.0, math.cos(tilt), -math.sin(tilt))
        pts = [(x, s, z) for (x, z) in poly_xz]
        return self.decal(pts, D, mat, out, inn, mirror=mirror, lamp=lamp)

    def rear_decal(self, poly_xz, mat, out=0.004, inn=0.02, mirror=True, lamp=None, s=None, tilt=0.0):
        if s is None:
            s = self.s_range()[1] - 0.08
        D = (0.0, -math.cos(tilt), -math.sin(tilt))
        pts = [(x, s, z) for (x, z) in poly_xz]
        return self.decal(pts, D, mat, out, inn, mirror=mirror, lamp=lamp)

    def top_decal(self, poly_xs, mat, out=0.004, inn=0.02, mirror=False, z=5.0):
        pts = [(x, s, z) for (x, s) in poly_xs]
        return self.decal(pts, (0, 0, -1), mat, out, inn, mirror=mirror)

    def line_decal(self, a, b, D, width, mat='trim', out=0.0018, inn=0.01, mirror=True):
        """Thin strip (shut line, moulding) between two car-space points, projected along D."""
        a = Vector(a)
        b = Vector(b)
        d = (b - a).normalized()
        side = d.cross(Vector(D)).normalized() * (width / 2)
        pts = [a - side, b - side, b + side, a + side]
        return self.decal([tuple(p) for p in pts], D, mat, out, inn, mirror=mirror)

    def ribbon(self, pts, D, width=0.008, mat='trim', out=0.002, inn=0.006, step=0.12, mirror=True):
        """Shut line / moulding: a thin closed tube that follows the surface along a
        polyline of car-space points, each projected along D onto the target.  Much
        cheaper than a projected decal for long thin lines (8 tris per sample)."""
        D = Vector(D).normalized()
        variants = [(pts, D)]
        if mirror:
            variants.append(([(-p[0], p[1], p[2]) for p in pts], Vector((-D.x, D.y, D.z))))
        def cast(q, dd):
            h, nrm = self.hit(tuple(q - dd * 0.5), dd)
            if h is not None and nrm.dot(dd) > 0:
                nrm = -nrm
            return h, nrm

        def refine(a, ha, b, hb, dd, depth, out_list):
            # adaptive: split while the surface leaves the straight chord by > tol
            m = (a + b) / 2
            hm = cast(m, dd)
            if depth < 6 and hm[0] is not None and ha[0] is not None and hb[0] is not None:
                chord = (ha[0] + hb[0]) / 2
                dev = (hm[0] - chord).length
                # dev > 4 cm means the ray fell into an opening: don't chase it
                if tol < dev < 0.04 and (hb[0] - ha[0]).length > 0.03:
                    refine(a, ha, m, hm, dd, depth + 1, out_list)
                    out_list.append(hm)
                    refine(m, hm, b, hb, dd, depth + 1, out_list)

        tol = min(out, inn) * 0.6
        for pp, dd in variants:
            hits = []
            P = [Vector(p) for p in pp]
            H = [cast(q, dd) for q in P]
            for i in range(len(P)):
                hits.append(H[i])
                if i < len(P) - 1:
                    refine(P[i], H[i], P[i + 1], H[i + 1], dd, 0, hits)
            hits = [h for h in hits if h[0] is not None]
            if len(hits) < 2:
                self.notes.append('ribbon missed the target')
                continue
            rings = []
            for k, (h, nrm) in enumerate(hits):
                a = hits[max(0, k - 1)][0]
                b = hits[min(len(hits) - 1, k + 1)][0]
                t = (b - a).normalized()
                side = t.cross(nrm).normalized() * (width / 2)
                if k == 0:
                    h = h - t * (width / 2)
                elif k == len(hits) - 1:
                    h = h + t * (width / 2)
                o = nrm * out
                i_ = -nrm * inn
                rings.append([tuple(h + o - side), tuple(h + o + side), tuple(h + i_)])
            bm = part_loft(rings, mat=mat)
            self.add(bm)

    def side_line(self, pts_sz, width=0.008, mat='trim', out=0.002, x=2.0, mirror=True):
        """Shut line on the left flank from side-view points [(s, z)] (mirrored to the right)."""
        self.ribbon([(x, s, z) for (s, z) in pts_sz], (-1, 0, 0), width, mat, out=out, mirror=mirror)

    def top_line(self, pts_xs, width=0.008, mat='trim', out=0.002, z=5.0, mirror=True):
        self.ribbon([(x, s, z) for (x, s) in pts_xs], (0, 0, -1), width, mat, out=out, mirror=mirror)

    def rear_line(self, pts_xz, width=0.008, mat='trim', out=0.002, s=None, mirror=True):
        s = self.s_range()[1] + 0.3 if s is None else s
        self.ribbon([(x, s, z) for (x, z) in pts_xz], (0, -1, 0), width, mat, out=out, mirror=mirror)

    def front_line(self, pts_xz, width=0.008, mat='trim', out=0.002, s=None, mirror=True):
        s = self.s_range()[0] - 0.3 if s is None else s
        self.ribbon([(x, s, z) for (x, z) in pts_xz], (0, 1, 0), width, mat, out=out, mirror=mirror)

    def hit(self, p, D):
        """Ray-cast from car-space point p along D onto the target; returns (point, normal)
        in car coords or (None, None)."""
        loc, nrm, idx, dist = self.target.bvh.ray_cast(self.P(*p), Vector(D).normalized())
        if loc is None:
            return None, None
        return Vector((loc.x, loc.y + self.s_mid, loc.z)), Vector(nrm)

    # -- arches -------------------------------------------------------------------------
    def cut_arches(self, bm, r_arch, z_c=None, depth=0.36, extra=None):
        """Boolean wheel wells (cylinders along X) out of a car-space shell; returns new bm."""
        z_c = self.wheel_r + 0.01 if z_c is None else z_c
        cutter = bmesh.new()
        hwmax = max(abs(v.co.x) for v in bm.verts) + 0.1
        for s_ax, tr in ((self.s_fa, self.track_f), (self.s_ra, self.track_r)):
            for sgn in (1, -1):
                x_in = tr / 2 - depth / 2 - 0.02
                x0, x1 = (x_in, hwmax) if sgn > 0 else (-hwmax, -x_in)
                c = part_cyl(((x0 + x1) / 2, s_ax, z_c), (1, 0, 0), r_arch, x1 - x0, 20, 'underbody')
                bm_append(cutter, c)
                c.free()
        if extra:
            bm_append(cutter, extra)
        out = boolean(bm, cutter)
        cutter.free()
        return out

    # -- finishing ------------------------------------------------------------------------
    def build_objects(self, smooth_angle=32.0):
        """Create Blender objects: body, wheels, lamp empties. Returns list of objects."""
        mats = make_materials(self.colors)
        objs = []
        body = self.body
        fix_normals(body)
        bmesh.ops.triangulate(body, faces=body.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')
        me = bpy.data.meshes.new('body')
        body.to_mesh(me)
        used = sorted({p.material_index for p in me.polygons})
        remap = {mi: k for k, mi in enumerate(used)}
        for mi in used:
            me.materials.append(mats[MAT_NAMES[mi]])
        for p in me.polygons:
            p.material_index = remap[p.material_index]
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(smooth_angle))
        ob = bpy.data.objects.new('body', me)
        bpy.context.scene.collection.objects.link(ob)
        objs.append(ob)
        # wheels
        for key, s_ax, tr, style, dual in (('F', self.s_fa, self.track_f, self.wheel_style, False),
                                           ('R', self.s_ra, self.track_r, self.rear_style, self.rear_dual)):
            wbm = make_wheel(self.wheel_r, self.tyre_w, self.rim_r, style=style, dual=dual)
            for side, sgn in (('L', 1), ('R', -1)):
                nm = 'wheel_%s%s' % (key, side)
                w = bmesh.new()
                bm_append(w, wbm, Matrix.Scale(sgn, 4, (1, 0, 0)))
                fix_normals(w)
                bmesh.ops.triangulate(w, faces=w.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')
                wme = bpy.data.meshes.new(nm)
                w.to_mesh(wme)
                w.free()
                used = sorted({p.material_index for p in wme.polygons})
                remap = {mi: k for k, mi in enumerate(used)}
                for mi in used:
                    wme.materials.append(mats[MAT_NAMES[mi]])
                for p in wme.polygons:
                    p.material_index = remap[p.material_index]
                wme.shade_smooth()
                wme.set_sharp_from_angle(angle=math.radians(smooth_angle))
                wob = bpy.data.objects.new(nm, wme)
                wob.location = self.P(sgn * tr / 2, s_ax, self.wheel_r)
                bpy.context.scene.collection.objects.link(wob)
                objs.append(wob)
            wbm.free()
        # lamp empties (top-level nodes, like the hero car)
        for nm in sorted(self.lamps):
            e = bpy.data.objects.new(nm, None)
            e.empty_display_type = 'PLAIN_AXES'
            e.empty_display_size = 0.08
            e.location = self.lamps[nm]
            bpy.context.scene.collection.objects.link(e)
            objs.append(e)
        return objs


def ccw_side(poly):
    """Order a side-view outline so it is CCW seen from +X (s right? no: s is +Y)."""
    return list(poly)


# --------------------------------------------------------------------------------------
# scene / export / measurement
# --------------------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for x in list(coll):
            coll.remove(x)


def export_glb(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True,
        export_apply=True, export_texcoords=False, export_normals=True,
        export_materials='EXPORT', export_cameras=False, export_lights=False,
        export_extras=False, export_animations=False, export_skins=False,
        export_morph=False)


def measure(objs):
    body = next(o for o in objs if o.name == 'body')
    wheels = {o.name: o for o in objs if o.name.startswith('wheel_')}
    xs, ys, zs = [], [], []
    tris = 0
    for o in objs:
        if o.type != 'MESH':
            continue
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            xs.append(w.x)
            ys.append(w.y)
            zs.append(w.z)
    # width without mirrors: body verts below 0.6 m or the widest wheel-to-wheel
    bx = [(body.matrix_world @ v.co).x for v in body.data.vertices]
    fl = wheels['wheel_FL']
    rl = wheels['wheel_RL']
    fr = wheels['wheel_FR']
    rr = wheels['wheel_RR']
    wr = 0.0
    for v in fl.data.vertices:
        wr = max(wr, math.hypot(v.co.y, v.co.z))
    return dict(
        tris=tris,
        length=max(ys) - min(ys), width_overall=max(xs) - min(xs), height=max(zs) - min(zs),
        z_min=min(zs), wheelbase=rl.location.y - fl.location.y,
        track_f=fl.location.x - fr.location.x, track_r=rl.location.x - rr.location.x,
        wheel_r=wr, front_overhang=fl.location.y - min(ys), rear_overhang=max(ys) - rl.location.y,
        centre_y=(max(ys) + min(ys)) / 2,
    )


# --------------------------------------------------------------------------------------
# preview renders (Cycles CPU, cel-ish look with Freestyle ink).  Only for shape checks;
# the game's own previewer (tools/shoot-asset.mjs) is the reference for the real look.
# --------------------------------------------------------------------------------------
PREVIEW_PAINT = {}


def _preview_material(m, night=False):
    name = m.name.split('.')[0]
    col = list(m.diffuse_color)
    if name in PREVIEW_PAINT:
        col = list(srgb(PREVIEW_PAINT[name]))
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    toon = nt.nodes.new('ShaderNodeBsdfToon')
    toon.component = 'DIFFUSE'
    toon.inputs['Size'].default_value = 0.62
    toon.inputs['Smooth'].default_value = 0.02
    toon.inputs['Color'].default_value = col
    em = nt.nodes.new('ShaderNodeEmission')
    amb = 0.12 if night else 0.42
    em.inputs['Color'].default_value = col
    em.inputs['Strength'].default_value = amb
    add = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(toon.outputs[0], add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    last = add
    if name in ('glass', 'paint', 'accent', 'metal'):
        gl = nt.nodes.new('ShaderNodeBsdfToon')
        gl.component = 'GLOSSY'
        gl.inputs['Size'].default_value = 0.15
        gl.inputs['Smooth'].default_value = 0.05
        g = 0.5 if name == 'glass' else 0.25
        gl.inputs['Color'].default_value = (g, g, g, 1)
        add2 = nt.nodes.new('ShaderNodeAddShader')
        nt.links.new(add.outputs[0], add2.inputs[0])
        nt.links.new(gl.outputs[0], add2.inputs[1])
        last = add2
    if night and name in ('headlamp', 'taillamp', 'reverse', 'indicator'):
        em2 = nt.nodes.new('ShaderNodeEmission')
        em2.inputs['Color'].default_value = {'headlamp': (1, 0.95, 0.85, 1), 'taillamp': (1, 0.05, 0.03, 1),
                                             'reverse': (0.3, 0.3, 0.3, 1), 'indicator': (0.4, 0.15, 0, 1)}[name]
        em2.inputs['Strength'].default_value = 6.0 if name in ('headlamp', 'taillamp') else 1.0
        last = em2
    nt.links.new(last.outputs[0], out.inputs[0])


def _setup_render(night=False, res=(640, 400), samples=24):
    import addon_utils
    addon_utils.enable('cycles', default_set=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.02, 0.025, 0.05, 1) if night else (0.55, 0.68, 0.85, 1)
    bg.inputs['Strength'].default_value = 0.25 if night else 0.55
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 0.6 if night else 3.2
    sun.data.angle = math.radians(2)
    sun.data.color = (0.6, 0.7, 1.0) if night else (1.0, 0.96, 0.9)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    sc.collection.objects.link(sun)
    # ground
    gme = bpy.data.meshes.new('ground')
    gbm = bmesh.new()
    bmesh.ops.create_grid(gbm, x_segments=1, y_segments=1, size=60)
    gbm.to_mesh(gme)
    gbm.free()
    gmat = bpy.data.materials.new('ground_preview')
    gmat.use_nodes = True
    gmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.05, 0.06, 1) if night else (0.33, 0.33, 0.34, 1)
    gmat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    gme.materials.append(gmat)
    g = bpy.data.objects.new('ground', gme)
    sc.collection.objects.link(g)
    # freestyle ink
    sc.render.use_freestyle = True
    sc.render.line_thickness_mode = 'ABSOLUTE'
    sc.render.line_thickness = 1.4
    vl = sc.view_layers[0]
    vl.use_freestyle = True
    fs = vl.freestyle_settings
    fs.crease_angle = math.radians(128)
    ls = fs.linesets[0] if fs.linesets else fs.linesets.new('ink')
    ls.select_by_visibility = True
    ls.select_by_edge_types = True
    # the game inks with an inverted hull, which only draws silhouettes: mimic that
    ls.select_silhouette = True
    ls.select_border = False
    ls.select_crease = False
    ls.select_external_contour = True
    ls.select_by_collection = True
    coll = bpy.data.collections.new('inked')
    sc.collection.children.link(coll)
    ls.collection = coll
    if ls.linestyle is None:
        ls.linestyle = bpy.data.linestyles.new('ink')
    ls.linestyle.color = (0.02, 0.02, 0.03)
    ls.linestyle.thickness = 1.4
    return sc, coll


def import_glb(path, coll=None, offset=(0, 0, 0)):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    for o in roots:
        o.location = Vector(o.location) + Vector(offset)
    if coll is not None:
        for o in new:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            coll.objects.link(o)
    return new


def _cam(sc, name, loc, target, lens=50, ortho=None):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    sc.collection.objects.link(cam)
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = ortho
    else:
        cam.data.lens = lens
    cam.data.clip_end = 300
    return cam


def render_views(glb, out_prefix, views=('side', 'front34', 'rear34'), night=False, res=(640, 400), samples=24):
    reset_scene()
    sc, coll = _setup_render(night=night, res=res, samples=samples)
    objs = import_glb(glb, coll)
    for m in bpy.data.materials:
        if m.name != 'ground_preview':
            _preview_material(m, night)
    xs = []
    ys = []
    zs = []
    for o in objs:
        if o.type == 'MESH':
            for v in o.data.vertices:
                w = o.matrix_world @ v.co
                xs.append(w.x)
                ys.append(w.y)
                zs.append(w.z)
    L = max(ys) - min(ys)
    H = max(zs)
    cy = (max(ys) + min(ys)) / 2
    tgt = Vector((0, cy, H * 0.45))
    outs = []
    for v in views:
        if v == 'side':
            cam = _cam(sc, v, (12, cy, H * 0.5), (0, cy, H * 0.5), ortho=max(L * 1.12, 5.4 * 1.0))
        elif v == 'front34':
            cam = _cam(sc, v, tgt + Vector((5.2, -7.0, 1.6)) * (max(L, 3.6) / 4.6), tgt, lens=50)
        elif v == 'rear34':
            cam = _cam(sc, v, tgt + Vector((-5.2, 7.0, 1.9)) * (max(L, 3.6) / 4.6), tgt, lens=50)
        elif v == 'front':
            cam = _cam(sc, v, (0, cy - 12, H * 0.5), (0, cy, H * 0.5), ortho=max(2.4, H * 1.15))
        elif v == 'rear':
            cam = _cam(sc, v, (0, cy + 12, H * 0.5), (0, cy, H * 0.5), ortho=max(2.4, H * 1.15))
        elif v == 'top':
            cam = _cam(sc, v, (0, cy, 20), (0, cy, 0), ortho=L * 1.1)
        elif v == 'chase':
            cam = _cam(sc, v, tgt + Vector((0.0, 6.5, 1.6)), tgt + Vector((0, -2, 0)), lens=45)
        elif v == 'low34':
            cam = _cam(sc, v, tgt + Vector((3.2, -3.6, -0.2)), tgt, lens=30)
        sc.camera = cam
        sc.render.filepath = '%s_%s%s.png' % (out_prefix, v, '_night' if night else '')
        bpy.ops.render.render(write_still=True)
        outs.append(sc.render.filepath)
    return outs


def render_lineup(glbs, out_path, night=False, view='side', res=None, samples=24, gap=0.6):
    reset_scene()
    sc, coll = _setup_render(night=night, res=res or (2400, 400), samples=samples)
    x = 0.0
    spans = []
    for k, g in enumerate(glbs):
        objs = import_glb(g, coll)
        ys = []
        for o in objs:
            if o.type == 'MESH':
                for v in o.data.vertices:
                    ys.append((o.matrix_world @ v.co).y)
        L = max(ys) - min(ys)
        c = (max(ys) + min(ys)) / 2
        if view == 'side':
            off = Vector((0, x + L / 2 - c, 0))      # nose to tail along the row
        else:
            off = Vector((k * 2.45, -c, 0))            # side by side, noses aligned-ish
        for o in objs:
            if o.parent is None:
                o.location = Vector(o.location) + off
        spans.append((x, x + L))
        x += L + gap
    total = x - gap
    for m in bpy.data.materials:
        if m.name != 'ground_preview':
            _preview_material(m, night)
    if view == 'side':
        w = total * 1.03
        sc.render.resolution_x = res[0] if res else 2400
        sc.render.resolution_y = int(sc.render.resolution_x * 3.0 / w)
        cam = _cam(sc, 'cam', (30, total / 2, 1.38), (0, total / 2, 1.38), ortho=w)
    else:
        # front three-quarter row: cars side by side along the lineup, seen from front-left
        n = len(glbs)
        xm = (n - 1) * 2.45 / 2
        sc.render.resolution_x = res[0] if res else 2400
        sc.render.resolution_y = int(sc.render.resolution_x * 0.36)
        cam = _cam(sc, 'cam', (xm + 6.5, -20.5, 6.6), (xm + 0.3, 0.0, 0.85), lens=37)
    sc.camera = cam
    sc.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    return out_path
