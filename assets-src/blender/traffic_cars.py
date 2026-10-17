"""DRIVE FM traffic car set: builds every model from scratch and exports
public/assets/cars/traffic_<name>.glb.

    /home/claude/.venv-bpy/bin/python assets-src/blender/traffic_cars.py [names...]
        [--render] [--night] [--lineup [--build]]

With no names, all eight models are built (with --lineup alone, the existing .glb files are
only re-rendered; add --build to rebuild them first).  --render writes Cycles preview renders
(side / front 3/4 / rear 3/4) to docs/renders/traffic/, --lineup the side-by-side
lineup.  Deterministic: no randomness anywhere.

Coordinates: models are authored in car coordinates (x, s, z): x to the car's left,
s = distance back from the front bumper, z up from the ground (see traffic_lib.Car).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402,F401  (must precede bmesh)
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import traffic_lib as T  # noqa: E402
from traffic_lib import Car, part_loft, part_beam, part_box, part_cyl, part_cprism, sweep_rings  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT_DIR = os.path.join(ROOT, 'public', 'assets', 'cars')
RENDER_DIR = os.path.join(ROOT, 'docs', 'renders', 'traffic')


# ======================================================================================
# shared part builders
# ======================================================================================
def lower_ring(s, hw, zb, zsl, zsh, zde, zc, tb=0.05, ts=0.02, rl=0.05, mid=0.55, crown=0.012,
               bow=0.0, lean=0.0, zsl_x=None):
    """Lower-body cross-section (car coords), 12 points:
    bottom centre, [bottom edge, sill crease, shoulder, deck edge, deck mid] x2, deck centre.
    bow: s offset of the centre line (parabolic across the width); lean: ds/dz."""
    half = [(hw - tb, zb), (hw - ts, zsl), (hw, zsh), (hw - rl, zde), ((hw - rl) * mid, zc - crown)]
    pts = [(0.0, zb)] + half + [(0.0, zc)] + [(-x, z) for (x, z) in reversed(half)]
    return [(x, s + bow * (1 - (x / hw) ** 2) + lean * (z - zb), z) for (x, z) in pts]


LOWER_UNDER = (0, 11)          # ring segments that face the ground
LOWER_SIDE = (2, 3, 8, 9)      # sill-to-belt side segments (both sides)


def gh_ring(s, hb, zbl, hr, zre, zrc, ch=0.10, chz=0.03, bow=0.0, sink=0.10, lean=0.0, zmid=None):
    """Greenhouse cross-section, 10 points: sunk bottom centre, [sunk edge, belt, roof edge,
    roof top edge] x2, roof centre.  The sunk bottom hides inside the lower body."""
    half = [(hb - 0.03, zbl - sink), (hb, zbl), (hr, zre), (hr - ch, zre + chz)]
    pts = [(0.0, zbl - sink)] + half + [(0.0, zrc)] + [(-x, z) for (x, z) in reversed(half)]
    return [(x, s + bow * (1 - (x / hb) ** 2) + lean * (z - zbl), z) for (x, z) in pts]


GH_SIDE = (2, 7)
GH_ROOF = (3, 4, 5, 6)


def plan_path(hw, s_face, corner_r, s_end, bow=0.0, rear=False, n_corner=4, n_front=6):
    """Bumper plan path [(x, s)] from the left side end, round the corner, across the
    (bowed) face and back along the right side."""
    sg = 1 if rear else -1
    # keep the side run from folding back past the corner
    r = min(corner_r, max(0.02, (s_end - s_face) * -sg - 0.02))
    cs = s_face - sg * r
    pts = [(hw, s_end)]
    for k in range(n_corner + 1):
        a = math.radians(90 * k / n_corner)
        pts.append((hw - r + r * math.cos(a), cs + sg * r * math.sin(a)))
    xf = hw - r
    for k in range(1, n_front):
        x = xf - 2 * xf * k / n_front
        pts.append((x, s_face + sg * bow * (1 - (x / xf) ** 2)))
    for k in range(n_corner + 1):
        a = math.radians(90 - 90 * k / n_corner)
        pts.append((-(hw - r + r * math.cos(a)), cs + sg * r * math.sin(a)))
    pts.append((-hw, s_end))
    return pts


def bumper(car, hw, s_face, corner_r, s_end, section, bow=0.0, rear=False, mats=None,
           mat='paint', n_corner=3, n_front=4, target=True):
    path = plan_path(hw, s_face, corner_r, s_end, bow=bow, rear=rear, n_corner=n_corner, n_front=n_front)
    rings = sweep_rings(path, section, (0.0, car.s_mid))
    bm = part_loft(rings, mat=mat, seg_mats=mats)
    car.add(bm, target=target)
    return bm


def door_mirror(car, s0, z0, x_root, reach=0.17, l=0.15, h=0.105, mat='paint', arm_mat='trim',
                sweep=0.03):
    """Door mirror on the left side (mirrored to the right): an arm from the door and a
    housing whose rear face is glass."""
    def prof(sc_l, sc_h, ds):
        sf = s0 + ds
        zc = z0
        hh = h * sc_h / 2
        ll = l * sc_l
        return [(sf, zc + hh * 0.15), (sf + 0.03 * sc_l, zc + hh), (sf + ll, zc + hh * 0.95),
                (sf + ll, zc - hh * 0.95), (sf + 0.04 * sc_l, zc - hh)]
    xs = [(x_root + 0.03, 0.70, 0.75, 0.02), (x_root + 0.06, 1.0, 1.0, 0.0),
          (x_root + reach - 0.025, 1.0, 1.0, sweep), (x_root + reach, 0.82, 0.86, sweep + 0.012)]
    rings = [[(x, s, z) for (s, z) in prof(a, b, d)] for (x, a, b, d) in xs]
    bm = part_loft(rings, mat=mat, seg_mats=lambda i, j: 'glass' if (j == 2 and i == 1) else mat,
                   cap_mats=(mat, mat))
    car.add(bm, mirror=True)
    arm = part_beam((x_root - 0.02, s0 + 0.05, z0 - h * 0.25), (x_root + 0.05, s0 + 0.07, z0 - h * 0.2),
                    0.07, 0.035, (0, 0, 1), arm_mat)
    car.add(arm, mirror=True)


def wiper(car, a, b, D, mat='trim'):
    """Wiper arm + blade lying on the glass between car-space points a and b (projected)."""
    pa, na = car.hit(a, D)
    pb, nb = car.hit(b, D)
    if pa is None or pb is None:
        car.notes.append('wiper missed glass')
        return
    n = (na + nb).normalized()
    pa = pa + n * 0.016
    pb = pb + n * 0.016
    car.add(part_beam(pa, pb, 0.022, 0.014, n, mat))
    # arm pivot boss
    car.add(part_cyl(pa - (pb - pa).normalized() * 0.01, n, 0.018, 0.03, 6, mat))


def lamp_pair(car, poly_xz, D, mat, out=0.006, lamp=None, front=True, inn=0.02):
    if front:
        return car.front_decal(poly_xz, mat, out=out, inn=inn, lamp=lamp, tilt=D)
    return car.rear_decal(poly_xz, mat, out=out, inn=inn, lamp=lamp, tilt=D)


def arch_points(sc, zc, r, a0, a1, n):
    return [(sc + r * math.cos(math.radians(a)), zc + r * math.sin(math.radians(a)))
            for a in [a0 + (a1 - a0) * k / n for k in range(n + 1)]]


def plate(car, s, zc, front=True, tilt=0.0, w=0.33, h=0.165, frame=True):
    """Japanese-size number plate (330 x 165) with a dark frame."""
    poly = T.rounded_rect(-w / 2, zc - h / 2, w / 2, zc + h / 2, 0.012, 2)
    if frame:
        fr = T.rounded_rect(-w / 2 - 0.012, zc - h / 2 - 0.012, w / 2 + 0.012, zc + h / 2 + 0.012, 0.018, 2)
        (car.front_decal if front else car.rear_decal)(fr, 'trim', out=0.004, mirror=False, tilt=tilt)
    (car.front_decal if front else car.rear_decal)(poly, 'plate', out=0.008, mirror=False, tilt=tilt)


def glass_between(car, ra, rb, inset, radius=0.05, mat='glass', out=0.004, inn=0.02):
    """Windscreen / backlight decal spanning two greenhouse rings (front-to-back order).
    Corners are the roof-edge points (index 3 / 7) of both rings; inset per edge
    [bottom-left side, top, right side, bottom] in metres; returns the projection dir."""
    a = Vector(ra[3])
    b = Vector(rb[3])
    d = b - a
    n = Vector((0, -d.z, d.y)).normalized()      # outward: forward-up or rearward-up
    corners = [ra[3], rb[3], rb[7], ra[7]]
    car.surface_poly(corners, -n, mat, inset=inset, radius=radius, out=out, inn=inn)
    return -n


def fender_arc(car, s_c, z_c, r_in, thick, x0, x1, a0=0.0, a1=180.0, n=7, mat='trim', mirror=True):
    """Curved mudguard over a wheel (side-view arc from a0 to a1 degrees, measured from
    +s towards +z), spanning x0..x1 on the left side."""
    rings = []
    for k in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * k / n)
        cs, sn = math.cos(a), math.sin(a)
        ri, ro = r_in, r_in + thick
        rings.append([(x0, s_c + ri * cs, z_c + ri * sn), (x1, s_c + ri * cs, z_c + ri * sn),
                      (x1, s_c + ro * cs, z_c + ro * sn), (x0, s_c + ro * cs, z_c + ro * sn)])
    car.add(part_loft(rings, mat=mat), mirror=mirror)


def mudflap(car, s, z0, z1, x0, x1, t=0.012, mat='trim', mirror=True):
    car.add(part_box(x0, x1, s, s + t, z0, z1, mat), mirror=mirror)


def stalk_mirror(car, root, head_c, w=0.05, h=0.30, l=0.06, mat='trim', stay_mat='metal', mirror=True):
    """Truck/van mirror on a tubular stay: stay from root to the head, glass facing rearwards."""
    hx, hs, hz = head_c
    head = part_loft([[(hx - w / 2, s_, z_) for (s_, z_) in [(hs, hz - h / 2), (hs + l, hz - h / 2 + 0.01),
                                                              (hs + l, hz + h / 2 - 0.01), (hs, hz + h / 2)]],
                      [(hx + w / 2, s_, z_) for (s_, z_) in [(hs, hz - h / 2), (hs + l, hz - h / 2 + 0.01),
                                                              (hs + l, hz + h / 2 - 0.01), (hs, hz + h / 2)]]],
                     mat=mat, seg_mats=lambda i, j: 'glass' if j == 1 else mat)
    car.add(head, mirror=mirror)
    rx, rs, rz = root
    car.add(part_beam((rx, rs, rz), (hx, hs + l * 0.5, hz + h * 0.3), 0.022, 0.022, (0, 0, 1), stay_mat), mirror=mirror)
    car.add(part_beam((rx, rs, rz - 0.25), (hx, hs + l * 0.5, hz - h * 0.3), 0.022, 0.022, (0, 0, 1), stay_mat),
            mirror=mirror)


def exhaust(car, x, s, z, r=0.028, length=0.20):
    car.add(part_cyl((x, s, z), (0, 1, -0.06), r, length, 8, 'metal', cap_mat='trim'))


def underfloor(car, s0, s1, hw, z):
    """A dark floor pan / chassis slab between the axles so the car never looks hollow."""
    car.add(part_box(-hw, hw, s0, s1, z, z + 0.05, 'underbody'))


# ======================================================================================
# 4. mid sedan
# ======================================================================================
def build_sedan():
    c = Car('sedan', wheelbase=2.70, s_front_axle=0.92, wheel_r=0.315, track_f=1.47, track_r=1.46,
            tyre_w=0.19, rim_r=0.19, wheel_style='alloy6', colors=dict(paint='#8e99a3'))
    R = lower_ring
    rows = [
        R(0.075, 0.72, 0.30, 0.34, 0.62, 0.70, 0.715, tb=0.02, ts=0.0, rl=0.06, lean=0.08),   # nose face
        R(0.115, 0.795, 0.28, 0.33, 0.65, 0.737, 0.752, tb=0.03, ts=0.01, lean=0.05),
        R(0.21, 0.838, 0.25, 0.32, 0.688, 0.762, 0.778),
        R(0.45, 0.857, 0.23, 0.315, 0.722, 0.792, 0.808),
        R(1.00, 0.86, 0.19, 0.305, 0.76, 0.85, 0.862),
        R(1.78, 0.86, 0.17, 0.30, 0.78, 0.925, 0.92),
        R(2.90, 0.86, 0.17, 0.30, 0.795, 0.952, 0.952),
        R(3.62, 0.86, 0.18, 0.305, 0.808, 0.972, 0.975),
        R(4.00, 0.86, 0.20, 0.31, 0.818, 0.985, 1.0),
        R(4.30, 0.855, 0.24, 0.33, 0.822, 0.985, 0.997, crown=0.008),
        R(4.47, 0.84, 0.27, 0.34, 0.818, 0.975, 0.987, crown=0.008, bow=0.01),
        R(4.54, 0.805, 0.29, 0.35, 0.80, 0.955, 0.965, crown=0.006, tb=0.03),
        R(4.565, 0.765, 0.31, 0.36, 0.765, 0.93, 0.94, crown=0.004, tb=0.02, ts=0.0),        # tail face
    ]
    lower = part_loft(rows, mat='paint', seg_mats=lambda i, j: 'underbody' if j in LOWER_UNDER else 'paint')
    lower = c.cut_arches(lower, 0.365, z_c=0.335)
    c.add(lower, target=True)
    c.body_hw = 0.86

    G = gh_ring
    grows = [
        G(1.72, 0.78, 0.885, 0.72, 0.887, 0.893, ch=0.06, chz=0.002, bow=-0.05),
        G(1.80, 0.797, 0.935, 0.745, 0.94, 0.935, ch=0.06, chz=-0.002, bow=-0.05),
        G(2.50, 0.80, 0.945, 0.625, 1.355, 1.40, ch=0.11, chz=0.03, bow=-0.035),
        G(2.92, 0.805, 0.953, 0.638, 1.368, 1.414, ch=0.11, chz=0.03, bow=-0.004),
        G(3.00, 0.805, 0.955, 0.638, 1.368, 1.414, ch=0.11, chz=0.03, bow=0.0),
        G(3.42, 0.80, 0.968, 0.625, 1.35, 1.395, ch=0.11, chz=0.03, bow=0.03),
        G(3.98, 0.79, 0.985, 0.73, 1.007, 1.012, ch=0.06, chz=0.0, bow=0.06),
        G(4.06, 0.77, 0.93, 0.71, 0.95, 0.96, ch=0.06, chz=0.0, bow=0.06),
    ]
    def gmat(i, j):
        if i == 0 and j in GH_ROOF:
            return 'trim'          # cowl strip under the windscreen
        if i == 3 and j in GH_SIDE:
            return 'trim'          # B-pillar
        return 'paint'
    gh = part_loft(grows, seg_mats=gmat)
    c.add(gh, target=True)

    # bumpers (body colour, black lower lip)
    fsec = [(-0.07, 0.52), (0.0, 0.525), (0.045, 0.505), (0.072, 0.45), (0.075, 0.36), (0.06, 0.27),
            (0.03, 0.225), (-0.07, 0.225)]
    bumper(c, 0.80, 0.105, 0.26, 0.50, fsec, bow=-0.03,
           mats=lambda i, j: 'trim' if j in (5, 6) else ('underbody' if j == 7 else 'paint'))
    rsec = [(-0.07, 0.60), (0.0, 0.605), (0.04, 0.585), (0.06, 0.53), (0.065, 0.40), (0.05, 0.31),
            (0.02, 0.27), (-0.07, 0.27)]
    bumper(c, 0.80, 4.51, 0.24, 4.02, rsec, bow=0.03, rear=True,
           mats=lambda i, j: 'trim' if j in (5, 6) else ('underbody' if j == 7 else 'paint'))

    # ---- glass ---------------------------------------------------------------------------
    # windscreen: corners from the greenhouse stations, projected along its normal
    ws_n = Vector((0, -(1.355 - 0.94), (2.50 - 1.80))).normalized()   # outward (forward-up)
    c.surface_poly([(0.745, 1.80, 0.94), (0.625, 2.50, 1.355), (-0.625, 2.50, 1.355), (-0.745, 1.80, 0.94)],
                   -ws_n, 'glass', inset=[0.05, 0.03, 0.05, 0.025], radius=0.05, out=0.004)
    bl_n = Vector((0, (1.35 - 1.007), (3.98 - 3.42))).normalized()
    c.surface_poly([(0.625, 3.42, 1.35), (0.73, 3.98, 1.007), (-0.73, 3.98, 1.007), (-0.625, 3.42, 1.35)],
                   -bl_n, 'glass', inset=[0.05, 0.035, 0.05, 0.035], radius=0.05, out=0.004)
    # side DLO: black frame, then door glass
    c.side_decal(T.round_poly([(1.95, 0.957), (2.545, 1.335), (3.36, 1.332), (3.73, 0.982)], 0.03), 'trim', out=0.003)
    c.side_decal(T.round_poly([(1.99, 0.972), (2.54, 1.318), (2.915, 1.318), (2.915, 0.972)], 0.02), 'glass', out=0.006)
    c.side_decal(T.round_poly([(3.005, 0.975), (3.005, 1.318), (3.35, 1.316), (3.69, 0.99)], 0.02), 'glass', out=0.006)

    # ---- lamps ---------------------------------------------------------------------------
    # headlamp units: clear housing, main lens, amber corner
    c.front_decal([(0.34, 0.56), (0.79, 0.56), (0.815, 0.62), (0.80, 0.69), (0.35, 0.695)], 'clearlens',
                  out=0.004, tilt=0.08)
    c.front_decal(T.rounded_rect(0.37, 0.575, 0.665, 0.68, 0.02), 'headlamp', out=0.008, tilt=0.08,
                  lamp=('head', 'L'))
    c.decal([(0.72, 0.13, 0.578), (0.86, 0.13, 0.578), (0.86, 0.13, 0.676), (0.72, 0.13, 0.676)],
            (-0.55, 0.83, 0.0), 'indicator', out=0.008, mirror=True)
    # grille with chrome surround and a small badge
    c.front_decal(T.round_poly([(-0.315, 0.565), (0.315, 0.565), (0.325, 0.69), (-0.325, 0.69)], 0.02, 1),
                  'metal', out=0.004, mirror=False, tilt=0.08)
    c.front_decal(T.round_poly([(-0.29, 0.578), (0.29, 0.578), (0.298, 0.677), (-0.298, 0.677)], 0.015, 1),
                  'grille', out=0.008, mirror=False, tilt=0.08)
    c.front_decal(T.rounded_rect(-0.05, 0.605, 0.05, 0.65, 0.02, 1), 'metal', out=0.013, mirror=False, tilt=0.08)
    # bumper: plate + lower intake
    plate(c, 0.0, 0.40)
    c.front_decal(T.rounded_rect(-0.42, 0.25, 0.42, 0.30, 0.02, 1), 'grille', out=0.004, mirror=False)
    # tail lamps: red unit wrapping the corner, amber + reverse inserts, garnish between
    c.rear_decal([(0.36, 0.725), (0.80, 0.725), (0.835, 0.79), (0.815, 0.905), (0.36, 0.905)], 'taillamp',
                 out=0.006, lamp=('tail', 'L'))
    c.rear_decal(T.rounded_rect(0.455, 0.742, 0.565, 0.888, 0.01, 1), 'indicator', out=0.009)
    c.rear_decal(T.rounded_rect(0.375, 0.742, 0.445, 0.888, 0.01, 1), 'reverse', out=0.009)
    c.rear_decal(T.rounded_rect(-0.33, 0.79, 0.33, 0.865, 0.01, 1), 'clearlens', out=0.005, mirror=False)
    plate(c, 4.6, 0.49, front=False)
    c.rear_decal(T.rounded_rect(-0.07, 0.565, 0.07, 0.59, 0.008, 1), 'clearlens', out=0.006, mirror=False)
    # high-mount stop lamp behind the backlight
    c.surface_poly([(0.12, 3.86, 1.08), (-0.12, 3.86, 1.08), (-0.12, 3.82, 1.105), (0.12, 3.82, 1.105)],
                   -bl_n, 'taillamp', out=0.008)

    # ---- shut lines, handles --------------------------------------------------------------
    c.side_line([(1.86, 0.925), (1.86, 0.36), (1.90, 0.325), (3.22, 0.325)])
    c.side_line([(2.96, 0.95), (2.96, 0.325)])
    c.side_line([(3.60, 0.968)] + arch_points(3.62, 0.335, 0.40, 95, 180, 3))
    c.top_line([(0.79, 0.22), (0.79, 1.73)])
    c.top_line([(-0.785, 4.025), (0.785, 4.025)], mirror=False)
    c.top_line([(0.785, 4.025), (0.79, 4.50)])
    for s0 in (2.55, 3.33):
        c.side_decal(T.rounded_rect(s0, 0.862, s0 + 0.12, 0.893, 0.012, 1), 'trim', out=0.008)
    # fuel lid (left rear quarter)
    c.side_decal(T.rounded_rect(4.03, 0.81, 4.16, 0.90, 0.015, 1), 'trim', out=0.0025, mirror=False)

    # ---- small parts -----------------------------------------------------------------------
    door_mirror(c, 1.93, 1.03, 0.79)
    wiper(c, (0.02, 1.70, 1.10), (0.60, 1.70, 1.07), (0, 0.55, -0.83))
    wiper(c, (-0.62, 1.70, 1.07), (-0.08, 1.70, 1.10), (0, 0.55, -0.83))
    exhaust(c, -0.45, 4.50, 0.26)
    underfloor(c, 0.60, 4.20, 0.66, 0.16)
    return c


# ======================================================================================
# 1. tall kei wagon
# ======================================================================================
def build_kei_wagon():
    c = Car('kei_wagon', wheelbase=2.36, s_front_axle=0.52, wheel_r=0.265, track_f=1.29, track_r=1.285,
            tyre_w=0.155, rim_r=0.165, wheel_style='cover', colors=dict(paint='#a9d3c9'))
    R = lower_ring
    rows = [
        R(0.07, 0.64, 0.30, 0.33, 0.64, 0.72, 0.735, tb=0.02, ts=0.0, rl=0.05, lean=0.12),
        R(0.11, 0.70, 0.28, 0.33, 0.68, 0.775, 0.79, tb=0.03, ts=0.01, lean=0.06),
        R(0.22, 0.728, 0.25, 0.32, 0.71, 0.81, 0.825),
        R(0.45, 0.737, 0.22, 0.31, 0.74, 0.86, 0.87, crown=0.01),
        R(0.70, 0.737, 0.20, 0.30, 0.76, 0.925, 0.925),
        R(1.60, 0.737, 0.18, 0.29, 0.775, 0.955, 0.955),
        R(2.88, 0.737, 0.19, 0.30, 0.79, 0.985, 0.985),
        R(3.20, 0.735, 0.24, 0.32, 0.80, 0.99, 0.99),
        R(3.33, 0.72, 0.27, 0.34, 0.80, 0.985, 0.99, tb=0.03),
        R(3.37, 0.69, 0.29, 0.35, 0.79, 0.975, 0.98, tb=0.02, ts=0.0),
    ]
    lower = part_loft(rows, seg_mats=lambda i, j: 'underbody' if j in LOWER_UNDER else 'paint')
    lower = c.cut_arches(lower, 0.31, z_c=0.285)
    c.add(lower, target=True)
    c.body_hw = 0.737

    G = gh_ring
    grows = [
        G(0.64, 0.68, 0.85, 0.64, 0.86, 0.87, ch=0.04, chz=0.0, bow=-0.04),
        G(0.72, 0.70, 0.935, 0.67, 0.94, 0.935, ch=0.04, chz=0.0, bow=-0.04),
        G(1.22, 0.705, 0.945, 0.60, 1.575, 1.625, ch=0.09, chz=0.035, bow=-0.03),
        G(1.80, 0.71, 0.955, 0.605, 1.59, 1.64, ch=0.09, chz=0.035, bow=-0.005),
        G(1.88, 0.71, 0.957, 0.605, 1.59, 1.64, ch=0.09, chz=0.035),
        G(3.24, 0.71, 0.985, 0.61, 1.585, 1.632, ch=0.09, chz=0.035),
        G(3.335, 0.66, 0.99, 0.565, 1.555, 1.60, ch=0.08, chz=0.03, lean=-0.03),
    ]
    def gmat(i, j):
        if i == 0 and j in GH_ROOF:
            return 'trim'
        if i == 3 and j in GH_SIDE:
            return 'trim'
        return 'paint'
    gh = part_loft(grows, seg_mats=gmat)
    c.add(gh, target=True)

    fsec = [(-0.07, 0.52), (0.0, 0.525), (0.04, 0.505), (0.065, 0.45), (0.068, 0.34), (0.055, 0.25),
            (0.03, 0.215), (-0.07, 0.215)]
    bumper(c, 0.69, 0.10, 0.10, 0.19, fsec, bow=-0.025,
           mats=lambda i, j: 'trim' if j in (5, 6) else ('underbody' if j == 7 else 'paint'))
    rsec = [(-0.07, 0.53), (0.0, 0.535), (0.035, 0.515), (0.055, 0.46), (0.06, 0.36), (0.045, 0.28),
            (0.02, 0.25), (-0.07, 0.25)]
    bumper(c, 0.69, 3.335, 0.18, 3.19, rsec, bow=0.0, rear=True,
           mats=lambda i, j: 'trim' if j in (5, 6) else ('underbody' if j == 7 else 'paint'))

    # glass
    glass_between(c, grows[1], grows[2], [0.045, 0.03, 0.045, 0.02], radius=0.05)
    c.side_decal(T.round_poly([(0.86, 0.96), (1.27, 1.555), (3.16, 1.555), (3.20, 0.99)], 0.03), 'trim', out=0.003)
    c.side_decal(T.round_poly([(0.90, 0.972), (1.07, 1.215), (1.07, 0.972)], 0.015), 'glass', out=0.006)
    c.side_decal(T.round_poly([(1.115, 0.972), (1.115, 1.28), (1.29, 1.54), (1.785, 1.54), (1.785, 0.972)], 0.02),
                 'glass', out=0.006)
    c.side_decal(T.rounded_rect(1.895, 0.976, 2.62, 1.54, 0.02), 'glass', out=0.006)
    c.side_decal(T.round_poly([(2.70, 0.98), (2.70, 1.54), (3.15, 1.54), (3.18, 1.0)], 0.025), 'glass', out=0.006)
    # backlight on the near-vertical tailgate
    c.rear_decal(T.round_poly([(-0.50, 1.04), (0.50, 1.04), (0.47, 1.50), (-0.47, 1.50)], 0.04), 'glass',
                 out=0.004, mirror=False)

    # lamps: big headlamps sweeping up to the bonnet edge
    c.front_decal([(0.30, 0.56), (0.66, 0.56), (0.72, 0.62), (0.72, 0.77), (0.42, 0.75), (0.30, 0.70)],
                  'clearlens', out=0.004, tilt=0.12)
    c.front_decal(T.round_poly([(0.33, 0.585), (0.57, 0.585), (0.57, 0.728), (0.42, 0.722), (0.33, 0.685)], 0.025),
                  'headlamp', out=0.008, tilt=0.12, lamp=('head', 'L'))
    c.decal([(0.60, 0.12, 0.59), (0.76, 0.12, 0.59), (0.76, 0.12, 0.74), (0.60, 0.12, 0.74)],
            (-0.6, 0.8, 0.0), 'indicator', out=0.008, mirror=True)
    c.front_decal(T.rounded_rect(-0.25, 0.63, 0.25, 0.70, 0.02, 1), 'grille', out=0.005, mirror=False, tilt=0.12)
    c.front_decal(T.ellipse(0.0, 0.665, 0.045, 0.025, 8), 'metal', out=0.01, mirror=False, tilt=0.12)
    plate(c, 0.0, 0.41)
    c.front_decal(T.rounded_rect(-0.36, 0.235, 0.36, 0.29, 0.02, 1), 'grille', out=0.004, mirror=False)
    # tall tail lamps in the rear corners
    c.rear_decal(T.round_poly([(0.555, 0.70), (0.73, 0.70), (0.73, 1.33), (0.585, 1.33)], 0.02), 'taillamp',
                 out=0.006, lamp=('tail', 'L'))
    c.rear_decal(T.rounded_rect(0.575, 0.96, 0.73, 1.07, 0.01, 1), 'indicator', out=0.009)
    c.rear_decal(T.rounded_rect(0.57, 0.80, 0.73, 0.90, 0.01, 1), 'reverse', out=0.009)
    plate(c, 3.4, 0.68, front=False)
    c.rear_decal(T.rounded_rect(-0.30, 0.79, 0.30, 0.83, 0.01, 1), 'metal', out=0.006, mirror=False)
    # tailgate shut lines
    c.rear_line([(0.54, 0.55), (0.54, 1.53)])
    # roof spoiler with high stop lamp
    sp = part_loft([[(x, s, z) for (s, z) in [(3.26, 1.628), (3.345, 1.62), (3.36, 1.598), (3.29, 1.60)]]
                    for x in (-0.50, -0.47, 0.47, 0.50)], mat='paint')
    c.add(sp)
    c.rear_decal(T.rounded_rect(-0.14, 1.60, 0.14, 1.618, 0.005, 1), 'taillamp', out=0.004, mirror=False,
                 s=3.36)

    # shut lines, handles
    c.side_line([(0.86, 0.945), (0.86, 0.33), (0.89, 0.30), (1.95, 0.30)], width=0.007)
    c.side_line([(1.84, 0.965), (1.84, 0.30)], width=0.007)
    c.side_line([(2.66, 0.975), (2.66, 0.62)] + arch_points(2.88, 0.285, 0.345, 112, 180, 3), width=0.007)
    c.top_line([(0.67, 0.22), (0.67, 0.66)])
    for s0 in (1.50, 2.30):
        c.side_decal(T.rounded_rect(s0, 0.86, s0 + 0.11, 0.89, 0.012, 1), 'trim', out=0.008)
    c.side_decal(T.rounded_rect(2.98, 0.80, 3.10, 0.90, 0.015, 1), 'trim', out=0.0025, mirror=False)

    door_mirror(c, 0.86, 1.03, 0.69, reach=0.15, l=0.13, h=0.11)
    wiper(c, (0.0, 0.62, 1.05), (0.50, 0.62, 1.02), (0, 0.75, -0.66))
    wiper(c, (-0.55, 0.62, 1.02), (-0.06, 0.62, 1.05), (0, 0.75, -0.66))
    wiper(c, (0.0, 3.6, 1.12), (0.40, 3.6, 1.20), (0, -1, 0))
    exhaust(c, -0.40, 3.30, 0.26, r=0.024)
    underfloor(c, 0.40, 3.10, 0.56, 0.16)
    return c


# ======================================================================================
# 3. compact hatchback
# ======================================================================================
def build_hatch():
    c = Car('hatch', wheelbase=2.40, s_front_axle=0.72, wheel_r=0.289, track_f=1.43, track_r=1.42,
            tyre_w=0.155, rim_r=0.165, wheel_style='cover', colors=dict(paint='#c4373a'))
    R = lower_ring
    rows = [
        R(0.08, 0.66, 0.30, 0.33, 0.56, 0.625, 0.64, tb=0.02, ts=0.0, rl=0.06, lean=0.20),
        R(0.12, 0.74, 0.28, 0.325, 0.60, 0.675, 0.69, tb=0.03, ts=0.01, rl=0.06, lean=0.12),
        R(0.22, 0.79, 0.25, 0.32, 0.64, 0.722, 0.738, rl=0.065, lean=0.05),
        R(0.40, 0.82, 0.23, 0.31, 0.68, 0.77, 0.785, rl=0.07, crown=0.015),
        R(0.70, 0.83, 0.21, 0.30, 0.71, 0.83, 0.84, rl=0.07, crown=0.015),
        R(1.00, 0.83, 0.19, 0.30, 0.73, 0.885, 0.885, rl=0.07),
        R(2.00, 0.83, 0.18, 0.30, 0.75, 0.92, 0.92, rl=0.065),
        R(3.12, 0.83, 0.20, 0.30, 0.77, 0.95, 0.95, rl=0.065),
        R(3.45, 0.825, 0.24, 0.32, 0.78, 0.96, 0.96, rl=0.065),
        R(3.62, 0.80, 0.28, 0.34, 0.77, 0.955, 0.955, tb=0.03, rl=0.065),
        R(3.70, 0.75, 0.30, 0.35, 0.75, 0.94, 0.945, tb=0.02, ts=0.0, rl=0.06),
    ]
    lower = part_loft(rows, seg_mats=lambda i, j: 'underbody' if j in LOWER_UNDER else 'paint')
    lower = c.cut_arches(lower, 0.335, z_c=0.31)
    c.add(lower, target=True)
    c.body_hw = 0.83

    G = gh_ring
    grows = [
        G(0.92, 0.75, 0.84, 0.70, 0.85, 0.86, ch=0.05, chz=0.0, bow=-0.05),
        G(1.00, 0.77, 0.90, 0.73, 0.905, 0.90, ch=0.05, chz=0.0, bow=-0.06),
        G(1.66, 0.775, 0.915, 0.60, 1.40, 1.475, ch=0.15, chz=0.05, bow=-0.05),
        G(2.28, 0.78, 0.925, 0.62, 1.425, 1.50, ch=0.15, chz=0.05, bow=-0.01),
        G(2.36, 0.78, 0.927, 0.62, 1.425, 1.50, ch=0.15, chz=0.05),
        G(3.18, 0.775, 0.945, 0.60, 1.40, 1.465, ch=0.15, chz=0.045, bow=0.04),
        G(3.60, 0.735, 0.955, 0.66, 0.965, 0.97, ch=0.06, chz=0.0, bow=0.06),
        G(3.66, 0.70, 0.90, 0.62, 0.92, 0.93, ch=0.06, chz=0.0, bow=0.06),
    ]
    def gmat(i, j):
        if i == 0 and j in GH_ROOF:
            return 'trim'
        if i == 3 and j in GH_SIDE:
            return 'trim'
        return 'paint'
    gh = part_loft(grows, seg_mats=gmat)
    c.add(gh, target=True)

    fsec = [(-0.07, 0.53), (0.0, 0.535), (0.045, 0.51), (0.075, 0.44), (0.078, 0.35), (0.06, 0.26),
            (0.03, 0.225), (-0.07, 0.225)]
    bumper(c, 0.77, 0.115, 0.22, 0.36, fsec, bow=-0.035,
           mats=lambda i, j: 'trim' if j in (6,) else ('underbody' if j == 7 else 'paint'))
    rsec = [(-0.07, 0.56), (0.0, 0.565), (0.04, 0.54), (0.062, 0.47), (0.065, 0.37), (0.05, 0.29),
            (0.02, 0.255), (-0.07, 0.255)]
    bumper(c, 0.77, 3.665, 0.26, 3.50, rsec, bow=0.02, rear=True,
           mats=lambda i, j: 'trim' if j in (6,) else ('underbody' if j == 7 else 'paint'))

    glass_between(c, grows[1], grows[2], [0.05, 0.035, 0.05, 0.02], radius=0.06)
    glass_between(c, grows[5], grows[6], [0.06, 0.03, 0.06, 0.04], radius=0.06)
    c.side_decal(T.round_poly([(1.12, 0.93), (1.72, 1.375), (3.05, 1.375), (3.36, 1.05), (3.36, 0.955)], 0.03),
                 'trim', out=0.003)
    c.side_decal(T.round_poly([(1.16, 0.945), (1.72, 1.36), (2.255, 1.36), (2.255, 0.945)], 0.025), 'glass', out=0.006)
    c.side_decal(T.round_poly([(2.385, 0.95), (2.385, 1.36), (2.90, 1.36), (2.90, 0.95)], 0.025), 'glass', out=0.006)
    c.side_decal(T.round_poly([(2.96, 0.955), (2.96, 1.355), (3.04, 1.355), (3.30, 1.06), (3.30, 0.96)], 0.02),
                 'glass', out=0.006)

    # oval headlamps wrapping round the corners, small oval grille
    c.decal([(x, 0.10, z) for (x, z) in T.ellipse(0.585, 0.605, 0.215, 0.07, 12, rot=0.12)],
            (-0.35, 0.92, -0.18), 'clearlens', out=0.004, mirror=True)
    c.decal([(x, 0.10, z) for (x, z) in T.ellipse(0.55, 0.60, 0.15, 0.052, 10, rot=0.12)],
            (-0.35, 0.92, -0.18), 'headlamp', out=0.008, mirror=True, lamp=('head', 'L'))
    c.decal([(x, 0.18, z) for (x, z) in T.ellipse(0.77, 0.635, 0.05, 0.035, 8)],
            (-0.7, 0.7, -0.1), 'indicator', out=0.008, mirror=True)
    c.front_decal(T.ellipse(0.0, 0.585, 0.17, 0.042, 10), 'grille', out=0.005, mirror=False, tilt=0.2)
    c.front_decal(T.ellipse(0.0, 0.587, 0.04, 0.026, 8), 'metal', out=0.01, mirror=False, tilt=0.2)
    plate(c, 0.0, 0.40)
    c.front_decal(T.round_poly([(-0.38, 0.25), (0.38, 0.25), (0.33, 0.31), (-0.33, 0.31)], 0.02, 1), 'grille',
                  out=0.004, mirror=False)
    # rear: tail lamps in the hatch corners, plate on the tailgate
    c.rear_decal(T.round_poly([(0.52, 0.73), (0.79, 0.73), (0.80, 0.80), (0.76, 0.935), (0.56, 0.935)], 0.03),
                 'taillamp', out=0.006, lamp=('tail', 'L'))
    c.rear_decal(T.rounded_rect(0.555, 0.85, 0.66, 0.915, 0.012, 1), 'indicator', out=0.009)
    c.rear_decal(T.rounded_rect(0.555, 0.755, 0.66, 0.82, 0.012, 1), 'reverse', out=0.009)
    plate(c, 3.7, 0.72, front=False)
    c.rear_decal(T.rounded_rect(-0.06, 0.82, 0.06, 0.84, 0.008, 1), 'clearlens', out=0.006, mirror=False)
    c.rear_line([(0.50, 0.58), (0.50, 0.95)])
    sp = part_loft([[(x, s, z) for (s, z) in [(3.10, 1.455), (3.24, 1.43), (3.27, 1.40), (3.14, 1.415)]]
                    for x in (-0.50, -0.46, 0.46, 0.50)], mat='paint')
    c.add(sp)

    c.side_line([(1.10, 0.90), (1.10, 0.33), (1.14, 0.30), (2.40, 0.30)], width=0.007)
    c.side_line([(2.33, 0.93), (2.33, 0.30)], width=0.007)
    c.side_line([(2.95, 0.945), (2.95, 0.66)] + arch_points(3.12, 0.31, 0.37, 117, 180, 3), width=0.007)
    c.top_line([(0.76, 0.24), (0.76, 0.96)])
    for s0 in (1.95, 2.70):
        c.side_decal(T.rounded_rect(s0, 0.835, s0 + 0.11, 0.865, 0.012, 1), 'trim', out=0.008)
    c.side_decal(T.ellipse(3.30, 0.84, 0.065, 0.055, 8), 'trim', out=0.0025, mirror=False)

    door_mirror(c, 1.16, 1.0, 0.76, reach=0.16, l=0.14, h=0.105)
    wiper(c, (0.0, 0.95, 1.02), (0.55, 0.95, 0.99), (0, 0.6, -0.8))
    wiper(c, (-0.58, 0.95, 0.99), (-0.06, 0.95, 1.02), (0, 0.6, -0.8))
    wiper(c, (0.0, 3.6, 1.20), (0.40, 3.6, 1.12), (0, -0.7, -0.7))
    exhaust(c, -0.42, 3.62, 0.27, r=0.025)
    underfloor(c, 0.50, 3.40, 0.62, 0.16)
    return c


# ======================================================================================
# 2. kei truck (cab-over, drop-side bed)
# ======================================================================================
def build_kei_truck():
    c = Car('kei_truck', wheelbase=1.905, s_front_axle=0.66, wheel_r=0.268, track_f=1.30, track_r=1.30,
            tyre_w=0.145, rim_r=0.152, wheel_style='steel', colors=dict(paint='#f2f2ee'))
    R = lower_ring
    rows = [
        R(0.03, 0.69, 0.33, 0.37, 0.80, 1.02, 1.035, tb=0.02, ts=0.0, rl=0.035, lean=0.05, crown=0.004),
        R(0.07, 0.725, 0.31, 0.36, 0.82, 1.05, 1.062, tb=0.03, ts=0.01, rl=0.035, lean=0.04, crown=0.004),
        R(0.15, 0.7375, 0.29, 0.35, 0.83, 1.07, 1.078, rl=0.035, crown=0.004),
        R(1.20, 0.7375, 0.30, 0.35, 0.85, 1.08, 1.08, rl=0.035, crown=0.0),
        R(1.30, 0.72, 0.32, 0.36, 0.85, 1.075, 1.075, tb=0.02, ts=0.0, rl=0.035, crown=0.0),
    ]
    lower = part_loft(rows, seg_mats=lambda i, j: 'underbody' if j in LOWER_UNDER else 'paint')
    # front arches only: the rear wheels sit under the bed
    cutter = bmesh.new()
    for sg in (1, -1):
        x0, x1 = (0.40, 0.90) if sg > 0 else (-0.90, -0.40)
        cc = part_cyl(((x0 + x1) / 2, c.s_fa, 0.29), (1, 0, 0), 0.315, x1 - x0, 20, 'underbody')
        T.bm_append(cutter, cc)
    lower = T.boolean(lower, cutter)
    c.add(lower, target=True)
    c.body_hw = 0.7375

    G = gh_ring
    grows = [
        G(0.07, 0.69, 1.00, 0.66, 1.02, 1.03, ch=0.03, chz=0.0, lean=0.15),
        G(0.11, 0.712, 1.065, 0.69, 1.07, 1.075, ch=0.03, chz=0.0, bow=-0.025),
        G(0.36, 0.716, 1.075, 0.665, 1.72, 1.78, ch=0.07, chz=0.03, bow=-0.02),
        G(1.20, 0.716, 1.08, 0.67, 1.72, 1.78, ch=0.07, chz=0.03),
        G(1.27, 0.70, 1.08, 0.655, 1.705, 1.76, ch=0.06, chz=0.03),
    ]
    gh = part_loft(grows, seg_mats=lambda i, j: 'trim' if (i == 0 and j in GH_ROOF) else 'paint')
    c.add(gh, target=True)

    # front bumper (black resin) wrapping to the wheel arch
    fsec = [(-0.06, 0.50), (0.0, 0.505), (0.04, 0.49), (0.055, 0.44), (0.058, 0.36), (0.045, 0.31),
            (0.02, 0.295), (-0.06, 0.295)]
    bumper(c, 0.70, 0.075, 0.08, 0.30, fsec, mat='trim', mats=lambda i, j: 'underbody' if j == 7 else 'trim')

    # ---- glass ---------------------------------------------------------------------------
    glass_between(c, grows[1], grows[2], [0.035, 0.03, 0.035, 0.02], radius=0.04)
    c.side_decal(T.round_poly([(0.31, 1.095), (0.45, 1.675), (1.17, 1.675), (1.17, 1.095)], 0.03), 'trim', out=0.003)
    c.side_decal(T.round_poly([(0.345, 1.11), (0.475, 1.655), (1.15, 1.655), (1.15, 1.11)], 0.02), 'glass', out=0.006)
    c.rear_decal(T.rounded_rect(-0.50, 1.20, 0.50, 1.56, 0.04), 'glass', out=0.005, mirror=False, s=1.29)

    # ---- front: square lamps, black garnish, indicators -----------------------------------
    c.front_decal(T.rounded_rect(-0.69, 0.55, 0.69, 0.75, 0.03), 'trim', out=0.003, mirror=False, tilt=0.05)
    c.front_decal(T.rounded_rect(0.43, 0.575, 0.645, 0.725, 0.025), 'headlamp', out=0.008, tilt=0.05,
                  lamp=('head', 'L'))
    c.decal([(0.665, 0.10, 0.585), (0.77, 0.10, 0.585), (0.77, 0.10, 0.715), (0.665, 0.10, 0.715)],
            (-0.5, 0.86, 0.0), 'indicator', out=0.008, mirror=True)
    for z in (0.60, 0.635, 0.67, 0.705):
        c.front_line([(-0.36, z), (0.36, z)], width=0.012, mat='grille', out=0.006, mirror=False)
    c.front_decal(T.ellipse(0.0, 0.80, 0.06, 0.03, 8), 'metal', out=0.006, mirror=False, tilt=0.05)
    plate(c, 0.0, 0.40)
    # door / cab shut lines and handles
    c.side_line([(0.30, 1.06), (0.30, 0.66)] + arch_points(0.66, 0.29, 0.37, 165, 75, 3)[1:], width=0.007)
    c.side_line([(1.19, 1.07), (1.19, 0.37)], width=0.007)
    c.side_line([(0.98, 0.37), (1.19, 0.37)], width=0.007)
    c.side_decal(T.rounded_rect(1.02, 0.98, 1.13, 1.01, 0.01, 1), 'trim', out=0.008)
    c.side_decal(T.rounded_rect(1.205, 1.40, 1.245, 1.60, 0.01, 1), 'grille', out=0.004)   # cab vent

    # ---- bed --------------------------------------------------------------------------------
    s0, s1 = 1.34, 3.395
    zf = 0.66
    hw = 0.7375
    c.add(part_box(-hw + 0.01, hw - 0.01, s0, s1 - 0.01, zf - 0.05, zf, 'paint'))           # deck
    c.add(part_box(-0.60, 0.60, s0 + 0.05, s1 - 0.05, zf - 0.12, zf - 0.05, 'underbody'))   # deck bearers
    # drop sides: outer panel with two press lines, top rail
    gate_h = 0.285
    for side in (1,):
        poly = [(s0 + 0.02, zf - 0.04), (s1 - 0.03, zf - 0.04), (s1 - 0.03, zf + gate_h), (s0 + 0.02, zf + gate_h)]
        c.add(part_cprism(poly, hw - 0.035, hw, 0.006, 'paint'), target=True, mirror=True)
    c.add(part_cprism([(s1 - 0.035, zf - 0.04), (s1, zf - 0.04), (s1, zf + gate_h), (s1 - 0.035, zf + gate_h)],
                      -hw, hw, 0.006, 'paint'), target=True)
    for z in (zf + 0.07, zf + 0.17):
        c.side_line([(s0 + 0.06, z), (s1 - 0.07, z)], width=0.012, mat='paint', out=0.005, x=1.0)
        c.rear_line([(-hw + 0.06, z), (hw - 0.06, z)], width=0.012, mat='paint', out=0.005, mirror=False)
    # gate posts and latches
    for sp in (s0 + 0.02, s1 - 0.03):
        c.add(part_box(hw - 0.04, hw + 0.004, sp - 0.012, sp + 0.03, zf - 0.04, zf + gate_h + 0.006, 'paint'),
              mirror=True)
    for sp in (s0 + 0.55, s0 + 1.40):
        c.add(part_box(hw - 0.004, hw + 0.012, sp, sp + 0.06, zf + gate_h - 0.06, zf + gate_h - 0.02, 'metal'),
              mirror=True)
    c.add(part_box(0.50, 0.58, s1 - 0.004, s1 + 0.012, zf + gate_h - 0.06, zf + gate_h - 0.02, 'metal'), mirror=True)
    # headboard with the guard frame (torii) protecting the rear window
    c.add(part_box(-hw + 0.005, hw - 0.005, s0 - 0.03, s0 + 0.01, zf - 0.04, zf + 0.33, 'paint'))
    for x in (-0.70, 0.70):
        c.add(part_beam((x, s0 - 0.01, zf + 0.30), (x, s0 - 0.01, 1.74), 0.04, 0.04, (0, 1, 0), 'paint'))
    c.add(part_beam((-0.72, s0 - 0.01, 1.74), (0.72, s0 - 0.01, 1.74), 0.045, 0.04, (0, 0, 1), 'paint'))
    c.add(part_beam((-0.70, s0 - 0.01, 1.30), (0.70, s0 - 0.01, 1.30), 0.03, 0.03, (0, 0, 1), 'paint'))
    for x in (-0.36, -0.12, 0.12, 0.36):
        c.add(part_beam((x, s0 - 0.01, zf + 0.30), (x, s0 - 0.01, 1.74), 0.022, 0.022, (0, 1, 0), 'paint'))
    # chassis, fuel tank, spare, rear fenders and flaps
    for x in (0.36, -0.36):
        c.add(part_box(x - 0.04, x + 0.04, 0.95, s1 - 0.08, 0.40, 0.54, 'underbody'))
    c.add(part_box(0.25, 0.62, 1.55, 2.05, 0.36, 0.55, 'trim'))
    c.add(part_cyl((0.0, 3.00, 0.47), (0, 0, 1), 0.25, 0.12, 12, 'tyre', cap_mat='rim'))
    fender_arc(c, c.s_ra, 0.29, 0.30, 0.012, 0.52, 0.735, a0=8, a1=172, n=6)
    mudflap(c, c.s_ra + 0.36, 0.20, 0.50, 0.53, 0.73)
    # rear: steel bumper bar, combination lamps on brackets, plate
    c.add(part_box(-0.70, 0.70, s1 - 0.10, s1 - 0.02, 0.39, 0.47, 'trim'))
    c.add(part_box(0.44, 0.72, s1 - 0.06, s1 - 0.02, 0.47, 0.625, 'trim'), mirror=True, target=True)
    c.rear_decal(T.rounded_rect(0.55, 0.483, 0.708, 0.612, 0.012, 1), 'taillamp', out=0.005, lamp=('tail', 'L'),
                 s=s1 - 0.02)
    c.rear_decal(T.rounded_rect(0.452, 0.483, 0.540, 0.612, 0.010, 1), 'indicator', out=0.005, s=s1 - 0.02)
    c.add(part_box(-0.17, 0.17, s1 - 0.03, s1 - 0.01, 0.39, 0.56, 'trim'), target=True)
    c.rear_decal(T.rounded_rect(-0.165, 0.395, 0.165, 0.56, 0.01, 1), 'plate', out=0.004, mirror=False, s=s1 - 0.01)

    door_mirror(c, 0.38, 1.13, 0.70, reach=0.15, l=0.12, h=0.11)
    wiper(c, (0.05, 0.10, 1.12), (0.55, 0.10, 1.12), (0, 0.94, -0.33))
    wiper(c, (-0.55, 0.10, 1.12), (-0.05, 0.10, 1.12), (0, 0.94, -0.33))
    exhaust(c, -0.45, 3.0, 0.32, r=0.022)
    underfloor(c, 0.30, 1.30, 0.55, 0.30)
    return c


# ======================================================================================
# 5. taxi (boxy four-door with andon and fender mirrors, two-tone)
# ======================================================================================
def build_taxi():
    c = Car('taxi', wheelbase=2.68, s_front_axle=0.88, wheel_r=0.315, track_f=1.425, track_r=1.43,
            tyre_w=0.175, rim_r=0.178, wheel_style='cover', colors=dict(paint='#2f6d55', accent='#f0e2b0'))
    R = lower_ring
    rows = [
        R(0.06, 0.79, 0.30, 0.34, 0.70, 0.775, 0.785, tb=0.02, ts=0.0, rl=0.03, lean=0.03, crown=0.004),
        R(0.09, 0.835, 0.28, 0.33, 0.72, 0.80, 0.81, tb=0.03, ts=0.01, rl=0.03, crown=0.005),
        R(0.18, 0.845, 0.25, 0.32, 0.73, 0.82, 0.83, rl=0.035, crown=0.006),
        R(0.60, 0.8475, 0.22, 0.31, 0.745, 0.845, 0.855, rl=0.035, crown=0.006),
        R(1.55, 0.8475, 0.20, 0.30, 0.76, 0.885, 0.885, rl=0.035, crown=0.004),
        R(3.56, 0.8475, 0.20, 0.30, 0.78, 0.92, 0.92, rl=0.035, crown=0.0),
        R(3.98, 0.8475, 0.22, 0.31, 0.785, 0.965, 0.975, rl=0.035, crown=0.005),
        R(4.48, 0.845, 0.26, 0.33, 0.79, 0.97, 0.977, rl=0.035, crown=0.005),
        R(4.545, 0.83, 0.29, 0.34, 0.785, 0.965, 0.972, tb=0.03, rl=0.035, crown=0.004),
        R(4.565, 0.80, 0.30, 0.35, 0.77, 0.95, 0.957, tb=0.02, ts=0.0, rl=0.03, crown=0.003),
    ]
    lower = part_loft(rows, seg_mats=lambda i, j: 'underbody' if j in LOWER_UNDER else 'paint')
    lower = c.cut_arches(lower, 0.36, z_c=0.33)
    c.add(lower, target=True)
    c.body_hw = 0.8475

    G = gh_ring
    grows = [
        G(1.50, 0.79, 0.84, 0.74, 0.85, 0.86, ch=0.04, chz=0.0, bow=-0.02),
        G(1.57, 0.80, 0.90, 0.77, 0.905, 0.905, ch=0.04, chz=0.0, bow=-0.02),
        G(2.13, 0.805, 0.912, 0.70, 1.455, 1.50, ch=0.08, chz=0.025, bow=-0.015),
        G(2.80, 0.806, 0.918, 0.705, 1.46, 1.505, ch=0.08, chz=0.025),
        G(2.88, 0.806, 0.919, 0.705, 1.46, 1.505, ch=0.08, chz=0.025),
        G(3.58, 0.805, 0.93, 0.70, 1.45, 1.495, ch=0.08, chz=0.025, bow=0.015),
        G(3.98, 0.80, 0.955, 0.76, 0.985, 0.99, ch=0.04, chz=0.0, bow=0.02),
        G(4.04, 0.78, 0.90, 0.74, 0.93, 0.94, ch=0.04, chz=0.0, bow=0.02),
    ]
    def gmat(i, j):
        if i == 0 and j in GH_ROOF:
            return 'trim'
        if i == 3 and j in GH_SIDE:
            return 'trim'
        return 'accent'
    gh = part_loft(grows, seg_mats=gmat)
    c.add(gh, target=True)

    # chrome bumpers with rubber strips
    fsec = [(-0.06, 0.50), (0.0, 0.505), (0.05, 0.495), (0.07, 0.47), (0.07, 0.38), (0.055, 0.35),
            (0.02, 0.34), (-0.06, 0.34)]
    bumper(c, 0.835, 0.07, 0.10, 0.48, fsec, bow=-0.01, mat='metal',
           mats=lambda i, j: 'trim' if j in (3, 4) else ('underbody' if j == 7 else 'metal'))
    rsec = [(-0.06, 0.52), (0.0, 0.525), (0.05, 0.515), (0.07, 0.49), (0.07, 0.40), (0.055, 0.37),
            (0.02, 0.36), (-0.06, 0.36)]
    bumper(c, 0.835, 4.53, 0.10, 4.02, rsec, bow=0.01, rear=True, mat='metal',
           mats=lambda i, j: 'trim' if j in (3, 4) else ('underbody' if j == 7 else 'metal'))

    # glass
    glass_between(c, grows[1], grows[2], [0.045, 0.03, 0.045, 0.02], radius=0.04)
    glass_between(c, grows[5], grows[6], [0.05, 0.03, 0.05, 0.035], radius=0.04)
    c.side_decal(T.round_poly([(1.69, 0.925), (2.18, 1.425), (3.50, 1.42), (3.86, 0.96)], 0.025), 'trim', out=0.003)
    c.side_decal(T.round_poly([(1.73, 0.94), (2.18, 1.405), (2.795, 1.405), (2.795, 0.94)], 0.015), 'glass', out=0.006)
    c.side_decal(T.round_poly([(2.885, 0.945), (2.885, 1.405), (3.44, 1.405), (3.64, 1.15), (3.64, 0.95)], 0.015),
                 'glass', out=0.006)
    c.side_decal(T.round_poly([(3.69, 0.965), (3.69, 1.09), (3.80, 0.965)], 0.01), 'glass', out=0.006)
    # two-tone waist stripe and chrome belt moulding
    c.side_line([(0.12, 0.735), (4.53, 0.765)], width=0.05, mat='accent', out=0.0035)
    c.side_line([(1.62, 0.918), (3.85, 0.948)], width=0.012, mat='metal', out=0.0045)
    c.side_line([(1.30, 0.50), (3.15, 0.50)], width=0.035, mat='trim', out=0.006)

    # front: rectangular lamps, chrome grille, corner lamps
    c.front_decal(T.rounded_rect(-0.36, 0.565, 0.36, 0.745, 0.012, 1), 'metal', out=0.004, mirror=False)
    c.front_decal(T.rounded_rect(-0.335, 0.585, 0.335, 0.725, 0.01, 1), 'grille', out=0.007, mirror=False)
    for z in (0.62, 0.655, 0.69):
        c.front_line([(-0.33, z), (0.33, z)], width=0.008, mat='metal', out=0.009, mirror=False)
    c.front_decal(T.rounded_rect(0.39, 0.585, 0.70, 0.735, 0.012, 1), 'clearlens', out=0.004)
    c.front_decal(T.rounded_rect(0.41, 0.60, 0.68, 0.72, 0.012, 1), 'headlamp', out=0.008, lamp=('head', 'L'))
    c.decal([(0.73, 0.10, 0.59), (0.86, 0.10, 0.59), (0.86, 0.10, 0.73), (0.73, 0.10, 0.73)],
            (-0.55, 0.84, 0.0), 'indicator', out=0.006, mirror=True)
    c.front_decal(T.rounded_rect(0.45, 0.38, 0.62, 0.43, 0.01, 1), 'indicator', out=0.004, s=0.0)
    plate(c, 0.0, 0.41)
    # rear: wide tail lamps with chrome garnish
    c.rear_decal(T.rounded_rect(0.34, 0.68, 0.80, 0.87, 0.012, 1), 'taillamp', out=0.006, lamp=('tail', 'L'))
    c.rear_decal(T.rounded_rect(0.36, 0.70, 0.46, 0.85, 0.008, 1), 'reverse', out=0.009)
    c.rear_decal(T.rounded_rect(0.48, 0.70, 0.58, 0.85, 0.008, 1), 'indicator', out=0.009)
    c.rear_decal(T.rounded_rect(-0.32, 0.72, 0.32, 0.83, 0.008, 1), 'metal', out=0.005, mirror=False)
    plate(c, 4.6, 0.62, front=False)
    c.top_line([(-0.80, 3.995), (0.80, 3.995)], mirror=False)
    c.top_line([(0.80, 3.995), (0.80, 4.52)])

    # shut lines, chrome handles
    c.side_line([(1.62, 0.90), (1.62, 0.34), (1.66, 0.31), (3.18, 0.31)])
    c.side_line([(2.84, 0.93), (2.84, 0.31)])
    c.side_line([(3.66, 0.95)] + arch_points(3.56, 0.33, 0.395, 75, 180, 3))
    c.top_line([(0.80, 0.16), (0.80, 1.50)])
    for s0 in (2.50, 3.25):
        c.side_decal(T.rounded_rect(s0, 0.84, s0 + 0.12, 0.87, 0.01, 1), 'metal', out=0.008)

    # andon roof sign on a trim plinth, set across the roof: its front and back display faces use the
    # headlamp slot so the lantern lights up with the lamps; the body is clear lens
    sa = 2.55
    rot = Matrix.Rotation(math.pi / 2, 4, 'Z')    # prisms are built along X; turn them to run along s
    c.add(part_box(-0.20, 0.20, sa - 0.12, sa + 0.12, 1.495, 1.525, 'trim'))
    prof = [(-0.23, 1.52), (0.23, 1.52), (0.19, 1.62), (0.12, 1.675), (-0.12, 1.675), (-0.19, 1.62)]
    c.add(T.transform(part_cprism(prof, sa - 0.10, sa + 0.10, 0.014, 'clearlens', cmat='headlamp'), rot))
    c.add(T.transform(part_cprism([(-0.232, 1.52), (0.232, 1.52), (0.215, 1.55), (-0.215, 1.55)],
                                  sa - 0.103, sa + 0.103, 0.005, 'accent'), rot))
    # fender mirrors on the front wings
    for sgn in (1,):
        root = (0.70, 0.62, 0.84)
        c.add(part_beam(root, (0.73, 0.60, 0.98), 0.024, 0.024, (0, 1, 0), 'trim'), mirror=True)
        hd = part_loft([[(x, s_, z_) for (s_, z_) in [(0.53, 0.985), (0.575, 1.055), (0.64, 1.055), (0.64, 0.96),
                                                      (0.57, 0.955)]]
                        for x in (0.68, 0.70, 0.79, 0.81)], mat='trim',
                       seg_mats=lambda i, j: 'glass' if (j == 2 and i == 1) else 'trim')
        c.add(hd, mirror=True)
    # radio antenna on the right rear wing, mudflaps
    c.add(part_beam((-0.70, 4.25, 0.95), (-0.70, 4.32, 1.62), 0.012, 0.012, (0, 1, 0), 'metal'))
    c.add(part_cyl((-0.70, 4.25, 0.965), (0, 0, 1), 0.02, 0.03, 6, 'trim'))
    mudflap(c, c.s_fa + 0.33, 0.12, 0.33, 0.62, 0.80)
    mudflap(c, c.s_ra + 0.33, 0.12, 0.33, 0.62, 0.80)

    wiper(c, (0.02, 1.62, 1.00), (0.58, 1.62, 0.98), (0, 0.7, -0.71))
    wiper(c, (-0.60, 1.62, 0.98), (-0.08, 1.62, 1.00), (0, 0.7, -0.71))
    exhaust(c, -0.45, 4.50, 0.30)
    underfloor(c, 0.60, 4.20, 0.66, 0.16)
    return c

# ======================================================================================
# 6. minivan (one-and-a-half box, sliding rear doors)
# ======================================================================================
def build_minivan():
    c = Car('minivan', wheelbase=2.90, s_front_axle=0.90, wheel_r=0.325, track_f=1.54, track_r=1.54,
            tyre_w=0.205, rim_r=0.19, wheel_style='alloy5', colors=dict(paint='#2f4a6b'))
    R = lower_ring
    rows = [
        R(0.07, 0.74, 0.32, 0.36, 0.60, 0.655, 0.67, tb=0.02, ts=0.0, rl=0.06, lean=0.25),
        R(0.12, 0.82, 0.30, 0.35, 0.64, 0.705, 0.725, tb=0.03, ts=0.01, rl=0.06, lean=0.12),
        R(0.25, 0.875, 0.27, 0.33, 0.69, 0.77, 0.79, rl=0.065, lean=0.04, crown=0.015),
        R(0.50, 0.895, 0.24, 0.32, 0.74, 0.845, 0.865, rl=0.07, crown=0.018),
        R(0.85, 0.90, 0.22, 0.31, 0.78, 0.94, 0.945, rl=0.07, crown=0.01),
        R(2.00, 0.90, 0.20, 0.30, 0.80, 1.0, 1.0, rl=0.065),
        R(3.80, 0.90, 0.21, 0.30, 0.82, 1.04, 1.04, rl=0.065),
        R(4.45, 0.895, 0.25, 0.32, 0.83, 1.05, 1.05, rl=0.065),
        R(4.64, 0.87, 0.29, 0.34, 0.82, 1.045, 1.045, tb=0.03, rl=0.065),
        R(4.70, 0.82, 0.31, 0.35, 0.80, 1.04, 1.04, tb=0.02, ts=0.0, rl=0.06),
    ]
    lower = part_loft(rows, seg_mats=lambda i, j: 'underbody' if j in LOWER_UNDER else 'paint')
    lower = c.cut_arches(lower, 0.37, z_c=0.34, depth=0.40)
    c.add(lower, target=True)
    c.body_hw = 0.90

    G = gh_ring
    grows = [
        G(0.78, 0.83, 0.88, 0.79, 0.89, 0.90, ch=0.04, chz=0.0, bow=-0.06),
        G(0.86, 0.85, 0.955, 0.82, 0.96, 0.955, ch=0.04, chz=0.0, bow=-0.06),
        G(1.78, 0.855, 0.985, 0.70, 1.625, 1.70, ch=0.15, chz=0.05, bow=-0.05),
        G(2.02, 0.856, 0.99, 0.705, 1.63, 1.705, ch=0.15, chz=0.05, bow=-0.03),
        G(2.10, 0.857, 0.992, 0.705, 1.63, 1.705, ch=0.15, chz=0.05, bow=-0.02),
        G(3.50, 0.86, 1.03, 0.71, 1.62, 1.69, ch=0.15, chz=0.05),
        G(4.52, 0.855, 1.045, 0.70, 1.58, 1.645, ch=0.15, chz=0.045, bow=0.03),
        G(4.665, 0.80, 1.045, 0.66, 1.53, 1.585, ch=0.12, chz=0.04, bow=0.03, lean=-0.12),
    ]
    def gmat(i, j):
        if i == 0 and j in GH_ROOF:
            return 'trim'
        if i == 3 and j in GH_SIDE:
            return 'trim'
        return 'paint'
    gh = part_loft(grows, seg_mats=gmat)
    c.add(gh, target=True)

    fsec = [(-0.07, 0.56), (0.0, 0.565), (0.05, 0.54), (0.08, 0.47), (0.085, 0.37), (0.07, 0.28),
            (0.035, 0.24), (-0.07, 0.24)]
    bumper(c, 0.83, 0.10, 0.28, 0.48, fsec, bow=-0.04,
           mats=lambda i, j: 'trim' if j == 6 else ('underbody' if j == 7 else 'paint'))
    rsec = [(-0.07, 0.58), (0.0, 0.585), (0.04, 0.565), (0.065, 0.50), (0.07, 0.38), (0.055, 0.30),
            (0.025, 0.265), (-0.07, 0.265)]
    bumper(c, 0.83, 4.655, 0.24, 4.20, rsec, bow=0.02, rear=True,
           mats=lambda i, j: 'trim' if j == 6 else ('underbody' if j == 7 else 'paint'))

    # glass: long raked windscreen, blacked-out pillars, wraparound rear quarters
    glass_between(c, grows[1], grows[2], [0.05, 0.035, 0.05, 0.02], radius=0.06)
    c.side_decal(T.round_poly([(0.97, 0.965), (1.86, 1.60), (4.43, 1.565), (4.58, 1.45), (4.60, 1.06)], 0.03),
                 'trim', out=0.003)
    c.side_decal(T.round_poly([(1.03, 0.98), (1.30, 1.17), (1.30, 0.98)], 0.012), 'glass', out=0.006)
    c.side_decal(T.round_poly([(1.34, 0.985), (1.34, 1.20), (1.86, 1.58), (2.02, 1.58), (2.02, 0.985)], 0.02),
                 'glass', out=0.006)
    c.side_decal(T.rounded_rect(2.11, 0.995, 3.17, 1.575, 0.02), 'glass', out=0.006)
    c.side_decal(T.round_poly([(3.25, 1.03), (3.25, 1.57), (4.40, 1.55), (4.53, 1.44), (4.55, 1.07)], 0.03),
                 'glass', out=0.006)
    c.rear_decal(T.round_poly([(-0.58, 1.08), (0.58, 1.08), (0.53, 1.50), (-0.53, 1.50)], 0.05), 'glass',
                 out=0.004, mirror=False, s=4.70, tilt=-0.12)

    # front: wide lamps sweeping up the wings, slim grille with chrome bar, fog lamps
    c.decal([(x, 0.15, z) for (x, z) in [(0.42, 0.60), (0.80, 0.62), (0.90, 0.70), (0.86, 0.745), (0.52, 0.72),
                                         (0.42, 0.665)]],
            (-0.25, 0.94, -0.22), 'clearlens', out=0.004, mirror=True)
    c.decal([(x, 0.15, z) for (x, z) in T.round_poly([(0.46, 0.615), (0.68, 0.625), (0.68, 0.715), (0.52, 0.705),
                                                       (0.46, 0.67)], 0.02)],
            (-0.25, 0.94, -0.22), 'headlamp', out=0.008, mirror=True, lamp=('head', 'L'))
    c.decal([(0.75, 0.25, 0.64), (0.92, 0.25, 0.66), (0.92, 0.25, 0.73), (0.75, 0.25, 0.72)],
            (-0.6, 0.78, -0.15), 'indicator', out=0.008, mirror=True)
    c.front_decal(T.round_poly([(-0.38, 0.605), (0.38, 0.605), (0.36, 0.665), (-0.36, 0.665)], 0.02, 1), 'grille',
                  out=0.005, mirror=False, tilt=0.25, s=0.10)
    c.front_line([(-0.36, 0.637), (0.36, 0.637)], width=0.014, mat='metal', out=0.008, mirror=False, s=0.0)
    c.front_decal(T.ellipse(0.0, 0.637, 0.05, 0.03, 8), 'metal', out=0.012, mirror=False, tilt=0.25, s=0.10)
    plate(c, 0.0, 0.42)
    c.front_decal(T.round_poly([(-0.50, 0.26), (0.50, 0.26), (0.46, 0.33), (-0.46, 0.33)], 0.02, 1), 'grille',
                  out=0.004, mirror=False)
    c.front_decal(T.ellipse(0.66, 0.31, 0.06, 0.032, 8), 'clearlens', out=0.006)
    # rear: tall D-pillar lamps, plate on the tailgate, spoiler with stop lamp
    c.rear_decal(T.round_poly([(0.62, 0.78), (0.86, 0.78), (0.85, 1.40), (0.70, 1.40)], 0.025), 'taillamp',
                 out=0.006, lamp=('tail', 'L'), s=4.70)
    c.rear_decal(T.rounded_rect(0.66, 1.12, 0.86, 1.22, 0.01, 1), 'indicator', out=0.009, s=4.70)
    c.rear_decal(T.rounded_rect(0.645, 0.85, 0.86, 0.95, 0.01, 1), 'reverse', out=0.009, s=4.70)
    plate(c, 4.75, 0.82, front=False)
    c.rear_decal(T.rounded_rect(-0.40, 0.92, 0.40, 0.97, 0.01, 1), 'metal', out=0.006, mirror=False, s=4.70)
    c.rear_line([(0.60, 0.62), (0.62, 1.55)], s=5.2)
    sp = part_loft([[(x, s_, z_) for (s_, z_) in [(4.56, 1.632), (4.665, 1.605), (4.68, 1.582), (4.59, 1.598)]]
                    for x in (-0.56, -0.53, 0.53, 0.56)], mat='paint')
    c.add(sp)
    c.rear_decal(T.rounded_rect(-0.15, 1.585, 0.15, 1.603, 0.005, 1), 'taillamp', out=0.004, mirror=False, s=4.69)

    # doors: front door, sliding door with its rail line, handles
    c.side_line([(0.95, 0.94), (0.95, 0.36), (0.99, 0.32), (2.04, 0.32)])
    c.side_line([(2.06, 0.975), (2.06, 0.32), (3.19, 0.32), (3.21, 0.36), (3.21, 0.995)])
    c.side_line([(3.21, 1.005), (4.40, 1.025)], width=0.016, mat='trim', out=0.004)     # sliding-door rail
    c.top_line([(0.80, 0.30), (0.81, 0.82)])
    for s0 in (1.80, 2.95):
        c.side_decal(T.rounded_rect(s0, 0.88, s0 + 0.13, 0.91, 0.012, 1), 'trim', out=0.008)
    c.side_decal(T.rounded_rect(3.90, 0.82, 4.03, 0.92, 0.015, 1), 'trim', out=0.0025, mirror=False)
    c.side_line([(1.30, 0.42), (3.10, 0.42)], width=0.03, mat='trim', out=0.005)

    door_mirror(c, 1.05, 1.06, 0.84, reach=0.18, l=0.15, h=0.12)
    wiper(c, (0.02, 0.80, 1.06), (0.66, 0.80, 1.03), (0, 0.55, -0.83))
    wiper(c, (-0.68, 0.80, 1.03), (-0.08, 0.80, 1.06), (0, 0.55, -0.83))
    wiper(c, (0.0, 4.9, 1.14), (0.44, 4.9, 1.26), (0, -1, 0))
    exhaust(c, -0.50, 4.62, 0.29)
    underfloor(c, 0.60, 4.30, 0.70, 0.17)
    return c


# ======================================================================================
# 7. one-box van (flat nose, cab-over)
# ======================================================================================
def build_van():
    c = Car('van', wheelbase=2.57, s_front_axle=1.02, wheel_r=0.33, track_f=1.445, track_r=1.425,
            tyre_w=0.185, rim_r=0.178, wheel_style='steel', colors=dict(paint='#eeeeea'))
    R = lower_ring
    rows = [
        R(0.04, 0.80, 0.34, 0.38, 0.86, 1.06, 1.07, tb=0.02, ts=0.0, rl=0.03, lean=0.04, crown=0.004),
        R(0.07, 0.835, 0.32, 0.37, 0.88, 1.09, 1.10, tb=0.03, ts=0.01, rl=0.03, lean=0.03, crown=0.004),
        R(0.14, 0.845, 0.30, 0.36, 0.89, 1.11, 1.115, rl=0.03, crown=0.003),
        R(1.02, 0.845, 0.29, 0.35, 0.90, 1.12, 1.12, rl=0.03, crown=0.0),
        R(4.55, 0.845, 0.30, 0.36, 0.92, 1.13, 1.13, rl=0.03, crown=0.0),
        R(4.645, 0.835, 0.32, 0.37, 0.92, 1.125, 1.125, tb=0.03, rl=0.03, crown=0.0),
        R(4.67, 0.81, 0.34, 0.38, 0.91, 1.12, 1.12, tb=0.02, ts=0.0, rl=0.03, crown=0.0),
    ]
    lower = part_loft(rows, seg_mats=lambda i, j: 'underbody' if j in LOWER_UNDER else 'paint')
    lower = c.cut_arches(lower, 0.375, z_c=0.345)
    c.add(lower, target=True)
    c.body_hw = 0.845

    G = gh_ring
    grows = [
        G(0.10, 0.80, 1.04, 0.77, 1.06, 1.07, ch=0.03, chz=0.0, lean=0.1),
        G(0.13, 0.83, 1.115, 0.815, 1.12, 1.125, ch=0.03, chz=0.0, bow=-0.02),
        G(0.52, 0.835, 1.13, 0.80, 1.90, 1.975, ch=0.10, chz=0.05, bow=-0.02),
        G(1.30, 0.836, 1.13, 0.80, 1.905, 1.98, ch=0.10, chz=0.05),
        G(1.38, 0.836, 1.13, 0.80, 1.905, 1.98, ch=0.10, chz=0.05),
        G(4.60, 0.835, 1.135, 0.80, 1.90, 1.975, ch=0.10, chz=0.05),
        G(4.665, 0.81, 1.13, 0.775, 1.88, 1.95, ch=0.09, chz=0.05),
    ]
    def gmat(i, j):
        if i == 0 and j in GH_ROOF:
            return 'trim'
        if i == 3 and j in GH_SIDE:
            return 'trim'
        return 'paint'
    gh = part_loft(grows, seg_mats=gmat)
    c.add(gh, target=True)

    fsec = [(-0.06, 0.53), (0.0, 0.535), (0.045, 0.52), (0.06, 0.48), (0.062, 0.38), (0.05, 0.33),
            (0.025, 0.315), (-0.06, 0.315)]
    bumper(c, 0.81, 0.065, 0.08, 0.50, fsec, mat='trim', mats=lambda i, j: 'underbody' if j == 7 else 'trim')
    rsec = [(-0.06, 0.55), (0.0, 0.555), (0.05, 0.545), (0.07, 0.52), (0.07, 0.40), (0.055, 0.35),
            (0.025, 0.335), (-0.06, 0.335)]
    bumper(c, 0.81, 4.645, 0.08, 4.12, rsec, rear=True, mat='trim',
           mats=lambda i, j: 'metal' if j == 2 else ('underbody' if j == 7 else 'trim'))

    # glass
    glass_between(c, grows[1], grows[2], [0.04, 0.035, 0.04, 0.025], radius=0.04)
    c.side_decal(T.round_poly([(0.30, 1.16), (0.53, 1.86), (1.31, 1.86), (1.31, 1.16)], 0.03), 'trim', out=0.003)
    c.side_decal(T.round_poly([(0.34, 1.175), (0.545, 1.84), (1.29, 1.84), (1.29, 1.175)], 0.02), 'glass', out=0.006)
    c.side_decal(T.rounded_rect(1.40, 1.16, 4.52, 1.86, 0.035), 'trim', out=0.003)
    c.side_decal(T.rounded_rect(1.43, 1.18, 2.42, 1.84, 0.025), 'glass', out=0.006)
    c.side_decal(T.rounded_rect(2.50, 1.18, 3.48, 1.84, 0.025), 'glass', out=0.006)
    c.side_decal(T.rounded_rect(3.56, 1.18, 4.49, 1.84, 0.025), 'glass', out=0.006)
    c.rear_decal(T.rounded_rect(-0.70, 1.20, 0.70, 1.82, 0.04), 'glass', out=0.005, mirror=False, s=4.67)

    # front: black band with rectangular lamps and grille slats
    c.front_decal(T.rounded_rect(-0.80, 0.62, 0.80, 0.86, 0.02, 1), 'trim', out=0.003, mirror=False)
    c.front_decal(T.rounded_rect(0.46, 0.65, 0.76, 0.83, 0.015, 1), 'headlamp', out=0.008, lamp=('head', 'L'))
    c.decal([(0.78, 0.10, 0.65), (0.88, 0.10, 0.65), (0.88, 0.10, 0.83), (0.78, 0.10, 0.83)],
            (-0.55, 0.84, 0.0), 'indicator', out=0.008, mirror=True)
    for z in (0.67, 0.71, 0.75, 0.79):
        c.front_line([(-0.40, z), (0.40, z)], width=0.016, mat='grille', out=0.006, mirror=False)
    c.front_decal(T.rounded_rect(-0.08, 0.88, 0.08, 0.92, 0.015, 1), 'metal', out=0.006, mirror=False)
    c.front_decal(T.rounded_rect(-0.55, 1.00, 0.55, 1.06, 0.015, 1), 'grille', out=0.004, mirror=False)   # vent
    plate(c, 0.0, 0.43)
    # rear: corner lamps, tailgate lines, plate
    c.rear_decal(T.round_poly([(0.62, 0.55), (0.835, 0.55), (0.835, 1.05), (0.66, 1.05)], 0.015), 'taillamp',
                 out=0.006, lamp=('tail', 'L'), s=4.67)
    c.rear_decal(T.rounded_rect(0.65, 0.88, 0.835, 0.98, 0.01, 1), 'indicator', out=0.009, s=4.67)
    c.rear_decal(T.rounded_rect(0.65, 0.60, 0.835, 0.70, 0.01, 1), 'reverse', out=0.009, s=4.67)
    c.rear_line([(0.60, 0.56), (0.60, 1.92)])
    c.rear_line([(-0.60, 1.92), (0.60, 1.92)], mirror=False)
    c.rear_line([(-0.60, 0.56), (0.60, 0.56)], mirror=False)
    plate(c, 4.70, 0.68, front=False)
    c.rear_decal(T.rounded_rect(-0.10, 0.85, 0.10, 0.88, 0.01, 1), 'metal', out=0.006, mirror=False, s=4.67)
    c.rear_decal(T.rounded_rect(-0.12, 1.88, 0.12, 1.905, 0.006, 1), 'taillamp', out=0.004, mirror=False, s=4.67)

    # doors: front doors, sliding door on the left only, side rubbing strip, handles
    c.side_line([(0.30, 1.12), (0.30, 0.78), (1.34, 0.78)], width=0.007)
    c.side_line([(1.34, 1.13), (1.34, 0.36)], width=0.007)
    c.side_line([(1.40, 1.88), (1.40, 0.36), (2.46, 0.36), (2.46, 1.88)], width=0.007, mirror=False)
    c.side_line([(2.46, 1.10), (3.50, 1.10)], width=0.016, mat='trim', out=0.004, mirror=False)    # slide rail
    c.side_line([(1.40, 0.62), (3.12, 0.62)], width=0.04, mat='trim', out=0.005)
    for s0 in (1.15,):
        c.side_decal(T.rounded_rect(s0, 1.04, s0 + 0.12, 1.07, 0.01, 1), 'trim', out=0.008)
    c.side_decal(T.rounded_rect(1.50, 1.02, 1.64, 1.05, 0.01, 1), 'trim', out=0.008, mirror=False)
    c.side_decal(T.rounded_rect(3.95, 0.86, 4.08, 0.97, 0.015, 1), 'trim', out=0.0025, mirror=False, x=-2.0)
    # gutters along the roof
    c.side_line([(0.53, 1.91), (4.62, 1.91)], width=0.014, mat='paint', out=0.007)

    stalk_mirror(c, (0.82, 0.42, 1.30), (0.98, 0.36, 1.28), w=0.04, h=0.20, l=0.05)
    wiper(c, (0.05, 0.10, 1.20), (0.66, 0.10, 1.20), (0, 0.9, -0.43))
    wiper(c, (-0.66, 0.10, 1.20), (-0.05, 0.10, 1.20), (0, 0.9, -0.43))
    wiper(c, (0.0, 5.2, 1.25), (0.50, 5.2, 1.30), (0, -1, 0))
    mudflap(c, c.s_ra + 0.38, 0.14, 0.36, 0.62, 0.82)
    exhaust(c, -0.50, 4.55, 0.30)
    underfloor(c, 0.30, 4.40, 0.68, 0.25)
    return c


# ======================================================================================
# 8. light box truck (cab-over 2 t with an aluminium van body)
# ======================================================================================
def build_box_truck():
    c = Car('box_truck', wheelbase=2.50, s_front_axle=1.02, wheel_r=0.33, track_f=1.39, track_r=1.22,
            tyre_w=0.175, rim_r=0.19, wheel_style='truck', rear_dual=True,
            colors=dict(paint='#eeeeea', accent='#c3c7cc'))
    c.rear_style = 'truck_rear'
    R = lower_ring
    rows = [
        R(0.05, 0.80, 0.42, 0.46, 1.05, 1.18, 1.19, tb=0.02, ts=0.0, rl=0.03, lean=0.03, crown=0.003),
        R(0.08, 0.835, 0.40, 0.45, 1.07, 1.20, 1.21, tb=0.03, ts=0.01, rl=0.03, lean=0.02, crown=0.003),
        R(0.15, 0.845, 0.38, 0.44, 1.08, 1.22, 1.225, rl=0.03, crown=0.002),
        R(1.50, 0.845, 0.40, 0.45, 1.10, 1.24, 1.24, rl=0.03, crown=0.0),
        R(1.58, 0.83, 0.42, 0.46, 1.10, 1.235, 1.235, tb=0.02, ts=0.0, rl=0.03, crown=0.0),
    ]
    lower = part_loft(rows, seg_mats=lambda i, j: 'underbody' if j in LOWER_UNDER else 'paint')
    cutter = bmesh.new()
    for sg in (1, -1):
        x0, x1 = (0.40, 0.95) if sg > 0 else (-0.95, -0.40)
        T.bm_append(cutter, part_cyl(((x0 + x1) / 2, c.s_fa, 0.33), (1, 0, 0), 0.40, x1 - x0, 20, 'underbody'))
    lower = T.boolean(lower, cutter)
    c.add(lower, target=True)
    c.body_hw = 0.845

    G = gh_ring
    grows = [
        G(0.11, 0.80, 1.18, 0.78, 1.20, 1.21, ch=0.03, chz=0.0, lean=0.08),
        G(0.13, 0.83, 1.235, 0.82, 1.24, 1.245, ch=0.03, chz=0.0, bow=-0.015),
        G(0.36, 0.835, 1.245, 0.80, 2.03, 2.10, ch=0.08, chz=0.05, bow=-0.015),
        G(1.52, 0.835, 1.25, 0.80, 2.03, 2.09, ch=0.08, chz=0.05),
        G(1.58, 0.82, 1.25, 0.785, 2.01, 2.07, ch=0.07, chz=0.05),
    ]
    gh = part_loft(grows, seg_mats=lambda i, j: 'trim' if (i == 0 and j in GH_ROOF) else 'paint')
    c.add(gh, target=True)

    # steel front bumper
    fsec = [(-0.06, 0.64), (0.0, 0.645), (0.05, 0.635), (0.07, 0.60), (0.07, 0.46), (0.055, 0.425),
            (0.02, 0.41), (-0.06, 0.41)]
    bumper(c, 0.82, 0.07, 0.06, 0.40, fsec, mat='metal',
           mats=lambda i, j: 'trim' if j == 5 else ('underbody' if j == 7 else 'metal'))

    # cab glass
    glass_between(c, grows[1], grows[2], [0.04, 0.035, 0.04, 0.025], radius=0.04)
    c.side_decal(T.round_poly([(0.40, 1.28), (0.48, 1.96), (1.44, 1.96), (1.44, 1.28)], 0.03), 'trim', out=0.003)
    c.side_decal(T.round_poly([(0.43, 1.295), (0.505, 1.94), (1.42, 1.94), (1.42, 1.295)], 0.02), 'glass', out=0.006)
    c.side_line([(0.62, 1.30), (0.62, 1.93)], width=0.02, mat='trim', out=0.008)   # vent-wing post
    # front: grille band, corner lamps, emblem
    c.front_decal(T.rounded_rect(-0.82, 0.78, 0.82, 1.10, 0.03, 1), 'trim', out=0.003, mirror=False)
    c.front_decal(T.rounded_rect(0.53, 0.81, 0.79, 0.98, 0.015, 1), 'headlamp', out=0.008, lamp=('head', 'L'))
    c.front_decal(T.rounded_rect(0.53, 1.00, 0.79, 1.07, 0.012, 1), 'indicator', out=0.008)
    for z in (0.84, 0.885, 0.93, 0.975, 1.02, 1.065):
        c.front_line([(-0.48, z), (0.48, z)], width=0.022, mat='grille', out=0.006, mirror=False)
    c.front_decal(T.rounded_rect(-0.20, 1.14, 0.20, 1.18, 0.015, 1), 'metal', out=0.006, mirror=False)
    c.front_decal(T.ellipse(0.66, 0.52, 0.055, 0.035, 8), 'clearlens', out=0.006, s=0.0)
    plate(c, 0.0, 0.53)
    # cab doors, step, handles, corner marker
    c.side_line([(0.36, 1.24), (0.36, 0.78), (1.46, 0.78), (1.46, 1.24)], width=0.008)
    c.side_decal(T.rounded_rect(1.28, 1.15, 1.40, 1.18, 0.01, 1), 'trim', out=0.008)
    c.add(part_box(0.70, 0.85, 1.42, 1.58, 0.48, 0.505, 'trim'), mirror=True)
    c.decal([(0.80, 0.10, 0.66), (0.86, 0.10, 0.66), (0.86, 0.10, 0.74), (0.80, 0.10, 0.74)],
            (-0.7, 0.71, 0.0), 'indicator', out=0.006, mirror=True)
    # big mirrors on stays + under-mirror
    stalk_mirror(c, (0.83, 0.45, 1.60), (1.03, 0.36, 1.55), w=0.05, h=0.32, l=0.06)
    um_c = Vector((0.80, 0.05, 1.93))
    um_n = Vector((-0.30, 0.60, -0.75)).normalized()       # glass looks back and down at the kerb
    c.add(part_beam((0.70, 0.42, 2.055), (0.80, 0.08, 2.10), 0.03, 0.03, (0, 0, 1), 'metal'))
    c.add(part_beam((0.80, 0.08, 2.10), (0.80, 0.06, 1.97), 0.03, 0.03, (0, 1, 0), 'metal'))
    c.add(part_beam((0.835, 0.34, 1.86), (0.80, 0.07, 1.99), 0.024, 0.024, (0, 0, 1), 'metal'))
    c.add(part_cyl(um_c, um_n, 0.055, 0.06, 10, 'trim', r2=0.092))
    c.add(part_cyl(um_c + um_n * 0.031, um_n, 0.080, 0.006, 10, 'glass'))
    wiper(c, (0.06, 0.10, 1.30), (0.70, 0.10, 1.30), (0, 0.96, -0.27))
    wiper(c, (-0.70, 0.10, 1.30), (-0.06, 0.10, 1.30), (0, 0.96, -0.27))

    # ---- chassis --------------------------------------------------------------------------
    s_box0, s_box1 = 1.66, 4.70
    for x in (0.42, -0.42):
        c.add(part_box(x - 0.04, x + 0.04, 0.90, 4.62, 0.50, 0.68, 'underbody'))
    c.add(part_box(-0.50, 0.50, s_box0 + 0.04, s_box1 - 0.04, 0.68, 0.78, 'underbody'))    # sub-frame
    for sx in [s_box0 + 0.20 + 0.42 * k for k in range(7)]:
        c.add(part_box(-0.84, 0.84, sx, sx + 0.06, 0.70, 0.80, 'underbody'))                # cross bearers
    c.add(part_cyl((-0.62, 2.15, 0.56), (0, 1, 0), 0.15, 0.62, 10, 'metal', cap_mat='metal'))  # fuel tank
    c.add(part_box(0.46, 0.72, 1.85, 2.20, 0.42, 0.64, 'trim'))                              # battery box
    for z in (0.45, 0.60):
        c.add(part_beam((0.80, 2.32, z), (0.80, 3.08, z), 0.03, 0.045, (0, 0, 1), 'metal'), mirror=True)
    for sb in (2.34, 3.06):
        c.add(part_box(0.46, 0.80, sb - 0.02, sb + 0.02, 0.44, 0.62, 'underbody'), mirror=True)
    fender_arc(c, c.s_ra, 0.33, 0.37, 0.012, 0.42, 0.80, a0=0, a1=180, n=7)
    mudflap(c, c.s_ra + 0.40, 0.18, 0.62, 0.45, 0.80)
    # rear underrun bar with combination lamps, plate
    c.add(part_box(-0.80, 0.80, 4.58, 4.66, 0.40, 0.50, 'metal'))
    c.add(part_box(0.495, 0.835, 4.60, 4.68, 0.505, 0.675, 'trim'), mirror=True, target=True)
    c.rear_decal(T.rounded_rect(0.60, 0.518, 0.822, 0.662, 0.012, 1), 'taillamp', out=0.005, lamp=('tail', 'L'),
                 s=4.68)
    c.rear_decal(T.rounded_rect(0.508, 0.518, 0.592, 0.662, 0.010, 1), 'indicator', out=0.005, s=4.68)
    c.add(part_box(0.14, 0.48, 4.63, 4.66, 0.49, 0.67, 'trim'), target=True)
    c.rear_decal(T.rounded_rect(0.145, 0.495, 0.475, 0.66, 0.01, 1), 'plate', out=0.004, mirror=False, s=4.66)
    c.rear_decal(T.rounded_rect(-0.30, 0.55, -0.22, 0.62, 0.008, 1), 'reverse', out=0.005, mirror=False, s=4.68)

    # ---- aluminium box body ------------------------------------------------------------------
    hwb = 0.845
    zb0, zb1 = 0.80, 2.50
    box = part_cprism([(s_box0, zb0), (s_box1, zb0), (s_box1, zb1), (s_box0, zb1)], -hwb, hwb, 0.025, 'accent')
    c.add(box, target=True)
    for sx in [s_box0 + 0.52 * k for k in range(1, 6)]:
        c.side_line([(sx, zb0 + 0.10), (sx, zb1 - 0.08)], width=0.02, mat='metal', out=0.004)
    c.side_line([(s_box0 + 0.02, zb1 - 0.04), (s_box1 - 0.02, zb1 - 0.04)], width=0.07, mat='metal', out=0.006)
    c.side_line([(s_box0 + 0.02, zb0 + 0.045), (s_box1 - 0.02, zb0 + 0.045)], width=0.09, mat='metal', out=0.006)
    for sp in (s_box0, s_box1):
        sg = 1 if sp > 3 else -1
        c.add(part_box(hwb - 0.05, hwb + 0.008, sp - 0.05 * (sg > 0) - 0.008 * (sg < 0),
                       sp + 0.008 * (sg > 0) + 0.05 * (sg < 0), zb0, zb1, 'metal'), mirror=True)
    # rear barn doors: split, hinges, locking bars, handles
    c.rear_line([(0.0, zb0 + 0.06), (0.0, zb1 - 0.06)], width=0.012, mirror=False, s=5.2)
    c.rear_line([(-0.80, zb1 - 0.06), (0.80, zb1 - 0.06)], width=0.05, mat='metal', out=0.005, mirror=False, s=5.2)
    for x in (0.18, 0.62):
        c.add(part_beam((x, s_box1 + 0.018, zb0 + 0.10), (x, s_box1 + 0.018, zb1 - 0.10), 0.022, 0.022,
                        (0, 1, 0), 'metal'), mirror=True)
        c.add(part_box(x - 0.025, x + 0.09, s_box1 + 0.008, s_box1 + 0.03, 1.38, 1.42, 'metal'), mirror=True)
    for z in (1.05, 1.65, 2.25):
        c.add(part_box(0.76, 0.84, s_box1 + 0.004, s_box1 + 0.022, z, z + 0.08, 'metal'), mirror=True)
    # marker lamps on the box corners
    c.rear_decal(T.rounded_rect(0.66, 2.40, 0.78, 2.45, 0.008, 1), 'taillamp', out=0.006, s=s_box1)
    c.front_decal(T.rounded_rect(0.66, 2.40, 0.78, 2.45, 0.008, 1), 'headlamp', out=0.006, s=s_box0)
    return c


BUILDERS = {
    'kei_wagon': build_kei_wagon,
    'kei_truck': build_kei_truck,
    'taxi': build_taxi,
    'hatch': build_hatch,
    'sedan': build_sedan,
    'minivan': build_minivan,
    'van': build_van,
    'box_truck': build_box_truck,
}


# ======================================================================================
def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    flags = {a for a in argv if a.startswith('--')}
    names = args or ([] if '--lineup' in flags and '--build' not in flags else list(BUILDERS))
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(RENDER_DIR, exist_ok=True)
    report = {}
    for n in names:
        T.reset_scene()
        car = BUILDERS[n]()
        objs = car.build_objects()
        path = os.path.join(OUT_DIR, 'traffic_%s.glb' % n)
        T.export_glb(objs, path)
        m = T.measure(objs)
        m['body_width'] = 2 * car.body_hw
        report[n] = m
        print('[%s] tris=%d L=%.3f W(body)=%.3f W(mirrors)=%.3f H=%.3f wb=%.3f track=%.3f/%.3f r=%.3f '
              'zmin=%.3f centre_y=%.3f lamps=%s notes=%s' % (
                  n, m['tris'], m['length'], m['body_width'], m['width_overall'], m['height'], m['wheelbase'],
                  m['track_f'], m['track_r'], m['wheel_r'], m['z_min'], m['centre_y'], sorted(car.lamps), car.notes))
    if '--render' in flags:
        for n in names:
            T.render_views(os.path.join(OUT_DIR, 'traffic_%s.glb' % n), os.path.join(RENDER_DIR, n),
                           night='--night' in flags)
    if '--lineup' in flags:
        order = [k for k in ORDER if k in BUILDERS]
        glbs = [os.path.join(OUT_DIR, 'traffic_%s.glb' % k) for k in order]
        T.render_lineup(glbs, os.path.join(RENDER_DIR, 'lineup_side.png'))
        T.render_lineup(glbs, os.path.join(RENDER_DIR, 'lineup_34.png'), view='34', gap=1.2)
    return report


ORDER = ['kei_wagon', 'kei_truck', 'hatch', 'sedan', 'taxi', 'minivan', 'van', 'box_truck']

if __name__ == '__main__':
    argv = sys.argv[1:]
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    main(argv)
