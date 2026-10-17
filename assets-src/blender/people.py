"""
people.py -- builds every DRIVE FM pedestrian from scratch, deterministically.

Run:  /home/claude/.venv-bpy/bin/python assets-src/blender/people.py [--only name,name] [--no-export]

Outputs
  public/assets/people/detail.png          shared 512x512 RGBA detail atlas
  public/assets/people/person_<name>.glb   one skinned variant + its four clips each
  public/assets/people/people.json         manifest (variants, skates flag, tris, height, clips,
                                           speeds, slot names, default + alternate palettes)

Each variant has its own armature with the bone names of docs/ASSET-CONVENTIONS.md
(+ gear bones bag/tie/hair/hair.L/hair.R, present on every variant). Bone rest
orientations follow one convention for all variants (spine/legs vertical, arms in an A-pose
65 degrees below horizontal, feet forward), so a rotation clip from one file plays sensibly on another, but each
file's clips are solved (IK) against that variant's own proportions and gear, with feet
planted against the stated ground speed. Use each file's own clips.
"""

import os
import sys
import math
import json

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy  # noqa: E402,F401  (bpy must load before mathutils)
import numpy as np  # noqa: E402
from mathutils import Vector, Quaternion  # noqa: E402
import people_lib as L  # noqa: E402
from people_lib import V, qx, qy, qz, qaxis, ypr, smooth, smoothstep, lerp, clamp  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(REPO, 'public', 'assets', 'people')
FONTS = os.path.join(REPO, 'assets-src', 'fonts')
FPS = 30

# Clip timing shared by every variant (ground speed = stride / cycle).
WALK_T, WALK_S = 1.10, 1.43        # 1.30 m/s
FAST_T, FAST_S = 0.80, 1.60        # 2.00 m/s
SKATE_T, SKATE_V = 1.60, 3.50      # push-glide, 3.5 m/s
IDLE_T = 4.0

# ======================================================================================
# Detail atlas
# ======================================================================================
ATLAS = 512
INK = '#16111f'
WHITE = '#fbf8f0'

FACE_W, FACE_H, FACE_PPM, FACE_PAD, FACE_EYE = 64, 128, 640.0, 3, 52
LOGO_PPU = 36.0   # logo cells: the design spans +-1 local unit = 72 px; the rest is margin so
                  # big low-poly faces straddling the design edge still map inside the cell
FACE_NAMES = ['cool', 'bright', 'fierce', 'shades', 'cute', 'tired', 'elder', 'mask', 'grin', 'starry', 'stern', 'freckles']
LOGO_CELLS = {'bolt': (256, 128), 'kanji': (384, 128), 'tag': (0, 256), 'star': (128, 256), 'number': (256, 256), 'delivery': (384, 256)}
SHOE_CELLS = {'swoosh': (0, 384), 'bars': (128, 384), 'patch': (0, 448), 'zig': (128, 448)}
MISC_CELLS = {'screen': (256, 384), 'catprint': (320, 384), 'deck': (384, 384)}
BLANK_RECT = (448, 384, 512, 512)
BLANK_UV = (480 / ATLAS, 448 / ATLAS)
SHOE_PPM = 128 / 0.34


def face_rect(i):
    col, row = i % 8, i // 8
    x0, y0 = col * FACE_W, row * FACE_H
    return (x0, y0, x0 + FACE_W, y0 + FACE_H)


def paint_face(cv, i, name):
    x0, y0, x1, y1 = face_rect(i)
    c = cv.cell(x0, y0, x1, y1, x0 + FACE_PAD, y0 + FACE_EYE, FACE_PPM)
    X, Y = np.abs(c.X), c.Y          # mirrored: the face is symmetric about its centre line
    E = 0.0035                       # outline width (m)
    ex, ey = 0.031, 0.0

    def brow(y, x0_, x1_, t, tilt=0.0, col=INK):
        c.paint(L.sd_seg(X, Y, x0_, y + tilt * 0.5, x1_, y - tilt * 0.5, t), col)

    def mouth_line(y, w, t=0.0032, curve=0.0, col=INK):
        # a gentle arc across the centre line
        c.paint(L.sd_seg(X, Y - curve * (X / max(w, 1e-6)) ** 2, 0.0, y, w, y, t), col)

    def eye_round(rx, ry, pupil, look=0.0, glint=True, iris='#3a2418', y=0.0):
        s = L.sd_ellipse(X, Y, ex, y, rx, ry)
        c.paint(s - E * 0.9, INK)
        c.paint(s, WHITE)
        c.paint(L.sd_circle(X, Y, ex - look, y - ry * 0.12, pupil), iris)
        c.paint(L.sd_circle(X, Y, ex - look, y - ry * 0.12, pupil * 0.55), INK)
        if glint:
            c.paint(L.sd_circle(X, Y, ex - look + pupil * 0.45, y + pupil * 0.35, pupil * 0.32), WHITE)

    nose = lambda: c.paint(L.sd_seg(X, Y, 0.0, -0.03, 0.0045, -0.032, 0.0022), '#b0705a', 0.85)

    if name == 'cool':
        s = L.sd_ellipse(X, Y, ex, -0.002, 0.0145, 0.010)
        lid = Y - (0.003 - 0.10 * (X - ex))
        eye = L.inter_(s, lid)
        c.paint(eye - E, INK)
        c.paint(eye, WHITE)
        c.paint(L.inter_(L.sd_circle(X, Y, ex - 0.003, -0.003, 0.0066), lid), INK)
        c.paint(L.sd_seg(X, Y, ex - 0.017, 0.004, ex + 0.016, 0.0055, 0.0034), INK)   # heavy upper lid
        brow(0.024, 0.016, 0.047, 0.0042, tilt=-0.004)
        nose()
        c.paint(L.sd_seg(X, Y, 0.0, -0.058, 0.012, -0.0565, 0.0028), '#6a2a34')
    elif name == 'bright':
        eye_round(0.0135, 0.016, 0.0085, look=0.002)
        c.paint(L.sd_arc(X, Y, ex, 0.012, 0.018, math.radians(40), math.radians(140), 0.0028), INK)
        nose()
        m = L.sd_ellipse(X, Y, 0.0, -0.057, 0.021, 0.0115)
        m = L.inter_(m, Y - (-0.0585 + 16.0 * X * X))   # wide open grin, corners turned up
        c.paint(m - E * 0.8, INK)
        c.paint(m, '#7a1c2c')
        c.paint(L.inter_(L.sd_ellipse(X, Y, 0.0, -0.066, 0.009, 0.004), m), '#ff7a8a')
    elif name == 'fierce':
        s = L.sd_ellipse(X, Y, ex, -0.002, 0.0145, 0.0085)
        lid = Y - (0.004 + 0.18 * (X - ex - 0.01) * -1) * 0.5
        eye = L.inter_(s, Y + 0.0 - (0.006 - 0.25 * (ex - X)))
        c.paint(eye - E, INK)
        c.paint(eye, WHITE)
        c.paint(L.inter_(L.sd_circle(X, Y, ex - 0.004, -0.002, 0.0055), eye), INK)
        c.paint(L.sd_poly(X, Y, [(0.012, 0.012), (0.05, 0.03), (0.048, 0.022), (0.014, 0.006)]), INK)  # angry brow
        nose()
        g = L.sd_box(X, Y, 0.0, -0.06, 0.018, 0.0075, r=0.004)
        c.paint(g - E * 0.8, INK)
        c.paint(g, WHITE)
        c.paint(L.sd_seg(X, Y, 0.0, -0.06, 0.018, -0.06, 0.0011), INK)
        for tx in (0.0, 0.009):
            c.paint(L.sd_seg(X, Y, tx, -0.067, tx, -0.053, 0.001), INK)
    elif name == 'shades':
        lens = L.sd_box(X, Y, ex, -0.001, 0.02, 0.011, r=0.006, rot=0.06)
        bridge = L.sd_seg(X, Y, 0.0, 0.004, 0.015, 0.006, 0.0035)
        c.paint(L.u_(lens, bridge) - 0.002, INK)
        c.paint(lens, '#241d3a')
        c.paint(L.inter_(lens, L.sd_seg(X, Y, ex - 0.015, -0.01, ex + 0.002, 0.012, 0.0028)), '#8fd8ff')
        c.paint(L.inter_(lens, L.sd_seg(X, Y, ex - 0.004, -0.012, ex + 0.011, 0.008, 0.0016)), '#c8f0ff')
        nose()
        c.paint(L.sd_seg(X, Y, 0.0, -0.059, 0.01, -0.058, 0.003), '#6a2a34')
    elif name == 'cute':
        eye_round(0.0125, 0.0165, 0.009, look=0.001, iris='#4a2a60')
        c.paint(L.sd_arc(X, Y, ex, -0.001, 0.017, math.radians(25), math.radians(150), 0.003), INK)
        for k in range(2):  # lashes
            a = math.radians(20 - 18 * k)
            c.paint(L.sd_seg(X, Y, ex + 0.015 * math.cos(a), 0.016 * math.sin(a) + 0.002,
                             ex + 0.022 * math.cos(a), 0.02 * math.sin(a) + 0.006, 0.0018), INK)
        c.paint(L.sd_ellipse(X, Y, 0.043, -0.026, 0.009, 0.005), '#ff6f8a', 0.75)
        brow(0.03, 0.02, 0.042, 0.0022, tilt=-0.003)
        c.paint(L.sd_arc(X, Y, 0.0, -0.05, 0.008, math.radians(210), math.radians(330), 0.0024), '#7a1c2c')
    elif name == 'tired':
        s = L.sd_ellipse(X, Y, ex, -0.002, 0.0135, 0.0095)
        lid = Y - (0.001 - 0.12 * (X - ex))
        eye = L.inter_(s, lid)
        c.paint(eye - E * 0.9, INK)
        c.paint(eye, WHITE)
        c.paint(L.inter_(L.sd_circle(X, Y, ex - 0.002, -0.004, 0.006), eye), INK)
        c.paint(L.sd_seg(X, Y, ex - 0.016, 0.002, ex + 0.015, -0.001, 0.0028), INK)
        c.paint(L.sd_arc(X, Y, ex, -0.006, 0.014, math.radians(215), math.radians(325), 0.0016), '#7a4a6a', 0.9)
        brow(0.026, 0.014, 0.044, 0.0034, tilt=0.008)
        nose()
        c.paint(L.sd_seg(X, Y, 0.0, -0.06, 0.013, -0.062, 0.0026), '#5a2a30')
    elif name == 'elder':
        c.paint(L.sd_arc(X, Y, ex, -0.006, 0.012, math.radians(30), math.radians(150), 0.0032), INK)
        c.paint(L.sd_seg(X, Y, 0.014, 0.022, 0.048, 0.017, 0.0058), '#e8e4dc')
        c.paint(L.sd_seg(X, Y, 0.014, 0.022, 0.048, 0.017, 0.0058) - 0.0015, INK, 0.0)
        g = L.sd_seg(X, Y, 0.014, 0.022, 0.048, 0.017, 0.0058)
        c.paint(g - 0.0018, INK)
        c.paint(g, '#efeae2')
        c.paint(L.sd_arc(X, Y, 0.0, -0.046, 0.016, math.radians(225), math.radians(315), 0.0026), '#6a2a34')
        c.paint(L.sd_arc(X, Y, 0.036, -0.04, 0.012, math.radians(200), math.radians(260), 0.0016), '#9a5a4a', 0.8)
        nose()
        ring = L.sd_circle(X, Y, ex, -0.003, 0.019)
        c.paint(np.abs(ring) - 0.0022, INK)
        c.paint(L.sd_seg(X, Y, 0.0, 0.0, ex - 0.019, 0.0, 0.002), INK)
    elif name == 'mask':
        eye_round(0.012, 0.0125, 0.0072, look=0.002)
        brow(0.024, 0.017, 0.044, 0.003, tilt=-0.004)
        m = L.sd_box(X, Y, 0.0, -0.062, 0.062, 0.036, r=0.02)
        m = L.inter_(m, (-0.03 + 0.12 * X ** 2 * 10) - Y)
        c.paint(m - E, INK)
        c.paint(m, '#f4f6f8')
        for yy in (-0.05, -0.064, -0.078):
            c.paint(L.inter_(L.sd_seg(X, Y, 0.0, yy, 0.06, yy + 0.003, 0.0012), m + 0.004), '#b8c0d0')
        c.paint(L.sd_seg(X, Y, 0.06, -0.045, 0.09, -0.025, 0.0016), WHITE)
    elif name == 'grin':
        c.paint(L.sd_arc(X, Y, ex, -0.008, 0.012, math.radians(25), math.radians(155), 0.0038), INK)
        brow(0.026, 0.017, 0.046, 0.0045, tilt=-0.006)
        m = L.sd_ellipse(X, Y, 0.0, -0.054, 0.026, 0.016)
        m = L.inter_(m, -(Y + 0.051))
        c.paint(m - E * 0.8, INK)
        c.paint(m, WHITE)
        c.paint(L.inter_(L.sd_ellipse(X, Y, 0.0, -0.07, 0.016, 0.007), m), '#d8405a')
        c.paint(L.sd_ellipse(X, Y, 0.045, -0.026, 0.008, 0.004), '#ff6f6f', 0.6)
    elif name == 'starry':
        eye_round(0.0135, 0.0175, 0.0095, look=0.0015, iris='#2a3a8a', glint=False)
        c.paint(L.sd_star(X, Y, ex - 0.0005, 0.002, 0.0055, 0.0024), WHITE)
        c.paint(L.sd_arc(X, Y, ex, 0.0, 0.019, math.radians(30), math.radians(150), 0.0032), INK)
        brow(0.032, 0.02, 0.042, 0.002, tilt=-0.004)
        c.paint(L.sd_ellipse(X, Y, 0.044, -0.026, 0.009, 0.0045), '#ff5f8a', 0.8)
        c.paint(L.sd_arc(X, Y, 0.0045, -0.052, 0.0045, math.radians(180), math.radians(360), 0.0022), '#7a1c2c')
    elif name == 'stern':
        s = L.sd_ellipse(X, Y, ex, -0.001, 0.0135, 0.0085)
        c.paint(s - E, INK)
        c.paint(s, WHITE)
        c.paint(L.sd_circle(X, Y, ex - 0.002, -0.002, 0.0058), INK)
        c.paint(L.sd_box(X, Y, 0.031, 0.02, 0.018, 0.0052, r=0.002, rot=0.18), INK)
        nose()
        c.paint(L.sd_arc(X, Y, 0.0, -0.07, 0.016, math.radians(55), math.radians(125), 0.003), '#5a2a30')
        for k, (px, py) in enumerate([(0.012, -0.075), (0.024, -0.071), (0.034, -0.064), (0.018, -0.083), (0.03, -0.079)]):
            c.paint(L.sd_circle(X, Y, px, py, 0.0016), '#4a3040', 0.7)
    elif name == 'freckles':
        eye_round(0.012, 0.0145, 0.0078, look=0.002)
        brow(0.026, 0.018, 0.043, 0.0032, tilt=-0.006)
        for px, py in ((0.03, -0.025), (0.038, -0.022), (0.045, -0.028), (0.034, -0.031)):
            c.paint(L.sd_circle(X, Y, px, py, 0.0017), '#a0522d', 0.9)
        nose()
        c.paint(L.sd_arc(X, Y, 0.0, -0.047, 0.014, math.radians(220), math.radians(320), 0.003), '#7a1c2c')


def logo_cell(cv, name):
    x0, y0 = LOGO_CELLS[name]
    return cv.cell(x0, y0, x0 + 128, y0 + 128, x0 + 64, y0 + 64, LOGO_PPU)  # logo drawn in +-1; cell spans +-1.78


def paint_logos(cv):
    font = lambda f: os.path.join(FONTS, f)
    # bomber back badge: ring + lightning bolt
    c = logo_cell(cv, 'bolt')
    X, Y = c.X, c.Y
    o = L.sd_circle(X, Y, 0, 0, 0.92)
    c.ink(o, '#ff6a2a', 0.08)
    c.paint(np.abs(L.sd_circle(X, Y, 0, 0, 0.74)) - 0.05, WHITE)
    bolt = L.sd_poly(X, Y, [(0.12, 0.78), (-0.42, -0.05), (-0.04, -0.05), (-0.18, -0.8), (0.44, 0.12), (0.04, 0.12), (0.2, 0.78)])
    c.ink(bolt, '#ffe23a', 0.08)
    # kanji
    c = logo_cell(cv, 'kanji')
    segs, bb = L.text_segments('走', font('DelaGothicOne-400.ttf'))
    sd = L.sd_segments(c.X, c.Y, L.fit_segments(segs, bb, 0.0, 0.0, h=1.55))
    sd_sh = L.sd_segments(c.X, c.Y, L.fit_segments(segs, bb, 0.08, -0.08, h=1.55))
    c.paint(sd_sh - 0.07, INK)
    c.paint(sd_sh, '#ff3d6e')
    c.paint(sd - 0.07, INK)
    c.paint(sd, WHITE)
    # graffiti tag
    c = logo_cell(cv, 'tag')
    segs, bb = L.text_segments('FM', font('SedgwickAveDisplay-400.ttf'))
    sd = L.sd_segments(c.X, c.Y, L.fit_segments(segs, bb, 0.0, 0.12, w=1.8))
    c.paint(sd - 0.11, INK)
    c.paint(sd, '#ff4fa0')
    c.paint(L.inter_(sd + 0.04, -(c.Y - 0.12)), '#ffd84a')
    for dx, ln in ((-0.55, 0.35), (0.1, 0.55), (0.62, 0.28)):
        d = L.sd_seg(c.X, c.Y, dx, -0.25, dx, -0.25 - ln, 0.045)
        c.paint(d - 0.05, INK)
        c.paint(d, '#ff4fa0')
    segs, bb = L.text_segments('DRIVE', font('Bungee-400.ttf'))
    sd = L.sd_segments(c.X, c.Y, L.fit_segments(segs, bb, 0.0, -0.72, w=1.3))
    c.paint(sd - 0.05, INK)
    c.paint(sd, WHITE)
    # star badge
    c = logo_cell(cv, 'star')
    o = L.sd_circle(c.X, c.Y, 0, 0, 0.95)
    c.paint(np.abs(o) - 0.1, INK)
    c.paint(np.abs(o) - 0.05, '#3ad0ff')
    st = L.sd_star(c.X, c.Y, 0, -0.02, 0.78, 0.34)
    c.ink(st, '#ffe23a', 0.08)
    # jersey number
    c = logo_cell(cv, 'number')
    segs, bb = L.text_segments('07', font('Bungee-400.ttf'))
    sd2 = L.sd_segments(c.X, c.Y, L.fit_segments(segs, bb, 0.08, -0.08, h=1.4))
    sd = L.sd_segments(c.X, c.Y, L.fit_segments(segs, bb, 0.0, 0.0, h=1.4))
    c.paint(sd2 - 0.06, INK)
    c.paint(sd2, '#ff3d6e')
    c.paint(sd - 0.06, INK)
    c.paint(sd, WHITE)
    # delivery box logo
    c = logo_cell(cv, 'delivery')
    bx = L.sd_box(c.X, c.Y, 0, 0, 0.95, 0.62, r=0.18)
    c.ink(bx, '#ff3d3d', 0.07)
    ar = L.sd_poly(c.X, c.Y, [(-0.75, 0.32), (0.2, 0.32), (0.2, 0.5), (0.78, 0.18), (0.2, -0.14), (0.2, 0.04), (-0.75, 0.04)])
    c.paint(ar, WHITE)
    segs, bb = L.text_segments('DLV', font('Bungee-400.ttf'))
    sd = L.sd_segments(c.X, c.Y, L.fit_segments(segs, bb, 0.0, -0.33, w=1.1))
    c.paint(sd, WHITE)
    for k in range(3):
        c.paint(L.sd_seg(c.X, c.Y, -0.92 - 0.0, 0.42 - 0.14 * k, -0.78, 0.42 - 0.14 * k, 0.025), WHITE, 0.0)


def paint_shoes(cv):
    for name, (x0, y0) in SHOE_CELLS.items():
        # local metres: u along the shoe (toe +), v up from the ground; origin at the cell centre
        c = cv.cell(x0, y0, x0 + 128, y0 + 64, x0 + 64, y0 + 64, SHOE_PPM)
        X, Y = c.X, c.Y
        if name == 'swoosh':
            sd = L.sd_poly(X, Y, [(-0.075, 0.072), (-0.02, 0.05), (0.06, 0.052), (0.115, 0.075), (0.07, 0.068),
                                  (0.0, 0.07), (-0.05, 0.08), (-0.085, 0.086)])
            c.ink(sd, WHITE, 0.0035)
        elif name == 'bars':
            for k in range(3):
                x = -0.02 + 0.03 * k
                sd = L.sd_poly(X, Y, [(x, 0.042), (x + 0.014, 0.042), (x + 0.044, 0.105), (x + 0.03, 0.105)])
                c.ink(sd, WHITE, 0.003)
        elif name == 'patch':
            sd = L.sd_circle(X, Y, -0.045, 0.09, 0.022)
            c.ink(sd, WHITE, 0.003)
            c.paint(L.sd_star(X, Y, -0.045, 0.089, 0.015, 0.0065), '#2a3a8a')
            c.paint(L.sd_box(X, Y, 0.05, 0.043, 0.09, 0.006), INK, 0.0)
        elif name == 'zig':
            pts = [(-0.08, 0.06), (-0.03, 0.09), (0.0, 0.06), (0.04, 0.095), (0.07, 0.06), (0.11, 0.085)]
            d = None
            for a, b in zip(pts, pts[1:]):
                s = L.sd_seg(X, Y, a[0], a[1], b[0], b[1], 0.0065)
                d = s if d is None else np.minimum(d, s)
            c.ink(d, '#ffe23a', 0.003)


def paint_misc(cv):
    x0, y0 = MISC_CELLS['screen']
    c = cv.cell(x0, y0, x0 + 64, y0 + 128, x0 + 32, y0 + 64, 400.0)
    X, Y = c.X, c.Y
    c.paint(L.sd_box(X, Y, 0, 0, 0.08, 0.16), '#1b1530')
    c.paint(L.sd_box(X, Y, 0, 0.0, 0.07, 0.15, r=0.01), '#3a6aff')
    c.paint(L.sd_box(X, Y, 0, 0.08, 0.07, 0.07, r=0.01), '#8a5aff', 0.8)
    for i in range(3):
        for j in range(4):
            c.paint(L.sd_box(X, Y, -0.04 + 0.04 * i, 0.09 - 0.045 * j, 0.014, 0.014, r=0.005),
                    ['#ffd84a', '#ff5f8a', '#4ae0c0', '#ffffff'][(i + j) % 4])
    # tote print: cat face
    x0, y0 = MISC_CELLS['catprint']
    c = cv.cell(x0, y0, x0 + 64, y0 + 128, x0 + 32, y0 + 64, 200.0)
    X, Y = c.X, c.Y
    head = L.u_(L.sd_ellipse(X, Y, 0, 0, 0.12, 0.095),
                L.sd_poly(X, Y, [(-0.12, 0.02), (-0.1, 0.14), (-0.04, 0.08)]),
                L.sd_poly(X, Y, [(0.12, 0.02), (0.1, 0.14), (0.04, 0.08)]))
    c.ink(head, WHITE, 0.012)
    for sx in (-1, 1):
        c.paint(L.sd_ellipse(X, Y, sx * 0.045, 0.01, 0.014, 0.02), INK)
        for k in (-1, 1):
            c.paint(L.sd_seg(X, Y, sx * 0.08, -0.02 + 0.012 * k, sx * 0.15, -0.015 + 0.03 * k, 0.004), INK)
    c.paint(L.sd_poly(X, Y, [(-0.012, -0.02), (0.012, -0.02), (0.0, -0.034)]), '#ff6f8a')
    segs, bb = L.text_segments('NEKO', os.path.join(FONTS, 'Bungee-400.ttf'))
    sd = L.sd_segments(X, Y, L.fit_segments(segs, bb, 0.0, -0.17, w=0.22))
    c.ink(sd, '#ff3d6e', 0.008)
    # skateboard deck graphic (opaque)
    x0, y0 = MISC_CELLS['deck']
    c = cv.cell(x0, y0, x0 + 64, y0 + 128, x0 + 32, y0 + 64, 128.0)
    X, Y = c.X, c.Y
    c.paint(L.sd_box(X, Y, 0, 0, 1, 1), '#ffd84a')
    for k in range(-4, 5):
        c.paint(L.sd_box(X, Y, 0, k * 0.11, 1, 0.025, rot=0.35), '#ff3d6e')
    fl = L.sd_star(X, Y, 0, 0.0, 0.2, 0.09)
    c.ink(fl, WHITE, 0.03)


def build_atlas(path):
    cv = L.Canvas(ATLAS, ATLAS)
    for i, n in enumerate(FACE_NAMES):
        paint_face(cv, i, n)
    paint_logos(cv)
    paint_shoes(cv)
    paint_misc(cv)
    img = cv.to_u8()
    x0, y0, x1, y1 = BLANK_RECT
    assert img[y0:y1, x0:x1, 3].max() == 0, 'blank cell must stay transparent'
    L.write_png(path, img)
    return img


# ======================================================================================
# Decal helpers
# ======================================================================================

def faces_where(mb, pred, tags=None, mats=None):
    out = []
    for fi in range(len(mb.faces)):
        if tags is not None and mb.ftag[fi] not in tags:
            continue
        if mats is not None and mb.fmat[fi] not in mats:
            continue
        if pred(fi):
            out.append(fi)
    return out


def decal_face(mb, H, face):
    i = FACE_NAMES.index(face)
    rect = face_rect(i)
    sel = [fi for fi in range(H.first_face, H.last_face) if mb.face_normal(fi).y < -0.15]
    org = V(0, 0, H.eye_z)
    n = mb.decal(sel, rect, org, (1, 0, 0), (0, 0, 1), FACE_PPM / H.hs, (rect[0] + FACE_PAD, rect[1] + FACE_EYE),
                 mirror=True, need=(0.0, -0.075 * H.hs, 0.05 * H.hs, 0.035 * H.hs), label='face ' + face)
    return n


def decal_logo(mb, faces, name, origin, ax_u, ax_v, size_m, label=''):
    """Map `faces` so the logo cell's +-1 local square spans size_m metres (half = size_m/2)."""
    x0, y0 = LOGO_CELLS[name]
    ppm = LOGO_PPU / (size_m / 2)
    return mb.decal(faces, (x0, y0, x0 + 128, y0 + 128), origin, ax_u, ax_v, ppm, (x0 + 64, y0 + 64),
                    need=(-0.85 * size_m / 2, -0.85 * size_m / 2, 0.85 * size_m / 2, 0.85 * size_m / 2), label=label or name)


def decal_shoes(mb, J, rng, name):
    x0, y0 = SHOE_CELLS[name]
    for s in ('L', 'R'):
        f0, f1 = rng[s]
        sel = [fi for fi in range(f0, f1) if abs(mb.face_normal(fi).x) > 0.5]
        org = V(J['ankle.' + s].x, -0.09, 0.0)
        mb.decal(sel, (x0, y0, x0 + 128, y0 + 64), org, (0, -1, 0), (0, 0, 1), SHOE_PPM, (x0 + 64, y0 + 64),
                 need=(-0.07, 0.045, 0.1, 0.1), label='shoe ' + name)


def decal_misc(mb, faces, name, origin, ax_u, ax_v, ppm, label=''):
    x0, y0 = MISC_CELLS[name]
    return mb.decal(faces, (x0, y0, x0 + 64, y0 + 128), origin, ax_u, ax_v, ppm, (x0 + 32, y0 + 64), label=label or name)


def logo_print(mb, surf, name, zc, thc, size, wfn, mat='top', off=0.004, n=5, label=''):
    """Logo printed on a garment: a single-sided sheet following TorsoSurf `surf` around
    (zc, thc), fully mapped to the logo cell (so no face straddles the cell edge)."""
    p0, n0 = surf.at(zc, thc, 0.0)
    pa, pb = surf.at(zc, thc + 1.0, 0.0)[0], surf.at(zc, thc - 1.0, 0.0)[0]
    m_per_deg = (pa - pb).length / 2.0
    ax_u = (pb - pa).normalized()                     # viewer's right when facing the print
    ax_v = Vector((0, 0, 1)) - n0 * n0.z
    ax_v.normalize()
    half = size * 0.5 * 1.7       # cell spans +-1.78 logo units; designs reach ~+-1.3
    S = lambda u, v: surf.at(lerp(zc - half, zc + half, u), thc + lerp(1, -1, v) * half / m_per_deg, 0.0)
    ts = [i / (n - 1) for i in range(n)]
    faces = L.sticker(mb, S, ts, ts, off, mat, wfn, tag='print', name='print_' + name)
    k = decal_logo(mb, faces, name, p0 + n0 * off, ax_u, ax_v, size, label or name)
    if k != len(faces):
        print(f'  [print {name}] only {k}/{len(faces)} faces mapped')
    return faces


# ======================================================================================
# Variants
# ======================================================================================

VARIANTS = {}


def variant(fn):
    VARIANTS[fn.__name__] = fn
    return fn


def std_neck_head(mb, J, W, hs=1.0, ears=False, neck_r=0.042, **kw):
    L.build_neck(mb, J, W, r=neck_r)
    return L.build_head(mb, J, W, hs=hs, ears=ears, **kw)


def upper_rings(J, b, chw, chf, chb, sh_extra=0.012, p=2.5, neck_hw=0.078, top_k=0.62):
    """Chest -> shoulder -> neck rings for a torso garment. The torso shoulder stays just
    outside the shoulder joint and is rounded; the sleeve cap forms the visible shoulder."""
    cz, shz, nz = J['chest'].z, J['sh_z'], J['neck'].z
    shw = b.shoulder_w + sh_extra
    return [(cz + 0.055, chw, chf, chb, 0.0, p),
            (shz - 0.02, shw, chf * 0.9, chb * 0.94, 0.0, 2.3),
            (shz + 0.035, shw * top_k, chf * 0.7, chb * 0.8, 0.004, 2.3),
            (nz + 0.028, neck_hw, neck_hw * 0.94, neck_hw * 1.06, 0.006, 2.4)]


def sleeve_rings(b, r_top, r_elbow, r_cuff, start=-0.075, cuff_back=0.035):
    ua, fa = b.upper_arm, b.forearm
    end = ua + fa - cuff_back
    return [(start, r_top * 0.45, r_top * 0.55, r_top * 0.55, r_top * 0.5),
            (start * 0.4, r_top * 0.86, r_top * 0.9, r_top * 0.9, r_top * 0.86),
            (0.02, r_top, r_top, r_top, r_top * 0.96),
            (0.12, r_top * 0.97, r_top * 0.96, r_top * 0.95, r_top * 0.93),
            (ua - 0.04, r_elbow, r_elbow, r_elbow * 0.97, r_elbow * 0.96),
            (ua + 0.035, r_elbow * 0.97, r_elbow, r_elbow * 0.96, r_elbow * 0.94),
            (end - 0.06, lerp(r_elbow, r_cuff, 0.6), lerp(r_elbow, r_cuff, 0.6), lerp(r_elbow, r_cuff, 0.6), lerp(r_elbow, r_cuff, 0.6)),
            (end, r_cuff, r_cuff, r_cuff, r_cuff)]


def rib_ring(mb, z0, z1, hw, fr, bk, mat, wfn, n=12, inner=0.82, yoff=0.0, p=2.6, name='rib'):
    rr = []
    for z, k in ((z0, 1.0), (z1, 1.0), (z1, inner), (z0, inner)):
        rr.append(L.ring((0, -yoff, z), (0, 0, 1), L.prof(n, hw * k, fr * k, bk * k, p=p), wfn))
    mb.loft(rr, mat, closed=True, name=name)


def cuff(mb, J, W, s, b, r, length=0.05, mat='top2', back=0.035):
    end = b.upper_arm + b.forearm - back
    L.build_sleeve(mb, J, W, s, [(end - length + 0.012, r, r, r, r), (end + 0.012, r * 0.96, r * 0.96, r * 0.96, r * 0.96)], mat, n=8, name='cuff')


def spiky_hair(mb, H, spikes, hem, thick, n=14, rows=4):
    outer, angles, top = L.hair_cap(mb, H, hem, thick, n=n, rows=rows)
    for th, t, ln, r, sweep in spikes:
        z = lerp(hem(th), H.rings[-1][0], t)
        p, nrm = H.hair_surf.at(z, th, thick(th, t) - 0.014)
        d = (nrm * 0.5 + Vector((0, sweep * 1.25, 0.42))).normalized()
        L.cone(mb, p, p + d * ln, r, 'hair', {'head': 1.0}, n=4, rot=45)
    return top


def hair_clumps(mb, H, hem, thick, spec, mat='hair', w=None, sink=0.012, name='clump'):
    """Flattened, bent hair locks lying on the cap. spec rows:
    (th, t, length, width, lift, side[, bend]) -- th/t place the root on the cap (t 0 = hem,
    1 = crown); the lock runs 'down' the skull (towards the hem), lifted off the surface by
    `lift` rad and turned by `side` rad (+ = towards larger th); bend curls the tip outward."""
    w = w or {'head': 1.0}
    zt = H.rings[-1][0]
    for row in spec:
        th, t, ln, wd, lift, side = row[:6]
        bend = row[6] if len(row) > 6 else 0.0
        z = lerp(hem(th), zt, t)
        p, nrm = H.hair_surf.at(z, th, thick(th, t) - sink)
        e = 0.004
        tz = H.hair_surf.at(min(z + e, zt), th)[0] - H.hair_surf.at(z - e, th)[0]
        down = -(tz - nrm * tz.dot(nrm)).normalized()
        lat = nrm.cross(down).normalized()
        d0 = down * math.cos(lift) + nrm * math.sin(lift)
        d = (d0 * math.cos(side) - lat * math.sin(side)).normalized()
        tip = p + d * ln + nrm * bend * ln
        mid = p + d * ln * 0.5 + nrm * (0.012 + bend * ln * 0.2)
        L.cone(mb, p, tip, wd, mat, w, n=4, ry=wd * 0.42, mid=mid, up=nrm, name=name)


# --------------------------------------------------------------------------------------
# Garment / gear helpers
# --------------------------------------------------------------------------------------

def torso_garment(mb, J, W, rings, mat='top', skirt=0.12, n=16, strips=None, strip_mat='accent', strip_rows=None,
                  tag='torso', name='torso', warp=None, matfn=None):
    angs, edges = (L.angles_with_strips(n, strips) if strips else (None, []))

    def mf(i, k):
        if matfn:
            m = matfn(i, k, angs)
            if m:
                return m
        if k in edges and (strip_rows is None or strip_rows[0] <= i < strip_rows[1]):
            return strip_mat
        return mat
    L.vertical_loft(mb, rings, mat, lambda q: W.torso(q, skirt=skirt), n=n, angles=angs, tag=tag, name=name,
                    matfn=mf, warp=warp)
    return L.TorsoSurf([r[:6] for r in rings])


def pelvis(mb, J, W, hw=0.16, fr=0.11, bk=0.122, top=None, crotch=0.085, mat='bottom', n=12):
    hipz, hz = J['hip_z'], J['hips'].z
    top = hz + 0.03 if top is None else top
    pr = [(hipz - crotch, hw * 0.42, fr * 0.5, bk * 0.53, 0.0, 2.2), (hipz - 0.04, hw * 0.92, fr * 0.92, bk * 0.93, 0.0, 2.4),
          (hipz, hw, fr, bk, 0.0, 2.5), (top, hw * 0.93, fr * 0.92, bk * 0.9, 0.0, 2.5)]
    L.vertical_loft(mb, pr, mat, lambda q: W.torso(q, skirt=0.4), n=n, name='pelvis')


def trousers(mb, J, W, s, r_hip, r_knee, r_hem, hem_z=None, mat='bottom', bunch=0.0, flare=0.0, foot=0.3, n=8,
             angles=None, matfn=None, x_knee=0.012, tag='leg', top=None):
    hipz, kz, az = J['hip_z'], J['knee.L'].z, J['ankle.L'].z
    hem_z = az - 0.012 if hem_z is None else hem_z
    rh, rk, re = r_hip, r_knee, r_hem
    rings = [(hipz + 0.07 if top is None else top, rh * 0.95, rh * 0.86, rh * 0.95, rh * 1.04, 0.0, 0.0),
             (hipz - 0.06, rh, rh * 0.9, rh, rh * 1.06, 0.01, 0.0),
             (kz + 0.08, lerp(rh, rk, 0.7), lerp(rh, rk, 0.7) * 0.92, lerp(rh, rk, 0.7), lerp(rh, rk, 0.7) * 1.03, x_knee, 0.004),
             (kz, rk, rk * 0.92, rk * 1.03, rk, x_knee, 0.01),
             (kz - 0.08, rk * 0.99, rk * 0.92, rk, rk * 1.02, x_knee, 0.006)]
    if hem_z < kz - 0.2:
        rings += [(hem_z + 0.12, lerp(rk, re, 0.8), lerp(rk, re, 0.8) * 0.95, lerp(rk, re, 0.8) * 1.04, lerp(rk, re, 0.8) * 1.02, x_knee * 0.8, 0.0),
                  (hem_z + 0.04, re * (1 + bunch), re * (1 + bunch) * 0.95, re * (1 + bunch) * 1.06, re * (1 + bunch), x_knee * 0.6, -0.008),
                  (hem_z, re * (1 + bunch * 0.6), re * 0.9 * (1 + bunch * 0.6), re * (1 + bunch * 0.6), re * 0.94, x_knee * 0.6, -0.01)]
    else:
        rings += [(hem_z + 0.03, re, re * 0.93, re * 1.02, re * 1.02, x_knee, 0.004), (hem_z, re * 1.02, re * 0.95, re * 1.03, re * 1.03, x_knee, 0.004)]
    rings = [r for r in rings if r[0] >= hem_z - 1e-6]
    return L.build_leg(mb, J, W, s, rings, mat, foot=foot if hem_z < az + 0.1 else 0.0, name='trouser', tag=tag, n=n,
                       angles=angles, matfn=matfn)


def bare_leg(mb, J, W, s, z_top, z_bot, mat='skin', r_thigh=0.072, r_calf=0.058, r_ank=0.042, n=8):
    hipz, kz, az = J['hip_z'], J['knee.L'].z, J['ankle.L'].z
    rings = []
    for z, r, yo in ((hipz + 0.05, r_thigh, 0.0), (hipz - 0.12, r_thigh * 0.95, 0.0), (kz + 0.07, r_thigh * 0.78, 0.004),
                     (kz, r_thigh * 0.7, 0.012), (kz - 0.09, r_calf, -0.006), (kz - 0.2, r_calf * 0.86, -0.004),
                     (az + 0.06, r_ank, 0.0), (az - 0.01, r_ank * 0.95, 0.0)):
        if z_bot - 0.001 <= z <= z_top + 0.001:
            rings.append((z, r, r * 0.92, r * 0.95, r * 1.08, 0.004, yo))
    if rings[0][0] < z_top - 0.01:
        r0 = rings[0]
        rings.insert(0, (z_top,) + r0[1:])
    if rings[-1][0] > z_bot + 0.01:
        r1 = rings[-1]
        rings.append((z_bot,) + r1[1:])
    return L.build_leg(mb, J, W, s, rings, mat, foot=0.2, name='bareleg', n=n)


def skirt(mb, J, W, z_top, z_hem, top=(0.15, 0.1, 0.11), hem=(0.24, 0.2, 0.21), pleats=0, n=16, mat='bottom', k=0.75,
          bulge=0.0, name='skirt', matfn=None):
    rings = []
    m = 4
    for i in range(m):
        t = i / (m - 1)
        z = lerp(z_top, z_hem, t)
        e = t ** 0.8
        hw, fr, bk = (lerp(a, b, e) for a, b in zip(top, hem))
        hw *= 1 + bulge * math.sin(math.pi * t)
        warp = None
        if pleats:
            amp = 0.06 * t
            warp = (lambda kk, th, x, y, amp=amp: (x * (1 + amp * (1 if kk % 2 else -1)), y * (1 + amp * (1 if kk % 2 else -1))))
        pts = L.prof(n, hw, fr, bk, p=2.3, warp=warp)
        rings.append(L.ring((0, 0, z), (0, 0, -1), pts, lambda q: W.torso(q, skirt=k), lat=(1, 0, 0)))
    mb.loft(rings, mat, name=name, flat=bool(pleats), matfn=matfn, tag='skirt')


def strip_matfn(edges, mat_strip, mat):
    return lambda i, k: mat_strip if k in edges else mat


def head_band(mb, H, z0, z1, out, inn, mat, n=14, w=None, flat=False, name='band'):
    w = w or {'head': 1.0}
    angles = [90.0 + 360.0 * k / n for k in range(n)]
    rows = []
    for z, off in ((z0, out), (z1, out), (z1, inn), (z0, inn)):
        rows.append([H.hair_surf.at(z, th, off)[0] for th in angles])
    first = mb.begin()
    idx = [[mb.v(p, w) for p in r] for r in rows]
    for i in range(4):
        a, b = idx[i], idx[(i + 1) % 4]
        for k in range(n):
            k1 = (k + 1) % n
            mb.f([a[k], a[k1], b[k1], b[k]], mat, flat, 'hat')
    mb.end(first, name)


def cap_brim(mb, H, z, crown_off, length, width_deg, dir_deg=90.0, tilt=-0.2, mat='accent', thick=0.013, m=9, flat=True):
    inner, outer = [], []
    for k in range(m):
        th = dir_deg - width_deg / 2 + width_deg * k / (m - 1)
        p, n = H.hair_surf.at(z, th, crown_off - 0.012)
        f = math.sin(math.pi * k / (m - 1)) ** 0.6
        nh = Vector((n.x, n.y, 0)).normalized()
        o = p + nh * (0.016 + length * f) + Vector((0, 0, tilt * length * f))
        inner.append(p)
        outer.append(o)
    L.slab_strip(mb, inner, outer, (0, 0, thick), mat, {'head': 1.0}, flat=flat, name='brim', tag='hat')


def hair_hem(H, front, side, back, bangs=0.0, nzig=14, side_angle=40.0):
    """Hem height function: front (z at the front centre), side (z at the ears), back (nape).
    bangs > 0 adds a zigzag to the front vertices (spiky fringe)."""
    def hem(th):
        sn = math.sin(math.radians(th))
        if sn >= 0:
            # front half: stay at `front` within +-side_angle of the centre, then drop to `side`
            a = abs(90.0 - (th % 360.0))
            t = smoothstep(side_angle, side_angle + 35.0, a)
            z = lerp(front, side, t)
            if bangs and a < side_angle + 10:
                k = int(round((th - 90.0) / (360.0 / nzig)))
                z -= bangs if k % 2 == 0 else 0.0
            return z
        return lerp(side, back, -sn)
    return hem


def phone(mb, J, s, k=1.2):
    W0, a, f, n = L.hand_frame(J, s)
    c = W0 + a * 0.085 * k + n * 0.026 * k
    w = {'hand.' + s: 1.0}
    f0 = len(mb.faces)
    L.box(mb, c, f, a, n, 0.036, 0.074, 0.006, 'gear', w, bevel=0.008, name='phone',
          matfn=lambda t: 'detail')
    # map the screen (top face, normal = palm normal) to the screen cell
    sel = [fi for fi in range(f0, len(mb.faces)) if mb.fmat[fi] == 'detail']
    decal_misc(mb, sel, 'screen', c, f, a, 400.0)


def hanging_bag_mode(s, grip_rest, swing=0.12, lag=0.15, side=0.06):
    """bag bone hangs from the hand grip like a pendulum (briefcase, skateboard)."""
    def f(rig, J, st, c, ph, kind):
        a = swing * math.sin(2 * TAU * ph - lag * TAU) if kind != 'idle' else 0.02 * math.sin(TAU * ph)
        b = side * math.sin(TAU * ph - 0.2) if kind != 'idle' else 0.0

        def G_bag(G):
            grip = G['hand.' + s] @ grip_rest
            fw = G['hips'].to_quaternion() @ Vector((0, -1, 0))
            yaw = math.atan2(fw.x, -fw.y)
            return L.T(grip) @ L.M4(qz(yaw) @ qx(a) @ qy(b)) @ L.T(-grip_rest)
        c['bag'] = G_bag
    return f


def pivot_bag_mode(bone, pivot_rest, swing=0.1, side=0.08, lag=0.1, bounce=0.0):
    """bag bone swings about a point carried by `bone` (crossbody bag, shoulder bag, backpack)."""
    def f(rig, J, st, c, ph, kind):
        k = 1.0 if kind == 'walk' else (1.6 if kind == 'skate' else 0.15)
        a = swing * k * math.sin(2 * TAU * ph - lag * TAU)
        b = side * k * math.sin(TAU * ph - lag * TAU)

        def G_bag(G):
            pv = G[bone] @ pivot_rest
            R = G[bone].to_quaternion()
            return L.T(pv) @ L.M4(R @ qx(a) @ qy(b)) @ L.T(-pivot_rest)
        c['bag'] = G_bag
    return f


def mode_hold(swing_k=0.35, elbow=0.1, out=None):
    def f(rig, J, st, s, ph, sw, shq):
        return L.arm_fk(J, s, sw * swing_k, elbow, st, out=out, shq=shq)
    return f


def mode_ik(frame, point, pole, hand=None, hand_abs=None, swing=0.0, twist=0.0):
    """IK arm whose wrist target is `point` (rest coords) carried by bone `frame`."""
    def f(rig, J, st, s, ph, sw, shq):
        sx = 1 if s == 'L' else -1
        pt = Vector(point) if s == 'L' else Vector((-point[0], point[1], point[2]))
        pl = Vector(pole) if s == 'L' else Vector((-pole[0], pole[1], pole[2]))
        off = Vector((0, -swing * sw, 0))
        out = dict(mode='ik', sh=shq, target=lambda G: G[frame] @ (pt + off),
                   pole=lambda G: (G[frame].to_quaternion() @ pl).normalized(), twist=twist * sx)
        if hand_abs:
            out['hand_abs'] = lambda G: hand_abs(G, J, s)
        else:
            bend = J['arm_dir.' + s].cross(Vector((0, -1, 0))).normalized()
            out['hand'] = qaxis(bend, hand if hand is not None else 0.1)
        return out
    return f


def hand_dir(frame, fingers, palm):
    """hand_abs for mode_ik: fingers / palm-normal directions (left side, mirrored for the
    right) expressed in the rest frame carried by bone `frame`."""
    def f(G, J, s):
        sx = 1 if s == 'L' else -1
        a_c = Vector((fingers[0] * sx, fingers[1], fingers[2])).normalized()
        n_c = Vector((palm[0] * sx, palm[1], palm[2]))
        n_c = (n_c - a_c * n_c.dot(a_c)).normalized()
        W0, a, fw, n = L.hand_frame(J, s)
        f_c = n_c.cross(a_c) * sx
        return G[frame].to_quaternion() @ L.frame_rot(a, fw, a_c, f_c)
    return f


def phone_idle(J):
    def hand_abs(G, J_, s):
        sx = 1 if s == 'L' else -1
        W0, a, f, n = L.hand_frame(J, s)
        a_c = Vector((-sx * 0.55, -0.75, 0.38)).normalized()     # fingers forward/inward, tipped up
        n_c = Vector((sx * 0.25, 0.45, 0.86)).normalized()       # palm (screen) up toward the face
        n_c = (n_c - a_c * n_c.dot(a_c)).normalized()
        f_c = n_c.cross(a_c) * sx
        R = L.frame_rot(a, f, a_c, f_c)
        return G['chest'].to_quaternion() @ R
    return mode_ik('chest', (0.07, -0.25, J['chest'].z - 0.05), (0.7, 0.2, -1.0), hand_abs=hand_abs)


TAU = math.tau


@variant
def bomber():
    b = L.Build(shin=0.43, thigh=0.44, upper_arm=0.30, forearm=0.27, shoulder_w=0.19)
    colors = dict(skin='#e8b48e', hair='#2a2030', top='#56703c', top2='#ff7a2a', bottom='#2a2a35',
                  shoes='#f4f4f0', accent='#ff5a3c', gear='#1d1d26', detail='#ffffff')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz = J['hips'].z, J['spine'].z, J['chest'].z, J['neck'].z, J['sh_z'], J['hip_z']
        kz, az = J['knee.L'].z, J['ankle.L'].z
        # --- jacket body: blouses out above a tight rib hem, zip strip down the front
        angs, (zip_k,) = L.angles_with_strips(16, [(90.0, 3.2)])
        jr = [(hz - 0.005, 0.165, 0.115, 0.118, 0.0, 2.4), (hz + 0.05, 0.198, 0.138, 0.136, 0.0, 2.4),
              (sz + 0.06, 0.212, 0.146, 0.14, 0.0, 2.5)] + upper_rings(J, b, 0.222, 0.148, 0.142, sh_extra=0.035)
        L.vertical_loft(mb, jr, 'top', lambda q: W.torso(q, skirt=0.12), angles=angs, tag='torso', name='jacket',
                        matfn=lambda i, k: 'accent' if (k == zip_k and 0 <= i < len(jr) - 2) else 'top')
        rib_ring(mb, hz - 0.05, hz + 0.012, 0.172, 0.12, 0.122, 'top2', lambda q: W.torso(q, skirt=0.12), n=16, name='hemband')
        rib_ring(mb, nz - 0.005, nz + 0.055, 0.086, 0.082, 0.09, 'top2', lambda q: W.torso(q), n=10, inner=0.78, yoff=-0.004, name='collar')
        # --- sleeves (puffy, drop shoulder), rib cuffs, hands, sleeve pocket
        for s in ('L', 'R'):
            L.build_sleeve(mb, J, W, s, sleeve_rings(b, 0.094, 0.084, 0.066), 'top', tag='sleeve')
            cuff(mb, J, W, s, b, 0.056)
            L.build_hand(mb, J, W, s, sc=1.22)
        d = J['arm_dir.L']
        out = Vector((-d.z, 0, d.x)).normalized()   # outer side of the left upper arm
        L.box(mb, J['sh.L'] + d * 0.15 + out * 0.088, (0, -1, 0), d, out, 0.034, 0.046, 0.014, 'top',
              lambda q: W.arm('L', q), bevel=0.01, name='armpocket')
        # --- cargo trousers
        pr = [(hipz - 0.085, 0.07, 0.055, 0.065, 0.0, 2.2), (hipz - 0.04, 0.152, 0.104, 0.118, 0.0, 2.4),
              (hipz, 0.168, 0.115, 0.128, 0.0, 2.5), (hz + 0.03, 0.152, 0.105, 0.114, 0.0, 2.5)]
        L.vertical_loft(mb, pr, 'bottom', lambda q: W.torso(q, skirt=0.4), n=12, name='pelvis')
        for s in ('L', 'R'):
            sx = 1 if s == 'L' else -1
            L.build_leg(mb, J, W, s, [(hipz + 0.07, 0.10, 0.09, 0.10, 0.11, 0.0, 0.0),
                                      (hipz - 0.06, 0.106, 0.096, 0.106, 0.112, 0.01, 0.0),
                                      (kz + 0.08, 0.1, 0.092, 0.1, 0.104, 0.012, 0.004),
                                      (kz, 0.098, 0.09, 0.101, 0.1, 0.012, 0.01),
                                      (kz - 0.08, 0.097, 0.09, 0.098, 0.1, 0.012, 0.006),
                                      (az + 0.11, 0.1, 0.095, 0.104, 0.104, 0.01, 0.0),
                                      (az + 0.03, 0.108, 0.1, 0.114, 0.104, 0.008, -0.008),
                                      (az - 0.012, 0.098, 0.09, 0.106, 0.094, 0.008, -0.01)],
                        'bottom', foot=0.3, name='trouser', tag='leg')
            x = J['hipj.' + s].x + sx * (0.01 + 0.105)
            pz = kz + 0.17
            L.box(mb, (x, 0.0, pz), (0, -1, 0), (0, 0, 1), (sx, 0, 0), 0.058, 0.07, 0.016, 'bottom',
                  lambda q, s=s: W.leg(s, q), bevel=0.014, name='pocket')
            L.box(mb, (x + sx * 0.012, 0.0, pz + 0.068), (0, -1, 0), (0, 0, 1), (sx, 0, 0), 0.062, 0.022, 0.012, 'bottom',
                  lambda q, s=s: W.leg(s, q), bevel=0.008, name='flap')
        rng = {s: L.build_shoe(mb, J, W, s, 'sneaker') for s in ('L', 'R')}
        # --- head, swept spiky hair, headphones
        H = std_neck_head(mb, J, W)
        hem_front = H.eye_z + 0.042

        def hem(th):
            f = max(0.0, math.sin(math.radians(th)))
            return lerp(H.O.z + 0.03, hem_front, f ** 1.2)
        thick = lambda th, t: 0.022 + 0.022 * t + 0.016 * max(0.0, -math.sin(math.radians(th)))
        spikes = [(90, 0.55, 0.13, 0.042, -0.35), (64, 0.5, 0.12, 0.04, -0.15), (116, 0.5, 0.12, 0.04, -0.15),
                  (90, 0.95, 0.15, 0.045, 0.55), (50, 0.85, 0.14, 0.042, 0.7), (130, 0.85, 0.14, 0.042, 0.7),
                  (15, 0.7, 0.13, 0.04, 0.9), (165, 0.7, 0.13, 0.04, 0.9), (300, 0.75, 0.15, 0.045, 1.1),
                  (240, 0.75, 0.15, 0.045, 1.1), (270, 0.45, 0.13, 0.042, 1.2), (330, 0.4, 0.11, 0.038, 1.0),
                  (210, 0.4, 0.11, 0.038, 1.0)]
        top = spiky_hair(mb, H, spikes, hem, thick)
        L.headphones(mb, H, top_z=H.top_z + 0.045, side_x=H.half_w + 0.035, ear_y=0.012, ear_z=H.O.z + 0.06)
        # --- decals
        decal_face(mb, H, 'cool')
        back = faces_where(mb, lambda fi: mb.face_normal(fi).y > 0.5, tags=['torso'])
        decal_logo(mb, back, 'bolt', V(0, 0.2, (sz + shz) / 2 + 0.02), (-1, 0, 0), (0, 0, 1), 0.28, 'back badge')
        decal_shoes(mb, J, rng, 'swoosh')

    walk = dict(chest_yaw=0.38, arm_swing=0.46, arm_out=0.2, elbow=0.22, elbow_swing=0.22, sh_fwd=0.16, lean=-0.02, head_bob=0.035)
    return dict(build=b, parts=parts, colors=colors, walk=walk, fast=dict(lean=0.08, arm_swing=0.55),
                idle=dict(look=0.5), extras={}, skates=False)


def Z(J):
    return (J['hips'].z, J['spine'].z, J['chest'].z, J['neck'].z, J['sh_z'], J['hip_z'], J['knee.L'].z, J['ankle.L'].z)


def messy_hair(mb, H, clumps, front=None, side=None, back=None, bangs=0.016, base=0.026, top=0.02, n=14):
    hem = hair_hem(H, front or H.eye_z + 0.032, side or H.O.z + 0.055, back or H.O.z + 0.02, bangs=bangs)
    thick = lambda th, t: base + top * t
    L.hair_cap(mb, H, hem, thick, n=n, rows=4)
    for th, t, ln, r, dv in clumps:
        z = lerp(hem(th), H.rings[-1][0], t)
        p, nrm = H.hair_surf.at(z, th, thick(th, t) - 0.016)
        d = (nrm + Vector(dv)).normalized()
        L.cone(mb, p, p + d * ln, r, 'hair', {'head': 1.0}, n=4, rot=45, ry=r * 0.7)
    return hem, thick


@variant
def hoodie():
    b = L.Build(shin=0.44, thigh=0.44, upper_arm=0.30, forearm=0.27, shoulder_w=0.178, hip_w=0.088,
                ankle_h=0.165, ball_h=0.11, skates=True)
    colors = dict(skin='#c98e68', hair='#3a2a20', top='#3d7bd8', top2='#f2f0e8', bottom='#24242e',
                  shoes='#f0eee8', accent='#ffd23a', gear='#26262f')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        jr = [(hipz - 0.075, 0.214, 0.142, 0.15, 0.0, 2.6), (hipz + 0.0, 0.214, 0.146, 0.148, 0.0, 2.5),
              (sz + 0.03, 0.206, 0.142, 0.138, 0.0, 2.5)] + upper_rings(J, b, 0.212, 0.145, 0.14, sh_extra=0.03)
        torso = torso_garment(mb, J, W, jr, skirt=0.3)
        rib_ring(mb, hipz - 0.112, hipz - 0.06, 0.208, 0.136, 0.144, 'top', lambda q: W.torso(q, skirt=0.3), n=12, p=2.8, name='hem')
        # kangaroo pocket
        z0, z1 = hipz - 0.05, sz + 0.0
        S = lambda u, v: torso.at(lerp(z0, z1, u), 90 + lerp(-1, 1, v) * lerp(33, 23, u))
        L.patch(mb, S, [0, 0.5, 1], [0, 0.25, 0.5, 0.75, 1], 0.012, -0.01, 'top', lambda q: W.torso(q, skirt=0.3), name='pouch')
        # hood (down): fat roll around the back of the neck
        path = []
        for i in range(9):
            a = math.radians(-35 + 250 * i / 8)
            path.append(V(0.105 * math.cos(a), 0.03 + 0.075 * math.sin(a), nz - 0.015 + 0.012 * math.sin(a)))
        rad = [0.03, 0.042, 0.05, 0.055, 0.058, 0.055, 0.05, 0.042, 0.03]
        L.tube_path(mb, [V(pp.x, pp.y, pp.z) for pp in path], rad, 'top', lambda q: W.torso(q), n=6, name='hood')
        for sx in (1, -1):
            p0 = torso.at(nz - 0.03, 90 + sx * 18, 0.01)[0]
            L.cone(mb, p0, p0 + V(sx * 0.008, -0.025, -0.105), 0.009, 'accent', lambda q: W.torso(q), n=4, name='string', tag='string')
        rib_ring(mb, nz - 0.005, nz + 0.035, 0.078, 0.072, 0.08, 'top', lambda q: W.torso(q), n=8, inner=0.8, name='neckrib')
        for s in ('L', 'R'):
            L.build_sleeve(mb, J, W, s, sleeve_rings(b, 0.09, 0.08, 0.07), 'top', tag='sleeve')
            cuff(mb, J, W, s, b, 0.058, mat='top', length=0.06)
            L.build_hand(mb, J, W, s, sc=1.24)
        logo_print(mb, torso, 'kanji', cz - 0.03, 90.0, 0.14, lambda q: W.torso(q), label='hoodie chest')
        logo_print(mb, torso, 'tag', shz - 0.13, 270.0, 0.27, lambda q: W.torso(q), label='hoodie back')
        # shorts, legs, socks, skates
        pelvis(mb, J, W, hw=0.168, fr=0.115, bk=0.128)
        for s in ('L', 'R'):
            trousers(mb, J, W, s, 0.108, 0.103, 0.104, hem_z=kz - 0.05, x_knee=0.01)
            bare_leg(mb, J, W, s, kz - 0.02, kz - 0.14)
            L.build_leg(mb, J, W, s, [(kz - 0.12, 0.054, 0.05, 0.052, 0.058, 0.004, -0.004), (kz - 0.22, 0.05, 0.046, 0.048, 0.054, 0.004, -0.002),
                                      (0.24, 0.048, 0.044, 0.046, 0.05, 0.004, 0.0)], 'top2', name='sock')
            L.build_skate(mb, J, W, s, 'inline')
        H = std_neck_head(mb, J, W, hs=1.0)
        hem = hair_hem(H, H.eye_z + 0.03, H.O.z + 0.05, H.O.z + 0.01, bangs=0.0)
        thick = lambda th, t: 0.03 + 0.016 * t
        L.hair_cap(mb, H, hem, thick, n=14, rows=4)
        # shaggy mop: fringe locks over the brow, locks over the ears and nape, top swept back
        hair_clumps(mb, H, hem, thick, [
            (90, 0.42, 0.1, 0.036, 0.25, 0.25, 0.1), (62, 0.4, 0.095, 0.034, 0.3, -0.2, 0.1),
            (118, 0.4, 0.095, 0.034, 0.3, 0.3, 0.1), (0, 0.5, 0.11, 0.038, 0.35, 0.2, 0.15),
            (180, 0.5, 0.11, 0.038, 0.35, -0.2, 0.15), (230, 0.55, 0.12, 0.04, 0.4, 0.2, 0.25),
            (270, 0.55, 0.12, 0.04, 0.45, 0.0, 0.25), (310, 0.55, 0.12, 0.04, 0.4, -0.2, 0.25),
            (250, 0.92, 0.12, 0.04, 0.55, 0.15, 0.3), (290, 0.92, 0.12, 0.04, 0.55, -0.15, 0.3),
            (90, 0.9, 0.11, 0.04, 0.6, 0.0, 0.35)])
        L.neck_headphones(mb, J, W, side_x=0.088, cup='accent', pad='gear')
        decal_face(mb, H, 'freckles')

    walk = dict(chest_yaw=0.3, arm_swing=0.42, lean=0.02, elbow=0.3, head_bob=0.03)
    return dict(build=b, parts=parts, colors=colors, walk=walk, skates=True,
                skate=dict(lean=0.45, arm_swing=0.85), idle=dict(look=0.55))


def slick_hair(mb, H, swoop=1.0, side=0.0, back_z=None):
    hem = hair_hem(H, H.eye_z + 0.05, H.O.z + 0.06, back_z if back_z is not None else H.O.z + 0.015, side_angle=38)
    thick = lambda th, t: 0.016 + 0.012 * t + 0.03 * swoop * max(0.0, math.sin(math.radians(th))) * t + side * max(0.0, math.cos(math.radians(th)))
    outer, angles, top = L.hair_cap(mb, H, hem, thick, n=14, rows=4, top_lift=0.01)
    return hem, thick, top


@variant
def longcoat():
    b = L.Build(shin=0.46, thigh=0.46, upper_arm=0.31, forearm=0.28, shoulder_w=0.19, l_spine=0.16, l_chest=0.18, ankle_h=0.11)
    colors = dict(skin='#f0c8a8', hair='#1a1820', top='#c8a878', top2='#2a2a3a', bottom='#3a3a48',
                  shoes='#2a1e1a', accent='#6a4a30', gear='#1d1d26')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        cr = [(kz - 0.03, 0.23, 0.185, 0.17, 0.0, 2.3), (hipz - 0.16, 0.205, 0.155, 0.152, 0.0, 2.3),
              (hz - 0.01, 0.182, 0.125, 0.13, 0.0, 2.4), (hz + 0.05, 0.168, 0.113, 0.118, 0.0, 2.4),
              (sz + 0.07, 0.186, 0.13, 0.13, 0.0, 2.5)] + upper_rings(J, b, 0.198, 0.136, 0.132, sh_extra=0.03)
        angs, edges = L.angles_with_strips(18, [(90.0, 2.0)])
        torso = torso_garment(mb, J, W, cr, skirt=0.7, n=18, strips=[(90.0, 2.0)], strip_mat='top', strip_rows=(0, 2))
        # belt + buckle
        rib_ring(mb, hz + 0.015, hz + 0.065, 0.172, 0.118, 0.122, 'accent', lambda q: W.torso(q), n=16, name='belt')
        bp = torso.at(hz + 0.04, 90, 0.016)[0]
        L.box(mb, bp, (1, 0, 0), (0, 0, 1), (0, -1, 0), 0.03, 0.03, 0.008, 'gear', lambda q: W.torso(q), name='buckle')
        # collar (tall at the back) + lapels
        rr = []
        for z, k, dy in ((nz - 0.03, 1.12, 0.0), (nz + 0.07, 1.25, 0.015), (nz + 0.07, 1.0, 0.015), (nz - 0.03, 0.9, 0.0)):
            rr.append(L.ring((0, dy, z), (0, 0, 1), L.prof(12, 0.085 * k, 0.07 * k, 0.095 * k, p=2.4), lambda q: W.torso(q)))
        mb.loft(rr, 'top', closed=True, name='collar')
        for sx in (1, -1):
            S = (lambda u, v, sx=sx: torso.at(lerp(cz - 0.03, nz - 0.005, u), 90 - sx * (lerp(2, 30, u) + v * lerp(10, 22, u))))
            L.patch(mb, S, [0, 0.4, 0.75, 1], [0, 0.5, 1], 0.012, -0.008, 'top', lambda q: W.torso(q), name='lapel')
        L.build_neck(mb, J, W, r=0.045)
        rib_ring(mb, nz - 0.02, nz + 0.075, 0.06, 0.058, 0.064, 'top2', lambda q: W.torso(q), n=10, inner=0.7, name='turtleneck')
        for s in ('L', 'R'):
            L.build_sleeve(mb, J, W, s, sleeve_rings(b, 0.084, 0.077, 0.07), 'top', tag='sleeve')
            cuff(mb, J, W, s, b, 0.074, mat='top', length=0.05)
            L.build_hand(mb, J, W, s, sc=1.2)
            sx = 1 if s == 'L' else -1
            pp = torso.at(hipz - 0.04, 90 - sx * 50, 0.006)
            L.box(mb, pp[0], pp[1].cross(V(0, 0, 1)), (0, 0, 1), pp[1], 0.062, 0.018, 0.01, 'top', lambda q: W.torso(q, skirt=0.7), bevel=0.006, name='pocketflap')
        pelvis(mb, J, W, hw=0.15, fr=0.1, bk=0.115, top=hz)
        for s in ('L', 'R'):
            trousers(mb, J, W, s, 0.098, 0.1, 0.104, bunch=0.04)
        rng = {s: L.build_shoe(mb, J, W, s, 'boot', sole='gear') for s in ('L', 'R')}
        H = L.build_head(mb, J, W, hs=0.98, ears=True)
        hem, thick, top = slick_hair(mb, H, swoop=1.0)
        # pompadour: a big rolled quiff over the forehead
        L.blob(mb, H.O + V(0, -0.072, 0.198), 0.07, 0.068, 0.046, 'hair', {'head': 1.0}, n=8, rows=4, name='quiff')
        L.blob(mb, H.O + V(0, -0.115, 0.205), 0.05, 0.04, 0.034, 'hair', {'head': 1.0}, n=6, rows=3, name='quiff')
        decal_face(mb, H, 'shades')

    walk = dict(chest_yaw=0.2, hip_yaw=0.1, lean=-0.03, head_pitch=-0.04, arm_L=None, arm_R=None, bounce=0.012, sway=0.018)
    return dict(build=b, parts=parts, colors=colors, walk=walk, skates=False, arms=('pocket', 'pocket'), idle=dict(look=0.35))


@variant
def schoolgirl():
    b = L.Build(shin=0.37, thigh=0.38, upper_arm=0.25, forearm=0.23, shoulder_w=0.152, hip_w=0.078, l_hips=0.1,
                l_spine=0.13, l_chest=0.15, l_neck=0.08, l_head=0.19, ankle_h=0.095, head_scale=1.03, hand=0.085)
    colors = dict(skin='#f2d0b4', hair='#2a1a14', top='#f4f2ec', top2='#26305a', bottom='#26305a',
                  shoes='#3a2418', accent='#e8344a', gear='#4a3020')
    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        jr = [(hz - 0.05, 0.148, 0.104, 0.1, 0.0, 2.4), (sz + 0.03, 0.15, 0.108, 0.1, 0.0, 2.4)] + \
            upper_rings(J, b, 0.158, 0.114, 0.104, sh_extra=0.015, neck_hw=0.068)
        torso = torso_garment(mb, J, W, jr, skirt=0.2, n=16)
        # sailor collar: square flap on the back + V bands in front, accent stripe near the edges
        zl, zt = shz - 0.15, nz + 0.012
        us = [0, 0.06, 0.16, 0.5, 1.0]
        vs = [0, 0.05, 0.13, 0.5, 0.87, 0.95, 1.0]
        Sb = lambda u, v: torso.at(lerp(zl, zt, u), lerp(212, 328, v), 0.0)
        L.patch(mb, Sb, us, vs, 0.008, -0.006, 'top2', lambda q: W.torso(q), name='sailor_back',
                matfn=lambda i, j: 'accent' if (i == 1 or j in (1, 4)) and i < 3 else 'top2')
        for sx in (1, -1):
            Sf = (lambda u, v, sx=sx: torso.at(lerp(nz + 0.012, cz - 0.035, u), 90 - sx * (lerp(46, 3, u) + v * lerp(26, 9, u)), 0.0))
            L.patch(mb, Sf, [0, 0.5, 1], [0, 0.1, 0.24, 1.0], 0.008, -0.006, 'top2', lambda q: W.torso(q), name='sailor_front',
                    matfn=lambda i, j: 'accent' if j == 1 else 'top2')
        # ribbon bow at the V
        kp = torso.at(cz - 0.03, 90, 0.024)[0]
        wt = lambda q: W.torso(q)
        L.blob(mb, kp, 0.018, 0.012, 0.016, 'accent', wt, n=6, rows=3, flat=False, name='knot', tag='bow')
        for sx in (1, -1):
            L.cone(mb, kp + V(sx * 0.01, 0.0, 0.0), kp + V(sx * 0.075, -0.004, 0.012), 0.024, 'accent', wt, n=4, ry=0.012, name='bowwing', tag='bow')
            L.cone(mb, kp + V(sx * 0.006, 0.0, -0.01), kp + V(sx * 0.03, -0.008, -0.11), 0.02, 'accent', wt, n=4, ry=0.007, name='bowtail', tag='bow')
        for s in ('L', 'R'):
            L.build_sleeve(mb, J, W, s, sleeve_rings(b, 0.066, 0.058, 0.052), 'top', tag='sleeve')
            cuff(mb, J, W, s, b, 0.048, mat='top2', length=0.045)
            L.build_hand(mb, J, W, s, sc=1.12)
        skirt(mb, J, W, hz + 0.035, kz + 0.07, top=(0.15, 0.105, 0.112), hem=(0.24, 0.205, 0.215), pleats=16, n=16, k=0.8)
        for s in ('L', 'R'):
            bare_leg(mb, J, W, s, hipz + 0.02, kz - 0.05, r_thigh=0.066, r_calf=0.054)
            L.build_leg(mb, J, W, s, [(kz - 0.02, 0.054, 0.05, 0.054, 0.058, 0.004, -0.004), (kz - 0.1, 0.056, 0.05, 0.054, 0.06, 0.004, -0.006),
                                      (az + 0.07, 0.043, 0.04, 0.042, 0.046, 0.004, 0.0), (az + 0.01, 0.042, 0.04, 0.042, 0.044, 0.004, 0.0)],
                        'top2', name='sock', foot=0.2)
        rng = {s: L.build_shoe(mb, J, W, s, 'loafer', sole='gear', sc=0.92) for s in ('L', 'R')}
        H = L.build_head(mb, J, W, hs=1.03)
        L.build_neck(mb, J, W, r=0.036)
        # bob with a blunt, slightly jagged fringe
        hem = hair_hem(H, H.eye_z + 0.03, H.O.z + 0.0, H.O.z - 0.005, bangs=0.01, side_angle=34)
        thick = lambda th, t: 0.022 + 0.016 * (1 - t) ** 2 + 0.012 * t
        L.hair_cap(mb, H, hem, thick, n=16, rows=4)
        decal_face(mb, H, 'cute')
        # school bag carried over the right shoulder (bag bone pivots on the shoulder top)
        pv = V(-0.15, 0.035, shz + 0.07)
        bc = V(-0.15, 0.14, shz - 0.17)
        wb = {'bag': 1.0}
        L.box(mb, bc, (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.17, 0.125, 0.045, 'gear', wb, bevel=0.018, flat=False, name='schoolbag')
        L.box(mb, bc + V(0, 0.048, 0.05), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.172, 0.08, 0.006, 'gear', wb, bevel=0.006, name='bagflap')
        L.box(mb, bc + V(0, 0.056, 0.0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.025, 0.018, 0.004, 'accent', wb, name='clasp')
        for xo in (-0.07, 0.07):
            path = [bc + V(xo, -0.01, 0.12), bc + V(xo * 0.5, -0.04, 0.2), pv + V(xo * 0.15, -0.04, 0.0)]
            L.tube_path(mb, path, [0.008, 0.008, 0.008], 'gear', wb, n=4, name='handle')

    walk = dict(chest_yaw=0.22, arm_swing=0.4, step_w=0.06, sway=0.02, hip_roll=0.07, elbow=0.3, head_bob=0.03)
    return dict(build=b, parts=parts, colors=colors, walk=walk, skates=False, arms=(None, 'shoulder_carry'),
                bag='shoulder_bag', extras_fn=lambda J: {'bag': (V(-0.15, 0.035, J['sh_z'] + 0.07), V(-0.15, 0.14, J['sh_z'] - 0.17))},
                idle=dict(look=0.4))


@variant
def salaryman():
    b = L.Build(shin=0.42, thigh=0.43, upper_arm=0.29, forearm=0.265, shoulder_w=0.185, ankle_h=0.095)
    colors = dict(skin='#e0b090', hair='#16141a', top='#3a4256', top2='#eef0f4', bottom='#3a4256',
                  shoes='#241a16', accent='#c8283a', gear='#2a1e18')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        jr = [(hipz - 0.035, 0.172, 0.12, 0.126, 0.0, 2.4), (hz + 0.02, 0.165, 0.112, 0.118, 0.0, 2.4),
              (sz + 0.06, 0.18, 0.122, 0.124, 0.0, 2.5)] + upper_rings(J, b, 0.19, 0.128, 0.128, sh_extra=0.04, top_k=0.7)
        torso = torso_garment(mb, J, W, jr, skirt=0.3, n=16, strips=[(90.0, 1.5)], strip_mat='top', strip_rows=(0, 2))
        wt = lambda q: W.torso(q)
        # shirt V + lapels
        zb = sz + 0.075
        Sv = lambda u, v: torso.at(lerp(zb, nz + 0.02, u), 90 + lerp(-1, 1, v) * lerp(3, 34, u), 0.0)
        L.patch(mb, Sv, [0, 0.35, 0.7, 1], [0, 0.25, 0.5, 0.75, 1], 0.005, -0.008, 'top2', wt, name='shirt')
        for sx in (1, -1):
            S = (lambda u, v, sx=sx: torso.at(lerp(zb - 0.01, nz + 0.0, u), 90 - sx * (lerp(2, 30, u) + v * lerp(9, 16, u)), 0.0))
            L.patch(mb, S, [0, 0.35, 0.7, 1], [0, 0.5, 1], 0.011, -0.006, 'top', wt, name='lapel')
            pp = torso.at(hipz + 0.005, 90 - sx * 58, 0.004)
            L.box(mb, pp[0], (0, -1, 0), (0, 0, 1), pp[1], 0.055, 0.014, 0.008, 'top', lambda q: W.torso(q, skirt=0.3), bevel=0.005, name='pocketflap')
        rib_ring(mb, nz - 0.01, nz + 0.04, 0.068, 0.064, 0.07, 'top2', wt, n=10, inner=0.78, name='shirtcollar')
        # loose tie on the tie bone
        kz_ = nz - 0.035
        kn = torso.at(kz_, 90, 0.012)[0] + V(0.008, 0, 0)
        tw = {'tie': 1.0}
        L.box(mb, kn, (1, 0, 0), (0, 0.15, 1), (0, -1, 0.15), 0.019, 0.02, 0.012, 'accent', tw, bevel=0.007, name='tieknot')
        path = [kn + V(0, 0.0, -0.01), kn + V(0.004, -0.012, -0.12), kn + V(0.0, -0.022, -0.27)]
        L.tube_path(mb, path, [0.016, 0.03, 0.036], 'accent', tw, n=4, up=(0, -1, 0), ry=[0.006, 0.006, 0.006], name='tie', start=0.0)
        for s in ('L', 'R'):
            L.build_sleeve(mb, J, W, s, sleeve_rings(b, 0.068, 0.064, 0.056, start=-0.035), 'top', tag='sleeve')
            cuff(mb, J, W, s, b, 0.046, mat='top2', length=0.03, back=0.025)
            L.build_hand(mb, J, W, s, sc=1.18)
        pelvis(mb, J, W, hw=0.15, fr=0.1, bk=0.115)
        for s in ('L', 'R'):
            trousers(mb, J, W, s, 0.086, 0.078, 0.07)
        rng = {s: L.build_shoe(mb, J, W, s, 'loafer', sole='gear') for s in ('L', 'R')}
        H = std_neck_head(mb, J, W, ears=True)
        hem = hair_hem(H, H.eye_z + 0.052, H.O.z + 0.065, H.O.z + 0.02, side_angle=40)
        thick = lambda th, t: 0.014 + 0.012 * t + 0.02 * max(0.0, math.cos(math.radians(th))) * t
        L.hair_cap(mb, H, hem, thick, n=14, rows=4)
        p0 = H.hair_surf.at(H.rings[-2][0] + 0.01, 70, 0.03)[0]
        L.cone(mb, p0 + V(0.03, 0.02, 0.0), p0 + V(-0.09, -0.04, 0.005), 0.04, 'hair', {'head': 1.0}, n=5, ry=0.025, name='sidepart')
        decal_face(mb, H, 'tired')
        # briefcase hanging from the right hand
        W0, a, f, n = L.hand_frame(J, 'R')
        grip = W0 + a * 0.1 + n * 0.022
        wb = {'bag': 1.0}
        cc = grip + V(0, 0, -0.19)
        L.box(mb, cc, (0, -1, 0), (0, 0, 1), (1, 0, 0), 0.2, 0.145, 0.045, 'gear', wb, bevel=0.012, flat=False, name='case')
        L.tube_path(mb, [grip + V(0, 0.05, -0.046), grip + V(0, 0.04, 0.0), grip + V(0, -0.04, 0.0), grip + V(0, -0.05, -0.046)],
                    [0.009] * 4, 'gear', wb, n=4, name='handle')
        for yo in (-0.12, 0.12):
            L.box(mb, cc + V(0, yo, 0.13), (0, -1, 0), (0, 0, 1), (1, 0, 0), 0.016, 0.012, 0.048, 'accent', wb, name='latch')
        spec_extra['bag'] = (grip, grip + V(0, 0, -0.3))

    spec_extra = {}
    walk = dict(chest_yaw=0.18, hip_yaw=0.1, lean=0.06, chest_pitch=0.08, neck_pitch=0.08, head_pitch=-0.1, arm_swing=0.32,
                elbow=0.3, swing_R=0.4, tie=0.12, sh_fwd=0.08, shrug=0.03)
    return dict(build=b, parts=parts, colors=colors, walk=walk, fast=dict(lean=0.14, arm_swing=0.42), skates=False,
                arms=(None, 'hold'), bag='hand_R', extras_dyn=spec_extra, idle=dict(look=0.3))


# --------------------------------------------------------------------------------------
# Hats and long hair
# --------------------------------------------------------------------------------------

def round_brim(mb, H, z, crown_off, width, droop, mat, thick=0.012, n=14, front=0.0, name='brim'):
    """Closed ring brim around the head at height z (bucket hat, sun hat). front adds
    extra width at the front (cap-like)."""
    w = {'head': 1.0}
    first = mb.begin()
    rows = [[], [], [], []]
    for k in range(n):
        th = 90.0 + 360.0 * k / n
        p, nn = H.hair_surf.at(z, th, crown_off)
        nh = Vector((nn.x, nn.y, 0)).normalized()
        wd = width + front * max(0.0, math.sin(math.radians(th))) ** 2
        o = p + nh * wd + Vector((0, 0, -droop * wd / max(width, 1e-6)))
        h = Vector((0, 0, thick * 0.5))
        for r, q in zip(rows, (p + h, o + h, o - h, p - h)):
            r.append(mb.v(q, w))
    for i in range(4):
        a, b = rows[i], rows[(i + 1) % 4]
        for k in range(n):
            k1 = (k + 1) % n
            mb.f([a[k], a[k1], b[k1], b[k]], mat, True, 'hat')
    mb.end(first, name)


def hat_crown(mb, H, z_hem, height, thick, mat, n=14, top_flat=0.6, name='crown', rows=4):
    """Hat crown over the skull: a hair_cap in hat colour with a flattened top."""
    hem = lambda th: z_hem
    thk = lambda th, t: thick + height * t ** 2
    return L.hair_cap(mb, H, hem, thk, n=n, rows=rows, mat=mat, name=name, tag='hat', flat=True,
                      top_lift=-height * top_flat)


def flat_crown(mb, H, zb, height, thick, mat, taper=0.9, n=14, name='crown'):
    """Straight-sided hat crown with a flat top (sun hat, boater, pork pie)."""
    zz, hw, fr, bk, yoff, p = H.hair_surf.params(zb)
    rr = [(zb - 0.004, hw + thick, fr + thick, bk + thick, yoff, p),
          (zb + height * 0.7, (hw + thick) * lerp(1, taper, 0.7), (fr + thick) * lerp(1, taper, 0.7), (bk + thick) * lerp(1, taper, 0.7), yoff, p),
          (zb + height, (hw + thick) * taper * 0.97, (fr + thick) * taper * 0.97, (bk + thick) * taper * 0.97, yoff, p)]
    L.vertical_loft(mb, rr, mat, {'head': 1.0}, n=n, flat=True, tag='hat', name=name)


def tail_weights(bone, root, length, head_frac=0.25):
    """Weight fn for hair locks hanging from `root`: head near the root, `bone` below."""
    def f(p):
        t = clamp((root - p).length / max(length, 1e-6), 0.0, 1.0)
        k = smoothstep(0.0, head_frac, t)
        return {'head': 1.0 - k, bone: k} if k < 0.999 else {bone: 1.0}
    return f


def hair_tail(mb, path, radii, bone, mat='hair', n=6, ry=None, name='tail', flat=True, up=(0, 1, 0)):
    path = [Vector(p) for p in path]
    length = sum((b - a).length for a, b in zip(path, path[1:]))
    wf = tail_weights(bone, path[0], length)
    acc = [0.0]
    for a, b in zip(path, path[1:]):
        acc.append(acc[-1] + (b - a).length)
    ws = []
    for i, p in enumerate(path):
        k = smoothstep(0.0, 0.25, acc[i] / length)
        ws.append({'head': 1.0 - k, bone: k} if k < 0.999 else {bone: 1.0})
    L.tube_path(mb, path, radii, mat, ws, n=n, up=up, flat=flat, ry=ry, name=name, tag='hair')


@variant
def roller():
    b = L.Build(shin=0.40, thigh=0.41, upper_arm=0.27, forearm=0.25, shoulder_w=0.162, hip_w=0.085, l_spine=0.14,
                l_chest=0.155, ankle_h=0.155, ball_h=0.1, skates=True, head_scale=1.02, hand=0.088)
    colors = dict(skin='#f0c09a', hair='#ff5f9e', top='#f6f4ee', top2='#2b3a8f', bottom='#ffb51e',
                  shoes='#f6f4ee', accent='#38d6c4', gear='#2a2a35')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        wt = lambda q: W.torso(q)
        # ringer tee (top) tucked into overalls (bottom below the waist)
        jr = [(hipz - 0.02, 0.165, 0.112, 0.118, 0.0, 2.4), (hz + 0.03, 0.158, 0.106, 0.11, 0.0, 2.4),
              (sz + 0.04, 0.162, 0.11, 0.108, 0.0, 2.5)] + upper_rings(J, b, 0.17, 0.118, 0.11, sh_extra=0.016, neck_hw=0.07)
        torso = torso_garment(mb, J, W, jr, skirt=0.2, matfn=lambda i, k, a: 'bottom' if i == 0 else None)
        rib_ring(mb, nz - 0.01, nz + 0.03, 0.07, 0.066, 0.074, 'top2', wt, n=10, inner=0.8, name='collar')
        for s in ('L', 'R'):
            sl = [r for r in sleeve_rings(b, 0.068, 0.06, 0.06) if r[0] <= 0.13]
            sl.append((0.14, 0.064, 0.064, 0.064, 0.062))
            L.build_sleeve(mb, J, W, s, sl, 'top', tag='sleeve')
            L.build_sleeve(mb, J, W, s, [(0.11, 0.066, 0.066, 0.066, 0.064), (0.15, 0.064, 0.064, 0.064, 0.062)], 'top2', n=8, name='sleevecuff')
            L.build_sleeve(mb, J, W, s, [(0.13, 0.05, 0.052, 0.05, 0.048), (b.upper_arm - 0.02, 0.046, 0.048, 0.046, 0.044),
                                         (b.upper_arm + 0.03, 0.042, 0.044, 0.042, 0.04), (b.upper_arm + b.forearm - 0.03, 0.034, 0.036, 0.034, 0.032)],
                           'skin', name='arm')
            # wrist guard
            L.build_sleeve(mb, J, W, s, [(b.upper_arm + b.forearm - 0.1, 0.046, 0.048, 0.046, 0.044), (b.upper_arm + b.forearm - 0.01, 0.042, 0.044, 0.042, 0.04)],
                           'gear', n=8, name='wristguard')
            L.build_hand(mb, J, W, s, sc=1.15)
        # overall bib, pocket print, straps (left strap up, right strap hanging down)
        zb0, zb1 = hz + 0.0, cz + 0.035
        Sb = lambda u, v: torso.at(lerp(zb0, zb1, u), 90 + lerp(-1, 1, v) * lerp(36, 26, u))
        L.patch(mb, Sb, [0, 0.5, 1], [0, 0.25, 0.5, 0.75, 1], 0.011, -0.006, 'bottom', wt, name='bib')
        logo_print(mb, torso, 'star', lerp(zb0, zb1, 0.55), 90.0, 0.085, wt, mat='bottom', off=0.016, label='bib star')
        for sx in (1, -1):
            pa = torso.at(zb1 - 0.01, 90 - sx * 22, 0.012)[0]
            L.box(mb, pa + V(0, -0.006, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0), 0.016, 0.016, 0.007, 'gear', wt, bevel=0.005, name='buckle')
            if sx > 0:
                path = [pa, torso.at(nz - 0.04, 90 - sx * 40, 0.012)[0], V(sx * 0.115, 0.0, shz + 0.06),
                        torso.at(shz - 0.05, 270 + sx * 35, 0.012)[0], torso.at(hz + 0.05, 270 + sx * 12, 0.012)[0]]
            else:
                path = [pa, pa + V(sx * 0.03, -0.012, -0.08), pa + V(sx * 0.055, -0.01, -0.2)]
            L.tube_path(mb, path, [0.016] * len(path), 'bottom', wt, n=4, ry=[0.005] * len(path), name='strap', up=(0, 0, 1))
        pelvis(mb, J, W, hw=0.165, fr=0.11, bk=0.124)
        for s in ('L', 'R'):
            trousers(mb, J, W, s, 0.098, 0.094, 0.1, hem_z=kz - 0.2, x_knee=0.008)
            L.build_leg(mb, J, W, s, [(kz - 0.17, 0.104, 0.1, 0.106, 0.104, 0.008, 0.0), (kz - 0.23, 0.104, 0.1, 0.106, 0.104, 0.008, 0.0)],
                        'bottom', name='rollup')
            bare_leg(mb, J, W, s, kz - 0.16, az + 0.05, r_calf=0.05)
            # knee pad
            sx = 1 if s == 'L' else -1
            L.box(mb, (J['knee.' + s].x + sx * 0.008, -0.09, kz - 0.005), (1, 0, 0), (0, 0, 1), (0, -1, 0), 0.06, 0.07, 0.022, 'gear',
                  lambda q, s=s: W.leg(s, q), bevel=0.018, flat=False, name='kneepad')
            L.build_skate(mb, J, W, s, 'quad', cuff='top2')
        # head: bangs + high ponytail on the hair bone
        H = std_neck_head(mb, J, W, hs=1.02)
        hem = hair_hem(H, H.eye_z + 0.028, H.O.z + 0.045, H.O.z + 0.03, bangs=0.012, side_angle=36)
        thick = lambda th, t: 0.016 + 0.012 * t
        L.hair_cap(mb, H, hem, thick, n=14, rows=4)
        root = H.O + V(0, 0.085, 0.2)
        hair_tail(mb, [root + V(0, -0.01, 0.01), root + V(0, 0.06, 0.03), root + V(0, 0.13, -0.05), root + V(0, 0.15, -0.17),
                       root + V(0, 0.13, -0.27)], [0.032, 0.05, 0.052, 0.04, 0.0], 'hair', n=6, name='ponytail')
        L.blob(mb, root + V(0, 0.012, 0.012), 0.032, 0.03, 0.022, 'accent', {'head': 1.0}, n=6, rows=3, name='scrunchie', tag='hat')
        decal_face(mb, H, 'bright')

    tail = lambda J: {'hair': (J['head'] + V(0, 0.1, 0.21), J['head'] + V(0, 0.15, -0.06))}
    walk = dict(chest_yaw=0.3, arm_swing=0.5, arm_out=0.2, hip_roll=0.075, sway=0.026, hair_swing=0.22, head_bob=0.035)
    return dict(build=b, parts=parts, colors=colors, walk=walk, skates=True, extras_fn=tail,
                skate=dict(lean=0.38, arm_swing=0.95, crouch=0.15), idle=dict(look=0.6))


@variant
def puffer():
    b = L.Build(shin=0.43, thigh=0.43, upper_arm=0.29, forearm=0.27, shoulder_w=0.18, ankle_h=0.11)
    colors = dict(skin='#e2b088', hair='#141418', top='#ff8a1e', top2='#1d1d26', bottom='#22222c',
                  shoes='#3a3a44', accent='#2fc4c0', gear='#f2f0ea')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        # quilted puffer: stacked bulging bands, each its own shell so the ink draws the seams
        bands = [(hipz - 0.07, hz + 0.05, 0.235, 0.17, 0.17), (hz + 0.05, sz + 0.09, 0.25, 0.18, 0.18),
                 (sz + 0.09, cz + 0.07, 0.258, 0.185, 0.185)]
        wfn = lambda q: W.torso(q, skirt=0.25)
        for i, (z0, z1, hw, fr, bk) in enumerate(bands):
            zm = (z0 + z1) / 2
            rr = [(z0, hw * 0.9, fr * 0.88, bk * 0.88, 0.0, 2.6), (zm, hw, fr, bk, 0.0, 2.7), (z1, hw * 0.92, fr * 0.9, bk * 0.9, 0.0, 2.6)]
            L.vertical_loft(mb, rr, 'top', wfn, n=14, name='band', tag='torso')
        top = [(cz + 0.04, 0.24, 0.17, 0.17, 0.0, 2.6)] + upper_rings(J, b, 0.25, 0.17, 0.17, sh_extra=0.05, top_k=0.6, neck_hw=0.1)[1:]
        torso = torso_garment(mb, J, W, top, n=14, skirt=0.2)
        # tall collar + zip
        rr = []
        for z, k in ((nz - 0.02, 1.0), (nz + 0.085, 0.96), (nz + 0.085, 0.8), (nz - 0.02, 0.8)):
            rr.append(L.ring((0, 0.004, z), (0, 0, 1), L.prof(12, 0.098 * k, 0.094 * k, 0.1 * k, p=2.5), lambda q: W.torso(q)))
        mb.loft(rr, 'top', closed=True, name='collar')
        zp = lambda u, v: (V(lerp(-0.006, 0.006, v), -0.192 + 0.01 * math.sin(math.pi * u), lerp(hipz - 0.06, nz + 0.08, u)), V(0, -1, 0))
        L.patch(mb, lambda u, v: (V(lerp(-0.007, 0.007, v), -0.185, lerp(hipz - 0.05, cz + 0.06, u)), V(0, -1, 0)), [0, 0.5, 1], [0, 1],
                0.006, -0.01, 'accent', lambda q: W.torso(q, skirt=0.25), name='zip')
        # sleeves as stacked puffs
        for s in ('L', 'R'):
            ua, fa = b.upper_arm, b.forearm
            segs = [(-0.08, 0.13, 0.11), (0.13, ua + 0.03, 0.1), (ua + 0.03, ua + fa - 0.06, 0.092)]
            for t0, t1, r in segs:
                tm = (t0 + t1) / 2
                L.build_sleeve(mb, J, W, s, [(t0, r * 0.75, r * 0.8, r * 0.8, r * 0.75), (tm, r, r, r, r * 0.97), (t1, r * 0.85, r * 0.86, r * 0.86, r * 0.83)],
                               'top', n=8, name='puff', tag='sleeve')
            cuff(mb, J, W, s, b, 0.062, mat='top2', length=0.05, back=0.045)
            L.build_hand(mb, J, W, s, sc=1.22)
        # slim trousers + chunky boots
        pelvis(mb, J, W, hw=0.152, fr=0.1, bk=0.115)
        for s in ('L', 'R'):
            trousers(mb, J, W, s, 0.085, 0.072, 0.07, hem_z=az + 0.1)
        rng = {s: L.build_shoe(mb, J, W, s, 'boot', sole='gear', sc=1.08) for s in ('L', 'R')}
        # beanie with fold and a pom
        H = std_neck_head(mb, J, W, hs=0.98)
        hem = hair_hem(H, H.eye_z + 0.03, H.O.z + 0.03, H.O.z + 0.0)
        L.hair_cap(mb, H, hem, lambda th, t: 0.012, n=14, rows=3)
        zb = H.eye_z + 0.05
        L.hair_cap(mb, H, lambda th: zb - 0.004 * math.sin(math.radians(th)), lambda th, t: 0.022 + 0.014 * t, n=14, rows=4,
                   mat='accent', name='beanie', tag='hat', flat=False)
        head_band(mb, H, zb - 0.01, zb + 0.035, 0.03, 0.01, 'accent', n=14, flat=True, name='fold')
        L.blob(mb, H.apex + V(0, 0.01, 0.05), 0.036, 0.036, 0.032, 'gear', {'head': 1.0}, n=6, rows=4, name='pom', tag='hat')
        decal_face(mb, H, 'mask')

    walk = dict(chest_yaw=0.26, arm_swing=0.4, arm_out=0.34, elbow=0.38, sh_fwd=0.1, lean=0.05, head_bob=0.025, sway=0.03, hip_roll=0.05)
    return dict(build=b, parts=parts, colors=colors, walk=walk, skates=False, idle=dict(look=0.35, shift=0.03))


@variant
def tracksuit():
    b = L.Build(shin=0.44, thigh=0.44, upper_arm=0.30, forearm=0.27, shoulder_w=0.186, ankle_h=0.1)
    colors = dict(skin='#b97a56', hair='#1a1410', top='#1f8a5a', top2='#f2f0ea', bottom='#1f8a5a',
                  shoes='#f2f0ea', accent='#f2f0ea', gear='#24242c', detail='#ffffff')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        wt = lambda q: W.torso(q, skirt=0.15)
        jr = [(hz - 0.03, 0.17, 0.118, 0.12, 0.0, 2.4), (sz + 0.06, 0.188, 0.13, 0.128, 0.0, 2.5)] + \
            upper_rings(J, b, 0.198, 0.136, 0.13, sh_extra=0.025)
        torso = torso_garment(mb, J, W, jr, skirt=0.15, strips=[(90.0, 2.2)], strip_mat='accent', strip_rows=(0, 5))
        rib_ring(mb, hz - 0.07, hz - 0.02, 0.172, 0.12, 0.122, 'top', wt, n=14, name='hem')
        # stand collar
        rib_ring(mb, nz - 0.01, nz + 0.06, 0.084, 0.08, 0.088, 'top', lambda q: W.torso(q), n=10, inner=0.8, name='collar')
        angs, edges = L.angles_with_strips(8, [(-8.0, 4.0), (8.0, 4.0)], start=0.0)
        for s in ('L', 'R'):
            L.build_sleeve(mb, J, W, s, sleeve_rings(b, 0.078, 0.07, 0.064), 'top', tag='sleeve', angles=angs,
                           matfn=lambda i, k: 'accent' if k in edges and i >= 1 else 'top')
            cuff(mb, J, W, s, b, 0.054, mat='top', length=0.045)
            L.build_hand(mb, J, W, s, sc=1.2)
        pelvis(mb, J, W, hw=0.158, fr=0.108, bk=0.12)
        for s in ('L', 'R'):
            trousers(mb, J, W, s, 0.094, 0.088, 0.064, hem_z=az + 0.02, bunch=0.25, angles=angs,
                     matfn=lambda i, k: 'accent' if k in edges else 'bottom')
        rng = {s: L.build_shoe(mb, J, W, s, 'skateshoe', sole='top2') for s in ('L', 'R')}
        # bucket hat
        H = std_neck_head(mb, J, W)
        hem = hair_hem(H, H.eye_z + 0.03, H.O.z + 0.045, H.O.z + 0.015)
        L.hair_cap(mb, H, hem, lambda th, t: 0.012, n=12, rows=3)
        zb = H.eye_z + 0.045
        hat_crown(mb, H, zb, 0.035, 0.022, 'gear', n=14, top_flat=0.9)
        round_brim(mb, H, zb + 0.005, 0.02, 0.055, 0.03, 'gear', n=14, name='brim')
        decal_face(mb, H, 'grin')
        # skateboard carried in the left hand (bag bone), deck graphic underneath
        W0, a, f, n = L.hand_frame(J, 'L')
        grip = W0 + a * 0.075 + n * 0.012
        bw = {'bag': 1.0}
        bc = grip + V(0.035, 0.0, 0.075)
        # deck: long axis vertical along the leg, wheels (and the deck graphic) facing out
        dc = bc + V(0, 0, -0.30)
        L.box(mb, dc, (0, -1, 0), (0, 0, 1), (1, 0, 0), 0.105, 0.4, 0.008, 'gear', bw, bevel=0.03, name='deck')
        f0 = len(mb.faces)
        L.sticker(mb, lambda u, v: (dc + V(0.0, lerp(-0.09, 0.09, v), lerp(-0.37, 0.37, u)), V(1, 0, 0)), [0, 0.25, 0.5, 0.75, 1], [0, 0.5, 1],
                  0.0095, 'detail', bw, tag='print', name='print_deck')
        x0, y0 = MISC_CELLS['deck']
        for fi in range(f0, len(mb.faces)):
            uv = []
            for vi in mb.faces[fi]:
                q = mb.verts[vi] - dc
                uv.append(((x0 + 32 + q.y / 0.09 * 29.0) / 512.0, (y0 + 64 - q.z / 0.37 * 61.0) / 512.0))
            mb.fuv[fi] = uv
        for zo in (-0.04, -0.56):
            L.box(mb, bc + V(0.022, 0, zo), (0, -1, 0), (0, 0, 1), (1, 0, 0), 0.05, 0.012, 0.014, 'gear', bw, bevel=0.004, name='truck')
            for yo in (-0.055, 0.055):
                rr = [L.ring(bc + V(0.04 + xx, yo, zo), (1, 0, 0), L.prof(6, 0.026, 0.026, 0.026, p=2.0, start=0.0), bw, fwd=(0, -1, 0), lat=(0, 0, 1)) for xx in (0.0, 0.03)]
                mb.loft(rr, 'accent', name='wheel')
        spec_extra['bag'] = (grip, grip + V(0, 0, -0.4))

    spec_extra = {}
    walk = dict(chest_yaw=0.36, arm_swing=0.48, arm_out=0.18, elbow=0.26, sh_fwd=0.15, lean=0.0, head_bob=0.04,
                bounce=0.022, swing_L=0.45, hip_yaw=0.14)
    return dict(build=b, parts=parts, colors=colors, walk=walk, skates=False, arms=('hold', None), bag='hand_L',
                extras_dyn=spec_extra, idle=dict(look=0.5, stance_w=0.14))


@variant
def dress():
    b = L.Build(shin=0.40, thigh=0.41, upper_arm=0.27, forearm=0.25, shoulder_w=0.158, hip_w=0.082, l_hips=0.1,
                l_spine=0.14, l_chest=0.155, l_neck=0.09, ankle_h=0.1, head_scale=1.0, hand=0.086)
    colors = dict(skin='#f4cfae', hair='#5a2e22', top='#e8e0c8', top2='#d8423a', bottom='#e8e0c8',
                  shoes='#d8423a', accent='#2a6a9a', gear='#c89a5a')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        wt = lambda q: W.torso(q)
        jr = [(hz - 0.02, 0.15, 0.1, 0.104, 0.0, 2.4), (sz + 0.03, 0.142, 0.1, 0.098, 0.0, 2.4)] + \
            upper_rings(J, b, 0.162, 0.118, 0.104, sh_extra=0.012, neck_hw=0.066)
        torso = torso_garment(mb, J, W, jr, skirt=0.2, n=16)
        # puff short sleeves, bare arms
        for s in ('L', 'R'):
            L.build_sleeve(mb, J, W, s, [(-0.06, 0.04, 0.045, 0.045, 0.04), (-0.02, 0.07, 0.072, 0.072, 0.068), (0.05, 0.08, 0.08, 0.08, 0.076),
                                         (0.11, 0.064, 0.064, 0.064, 0.06)], 'top', name='puffsleeve', tag='sleeve')
            L.build_sleeve(mb, J, W, s, [(0.09, 0.046, 0.048, 0.046, 0.044), (b.upper_arm - 0.02, 0.042, 0.044, 0.042, 0.04),
                                         (b.upper_arm + 0.03, 0.038, 0.04, 0.038, 0.036), (b.upper_arm + b.forearm - 0.01, 0.031, 0.033, 0.031, 0.03)],
                           'skin', name='arm')
            L.build_hand(mb, J, W, s, sc=1.1)
        # sash belt with a bow at the back
        rib_ring(mb, hz + 0.005, hz + 0.05, 0.155, 0.105, 0.108, 'top2', wt, n=14, name='sash')
        bp = torso.at(hz + 0.028, 270, 0.012)[0]
        L.blob(mb, bp, 0.018, 0.012, 0.016, 'top2', wt, n=6, rows=3, name='knot', tag='bow')
        for sx in (1, -1):
            L.cone(mb, bp + V(sx * 0.01, 0, 0), bp + V(sx * 0.08, 0.01, 0.015), 0.028, 'top2', wt, n=4, ry=0.012, name='bowwing', tag='bow')
            L.cone(mb, bp + V(sx * 0.008, 0, -0.01), bp + V(sx * 0.04, 0.02, -0.2), 0.024, 'top2', wt, n=4, ry=0.008, name='bowtail', tag='bow')
        # long A-line skirt to mid-calf with a border band
        zt, zh = hz + 0.01, kz - 0.17
        skirt(mb, J, W, zt, zh, top=(0.152, 0.104, 0.108), hem=(0.27, 0.25, 0.26), n=16, k=0.85,
              matfn=None)
        skirt(mb, J, W, zh + 0.045, zh - 0.004, top=(0.262, 0.242, 0.252), hem=(0.274, 0.254, 0.264), n=16, k=0.85, mat='top2', name='border')
        for s in ('L', 'R'):
            bare_leg(mb, J, W, s, kz - 0.05, az + 0.02, r_calf=0.052)
        rng = {s: L.build_shoe(mb, J, W, s, 'loafer', sole='gear', sc=0.9) for s in ('L', 'R')}
        # long hair down the back on the hair bone, with a side-swept fringe
        H = std_neck_head(mb, J, W, neck_r=0.037)
        hem = hair_hem(H, H.eye_z + 0.035, H.O.z + 0.01, H.O.z - 0.03, side_angle=30)
        thick = lambda th, t: 0.018 + 0.014 * t
        L.hair_cap(mb, H, hem, thick, n=14, rows=4)
        root = H.O + V(0, 0.07, 0.08)
        hair_tail(mb, [root, root + V(0, 0.035, -0.12), root + V(0, 0.05, -0.27), root + V(0, 0.045, -0.38)],
                  [0.085, 0.09, 0.08, 0.05], 'hair', n=6, ry=[0.04, 0.035, 0.03, 0.015], up=(0, 1, 0), name='longhair')
        p0 = H.hair_surf.at(H.eye_z + 0.05, 62, 0.012)[0]
        L.cone(mb, p0 + V(0.02, 0.006, 0.0), p0 + V(-0.085, -0.012, -0.03), 0.034, 'hair', {'head': 1.0}, n=4, ry=0.012, name='fringe', up=(0, -1, 0.2))
        # sun hat
        zb = H.eye_z + 0.06
        flat_crown(mb, H, zb, H.apex.z + 0.03 - zb, 0.022, 'gear', taper=0.92, n=14)
        head_band(mb, H, zb, zb + 0.026, 0.03, 0.016, 'accent', n=14, flat=True, name='ribbon')
        round_brim(mb, H, zb + 0.004, 0.022, 0.125, 0.026, 'gear', n=16, thick=0.01, name='sunbrim')
        decal_face(mb, H, 'starry')
        # tote bag on the right shoulder (bag bone, pivot on the shoulder)
        pv = V(-0.13, 0.01, shz + 0.06)
        bc = V(-0.2, 0.02, hz + 0.02)
        bw = {'bag': 1.0}
        L.box(mb, bc, (0, -1, 0), (0, 0, 1), (-1, 0, 0), 0.15, 0.16, 0.03, 'accent', bw, bevel=0.012, flat=False, name='tote')
        f0 = len(mb.faces)
        L.sticker(mb, lambda u, v: (bc + V(-0.031, lerp(0.1, -0.1, v), lerp(-0.12, 0.12, u)), V(-1, 0, 0)), [0, 0.5, 1], [0, 0.5, 1], 0.002, 'accent', bw, tag='print', name='print_cat')
        sel = list(range(f0, len(mb.faces)))
        decal_misc(mb, sel, 'catprint', bc + V(-0.033, 0, 0.0), (0, -1, 0), (0, 0, 1), 64 / 0.2 * 0.98)
        for yo in (-0.08, 0.08):
            L.tube_path(mb, [bc + V(0, yo, 0.15), pv + V(0, yo * 0.3 - 0.01, 0.0)], [0.009, 0.009], 'accent', bw, n=4, name='handle')

    walk = dict(chest_yaw=0.24, arm_swing=0.36, step_w=0.055, sway=0.024, hip_roll=0.08, hip_yaw=0.14, elbow=0.32,
                head_bob=0.025, hair_swing=0.1, swing_R=0.25, arm_out=0.2)
    return dict(build=b, parts=parts, colors=colors, walk=walk, skates=False, bag='shoulder_bag_low',
                extras_fn=lambda J: {'bag': (V(-0.13, 0.01, J['sh_z'] + 0.06), V(-0.2, 0.02, J['hips'].z)),
                                     'hair': (J['head'] + V(0, 0.07, 0.08), J['head'] + V(0, 0.12, -0.3))},
                idle=dict(look=0.5, toe_out=0.12, stance_w=0.09))


@variant
def courier():
    b = L.Build(shin=0.43, thigh=0.43, upper_arm=0.29, forearm=0.27, shoulder_w=0.185, ankle_h=0.1)
    colors = dict(skin='#d9a079', hair='#201a16', top='#2a5bd8', top2='#f2f0ea', bottom='#40404a',
                  shoes='#f2f0ea', accent='#ffcc1e', gear='#e8442e')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        wt = lambda q: W.torso(q, skirt=0.15)
        jr = [(hipz + 0.0, 0.17, 0.118, 0.12, 0.0, 2.4), (sz + 0.05, 0.18, 0.124, 0.122, 0.0, 2.5)] + \
            upper_rings(J, b, 0.192, 0.13, 0.126, sh_extra=0.02)
        torso = torso_garment(mb, J, W, jr, skirt=0.15)
        # polo collar + placket
        rr = []
        for z, k, dy in ((nz - 0.02, 1.08, 0.0), (nz + 0.045, 1.14, 0.006), (nz + 0.045, 0.98, 0.006), (nz - 0.02, 0.92, 0.0)):
            rr.append(L.ring((0, dy, z), (0, 0, 1), L.prof(10, 0.078 * k, 0.07 * k, 0.086 * k, p=2.4), lambda q: W.torso(q)))
        mb.loft(rr, 'top2', closed=True, name='collar')
        Sp = lambda u, v: torso.at(lerp(cz + 0.02, nz - 0.005, u), 90 + lerp(-6, 6, v))
        L.patch(mb, Sp, [0, 1], [0, 1], 0.005, -0.006, 'top2', wt, name='placket')
        for s in ('L', 'R'):
            sl = [r for r in sleeve_rings(b, 0.074, 0.06, 0.06) if r[0] <= 0.12] + [(0.15, 0.07, 0.07, 0.07, 0.068)]
            L.build_sleeve(mb, J, W, s, sl, 'top', tag='sleeve')
            L.build_sleeve(mb, J, W, s, [(0.125, 0.074, 0.074, 0.074, 0.072), (0.155, 0.072, 0.072, 0.072, 0.07)], 'top2', n=8, name='sleevecuff')
            L.build_sleeve(mb, J, W, s, [(0.13, 0.054, 0.056, 0.054, 0.052), (b.upper_arm - 0.02, 0.05, 0.052, 0.05, 0.048),
                                         (b.upper_arm + 0.03, 0.046, 0.048, 0.046, 0.044), (b.upper_arm + b.forearm - 0.02, 0.036, 0.038, 0.036, 0.034)],
                           'skin', name='arm')
            L.build_hand(mb, J, W, s, sc=1.2)
        # cargo shorts, high socks, sneakers
        pelvis(mb, J, W, hw=0.164, fr=0.11, bk=0.124)
        for s in ('L', 'R'):
            sx = 1 if s == 'L' else -1
            trousers(mb, J, W, s, 0.104, 0.1, 0.102, hem_z=kz + 0.0, x_knee=0.01)
            L.box(mb, (J['hipj.' + s].x + sx * 0.112, 0.0, kz + 0.14), (0, -1, 0), (0, 0, 1), (sx, 0, 0), 0.05, 0.06, 0.014, 'bottom',
                  lambda q, s=s: W.leg(s, q), bevel=0.012, name='pocket')
            bare_leg(mb, J, W, s, kz + 0.02, kz - 0.12)
            L.build_leg(mb, J, W, s, [(kz - 0.1, 0.056, 0.052, 0.054, 0.06, 0.004, -0.004), (kz - 0.2, 0.052, 0.048, 0.05, 0.056, 0.004, -0.002),
                                      (az + 0.03, 0.046, 0.043, 0.045, 0.048, 0.004, 0.0)], 'top2', name='sock', foot=0.2,
                        matfn=lambda i, k: 'accent' if i == 0 else 'top2')
        rng = {s: L.build_shoe(mb, J, W, s, 'sneaker', sole='gear') for s in ('L', 'R')}
        decal_shoes(mb, J, rng, 'bars')
        # cap (backwards brim? no: forward) over short hair
        H = std_neck_head(mb, J, W, ears=True)
        hem = hair_hem(H, H.eye_z + 0.04, H.O.z + 0.05, H.O.z + 0.015)
        L.hair_cap(mb, H, hem, lambda th, t: 0.012, n=12, rows=3)
        zb = H.eye_z + 0.05
        hat_crown(mb, H, zb, 0.012, 0.02, 'gear', n=14, top_flat=0.2)
        cap_brim(mb, H, zb + 0.004, 0.02, 0.085, 120.0, dir_deg=90.0, tilt=-0.12, mat='gear', thick=0.012)
        decal_face(mb, H, 'stern')
        # insulated delivery box backpack (bag bone pivots on the chest) with straps
        bw = {'bag': 1.0}
        bc = V(0, 0.29, cz - 0.07)
        L.box(mb, bc, (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.2, 0.21, 0.15, 'accent', bw, bevel=0.025, flat=True, name='box')
        f0 = len(mb.faces)
        L.sticker(mb, lambda u, v: (bc + V(lerp(-0.15, 0.15, v), 0.152, lerp(-0.15, 0.15, u)), V(0, 1, 0)), [0, 0.5, 1], [0, 0.5, 1], 0.002, 'accent', bw, tag='print', name='print_dlv')
        decal_logo(mb, list(range(f0, len(mb.faces))), 'delivery', bc + V(0, 0.154, 0), (-1, 0, 0), (0, 0, 1), 0.3, 'box back')
        L.box(mb, bc + V(0, 0, 0.215), (1, 0, 0), (0, 1, 0), (0, 0, 1), 0.17, 0.11, 0.012, 'gear', bw, bevel=0.01, name='lid')
        for sx in (1, -1):
            path = [torso.at(hz + 0.06, 270 + sx * 40, 0.01)[0] + V(0, 0.01, 0), torso.at(hz + 0.08, 90 - sx * 60, 0.012)[0],
                    torso.at(cz, 90 - sx * 30, 0.014)[0], torso.at(nz - 0.04, 90 - sx * 40, 0.014)[0], V(sx * 0.11, 0.0, shz + 0.055),
                    V(sx * 0.11, 0.13, shz + 0.01)]
            L.tube_path(mb, path, [0.02] * len(path), 'gear', [W.torso(q) for q in path], n=4, ry=[0.006] * len(path), name='strap', up=(0, 0, 1))

    walk = dict(chest_yaw=0.28, arm_swing=0.3, lean=0.1, chest_pitch=0.04, head_pitch=-0.08, bounce=0.02, head_bob=0.03)
    return dict(build=b, parts=parts, colors=colors, walk=walk, fast=dict(lean=0.16), skates=False, arms=('strap', None),
                bag='backpack', extras_fn=lambda J: {'bag': (J['chest'] + V(0, 0.15, 0.06), J['chest'] + V(0, 0.29, -0.2))},
                idle=dict(look=0.4, stance_w=0.14))


@variant
def elder():
    b = L.Build(shin=0.40, thigh=0.41, upper_arm=0.28, forearm=0.26, shoulder_w=0.17, ankle_h=0.095, l_neck=0.08, head_scale=1.0)
    colors = dict(skin='#e6b896', hair='#d8d8dc', top='#8a5a3a', top2='#e8e2d0', bottom='#5a5a50',
                  shoes='#3a2a20', accent='#3a5a8a', gear='#4a4440')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        wt = lambda q: W.torso(q, skirt=0.3)
        jr = [(hipz - 0.04, 0.18, 0.135, 0.13, 0.0, 2.4), (hz + 0.03, 0.172, 0.13, 0.124, 0.0, 2.4),
              (sz + 0.06, 0.178, 0.13, 0.13, 0.0, 2.5)] + upper_rings(J, b, 0.184, 0.128, 0.136, sh_extra=0.02)
        angs, (k0,) = L.angles_with_strips(16, [(90.0, 1.6)])
        torso = torso_garment(mb, J, W, jr, skirt=0.3, strips=[(90.0, 1.6)], strip_mat='top', strip_rows=(0, 3))
        rib_ring(mb, hipz - 0.08, hipz - 0.03, 0.186, 0.14, 0.135, 'top', wt, n=14, name='hem')
        # shirt V + collar points
        zb = cz - 0.02
        Sv = lambda u, v: torso.at(lerp(zb, nz + 0.01, u), 90 + lerp(-1, 1, v) * lerp(2, 30, u))
        L.patch(mb, Sv, [0, 0.5, 1], [0, 0.25, 0.5, 0.75, 1], 0.005, -0.008, 'top2', wt, name='shirt')
        for sx in (1, -1):
            p0 = torso.at(nz - 0.005, 90 - sx * 28, 0.008)[0]
            L.cone(mb, p0 + V(sx * 0.012, 0, 0.012), p0 + V(-sx * 0.02, -0.02, -0.05), 0.022, 'top2', wt, n=4, ry=0.006, name='collarpt', up=(0, -1, 0))
        for k in range(3):
            pb = torso.at(lerp(zb - 0.02, hipz, k / 2.0), 90, 0.012)[0]
            L.blob(mb, pb, 0.009, 0.005, 0.009, 'top2', wt, n=6, rows=3, name='button', tag='torso')
        rib_ring(mb, nz - 0.012, nz + 0.03, 0.07, 0.068, 0.076, 'top2', lambda q: W.torso(q), n=10, inner=0.8, name='shirtcollar')
        for s in ('L', 'R'):
            L.build_sleeve(mb, J, W, s, sleeve_rings(b, 0.075, 0.068, 0.06), 'top', tag='sleeve')
            cuff(mb, J, W, s, b, 0.06, mat='top', length=0.04)
            L.build_hand(mb, J, W, s, sc=1.2)
        # cardigan pockets
        for sx in (1, -1):
            pp = torso.at(hipz + 0.01, 90 - sx * 48, 0.004)
            L.box(mb, pp[0], pp[1].cross(V(0, 0, 1)), (0, 0, 1), pp[1], 0.05, 0.045, 0.01, 'top', wt, bevel=0.008, name='pocket')
        pelvis(mb, J, W, hw=0.16, fr=0.11, bk=0.12)
        for s in ('L', 'R'):
            trousers(mb, J, W, s, 0.1, 0.092, 0.082, bunch=0.1)
        rng = {s: L.build_shoe(mb, J, W, s, 'loafer', sole='gear', sc=1.02) for s in ('L', 'R')}
        # flat cap over thin grey hair, glasses in the face decal
        H = std_neck_head(mb, J, W, ears=True)
        hem = hair_hem(H, H.eye_z + 0.06, H.O.z + 0.04, H.O.z + 0.01, side_angle=45)
        L.hair_cap(mb, H, hem, lambda th, t: 0.01 + 0.004 * t, n=12, rows=3)
        zc = H.eye_z + 0.048
        hat_crown(mb, H, zc, 0.012, 0.03, 'gear', n=14, top_flat=1.4)
        cap_brim(mb, H, zc + 0.006, 0.026, 0.055, 110.0, dir_deg=90.0, tilt=-0.35, mat='gear', thick=0.01)
        # moustache
        L.blob(mb, V(0, H.face_y + 0.004, H.eye_z - 0.072), 0.03, 0.008, 0.008, 'hair', {'head': 1.0}, n=6, rows=3, name='moustache')
        decal_face(mb, H, 'elder')

    walk = dict(chest_yaw=0.12, hip_yaw=0.08, lean=0.12, chest_pitch=0.14, neck_pitch=-0.05, head_pitch=-0.12, arm_swing=0.2,
                bounce=0.01, head_bob=0.015, sway=0.03, hip_roll=0.05, step_w=0.1, toe_out=0.2, a2=0.4, pitch_hs=0.22, pitch_to=0.45)
    return dict(build=b, parts=parts, colors=colors, walk=walk, fast=dict(lean=0.16, arm_swing=0.3), skates=False,
                arms=('behind', 'behind'), idle=dict(look=0.3, shift=0.02))


@variant
def twintails():
    b = L.Build(shin=0.38, thigh=0.39, upper_arm=0.26, forearm=0.24, shoulder_w=0.152, hip_w=0.08, l_hips=0.1, l_spine=0.13,
                l_chest=0.15, l_neck=0.08, l_head=0.19, ankle_h=0.13, head_scale=1.05, hand=0.085)
    colors = dict(skin='#f6d6bc', hair='#2bd0e0', top='#f7b6d2', top2='#2a2438', bottom='#2a2438',
                  shoes='#f2f0f4', accent='#ff3d7a', gear='#2a2438', detail='#ffffff')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        wt = lambda q: W.torso(q, skirt=0.3)
        # oversized cardigan sweater: slouchy, long, sleeves over the hands
        jr = [(hipz - 0.06, 0.188, 0.132, 0.132, 0.0, 2.5), (hz + 0.02, 0.18, 0.13, 0.126, 0.0, 2.5),
              (sz + 0.04, 0.178, 0.13, 0.122, 0.0, 2.5)] + upper_rings(J, b, 0.18, 0.13, 0.12, sh_extra=0.035, neck_hw=0.074)
        torso = torso_garment(mb, J, W, jr, skirt=0.3)
        rib_ring(mb, hipz - 0.1, hipz - 0.05, 0.19, 0.134, 0.134, 'top', wt, n=14, name='hem')
        for s in ('L', 'R'):
            ua, fa = b.upper_arm, b.forearm
            L.build_sleeve(mb, J, W, s, sleeve_rings(b, 0.072, 0.07, 0.07, cuff_back=-0.035), 'top', tag='sleeve')
            L.build_sleeve(mb, J, W, s, [(ua + fa - 0.01, 0.072, 0.072, 0.072, 0.07), (ua + fa + 0.04, 0.066, 0.066, 0.066, 0.064)], 'top', n=8, name='cuff')
            L.build_hand(mb, J, W, s, sc=1.08)
        # sailor-ish collar band in accent
        rib_ring(mb, nz - 0.01, nz + 0.03, 0.08, 0.076, 0.084, 'accent', lambda q: W.torso(q), n=10, inner=0.8, name='collar')
        # plaid pleated mini skirt (dark with accent check lines), thigh-high socks, platforms
        zt, zh = hz + 0.0, hipz - 0.17
        skirt(mb, J, W, zt, zh, top=(0.16, 0.112, 0.118), hem=(0.235, 0.2, 0.21), pleats=16, n=16, k=0.8)
        skirt(mb, J, W, zh + 0.035, zh - 0.004, top=(0.232, 0.2, 0.208), hem=(0.244, 0.21, 0.218), n=16, k=0.8, mat='accent', name='border')
        for s in ('L', 'R'):
            bare_leg(mb, J, W, s, hipz + 0.0, kz + 0.1, r_thigh=0.064)
            L.build_leg(mb, J, W, s, [(kz + 0.12, 0.064, 0.058, 0.062, 0.066, 0.004, 0.0), (kz + 0.04, 0.056, 0.052, 0.056, 0.06, 0.004, -0.004),
                                      (kz - 0.08, 0.054, 0.05, 0.052, 0.058, 0.004, -0.006), (az + 0.06, 0.042, 0.04, 0.042, 0.046, 0.004, 0.0),
                                      (az - 0.0, 0.042, 0.04, 0.042, 0.044, 0.004, 0.0)], 'top2', name='sock', foot=0.2,
                        matfn=lambda i, k: 'accent' if i == 0 else 'top2')
        rng = {s: L.build_shoe(mb, J, W, s, 'platform', sole='accent', sc=0.95) for s in ('L', 'R')}
        decal_shoes(mb, J, rng, 'zig')
        # big head, blunt fringe, two high tails on hair.L / hair.R
        H = L.build_head(mb, J, W, hs=1.05)
        L.build_neck(mb, J, W, r=0.035)
        hem = hair_hem(H, H.eye_z + 0.028, H.O.z + 0.02, H.O.z + 0.0, bangs=0.01, side_angle=34)
        thick = lambda th, t: 0.018 + 0.012 * t
        L.hair_cap(mb, H, hem, thick, n=16, rows=4)
        for s, sx in (('L', 1), ('R', -1)):
            root = H.O + V(sx * 0.08, 0.05, 0.15)
            hair_tail(mb, [root, root + V(sx * 0.045, 0.012, -0.045), root + V(sx * 0.075, 0.025, -0.15), root + V(sx * 0.082, 0.03, -0.3),
                           root + V(sx * 0.065, 0.028, -0.43), root + V(sx * 0.045, 0.022, -0.51)], [0.024, 0.036, 0.044, 0.04, 0.028, 0.0],
                      'hair.' + s, n=6, name='tail', up=(0, 1, 0))
            L.blob(mb, root + V(sx * 0.012, 0.004, -0.008), 0.026, 0.028, 0.026, 'accent', {'head': 1.0}, n=6, rows=3, name='scrunchie', tag='hat')
        decal_face(mb, H, 'cute')
        phone(mb, J, 'R', k=1.1)

    tails = lambda J: {'hair.L': (J['head'] + V(0.085, 0.05, 0.15), J['head'] + V(0.16, 0.08, -0.25)),
                       'hair.R': (J['head'] + V(-0.085, 0.05, 0.15), J['head'] + V(-0.16, 0.08, -0.25))}
    walk = dict(chest_yaw=0.22, arm_swing=0.42, step_w=0.05, sway=0.02, hip_roll=0.085, elbow=0.35, head_bob=0.04,
                hair_swing=0.2, head_pitch=0.14, neck_pitch=0.06, swing_L=1.1)
    return dict(build=b, parts=parts, colors=colors, walk=walk, skates=False, arms=(None, 'phone'), extras_fn=tails,
                idle=dict(look=0.25, phone='phone'))


@variant
def punk():
    b = L.Build(shin=0.45, thigh=0.45, upper_arm=0.30, forearm=0.27, shoulder_w=0.19, ankle_h=0.12)
    colors = dict(skin='#e8bc9c', hair='#ff2f6e', top='#16161c', top2='#f2f0ea', bottom='#3a64a8',
                  shoes='#16161c', accent='#c8c8d2', gear='#16161c')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        wt = lambda q: W.torso(q, skirt=0.12)
        # cropped leather jacket over a white tee
        jr = [(hipz + 0.02, 0.16, 0.108, 0.114, 0.0, 2.4), (hz + 0.03, 0.155, 0.104, 0.11, 0.0, 2.4)]
        L.vertical_loft(mb, jr + [(sz + 0.02, 0.16, 0.108, 0.108, 0.0, 2.4)], 'top2', wt, n=12, name='tee', tag='torso')
        cr = [(hz - 0.0, 0.178, 0.124, 0.128, 0.0, 2.4), (sz + 0.06, 0.192, 0.132, 0.13, 0.0, 2.5)] + \
            upper_rings(J, b, 0.2, 0.138, 0.13, sh_extra=0.03)
        torso = torso_garment(mb, J, W, cr, skirt=0.12, n=16)
        # tee showing at the open front: a patch over the jacket front
        Sv = lambda u, v: torso.at(lerp(hz + 0.0, nz - 0.01, u), 90 + lerp(-1, 1, v) * lerp(16, 26, u))
        L.patch(mb, Sv, [0, 0.5, 1], [0, 0.5, 1], 0.004, -0.008, 'top2', wt, name='teefront')
        logo_print(mb, torso, 'tag', sz + 0.07, 90.0, 0.1, wt, mat='top2', off=0.007, n=4, label='tee print')
        # wide lapels + popped collar
        for sx in (1, -1):
            S = (lambda u, v, sx=sx: torso.at(lerp(sz + 0.02, nz + 0.005, u), 90 - sx * (lerp(17, 30, u) + v * lerp(16, 26, u))))
            L.patch(mb, S, [0, 0.5, 1], [0, 0.5, 1], 0.014, -0.004, 'top', wt, name='lapel')
        rr = []
        for z, k, dy in ((nz - 0.03, 1.15, 0.01), (nz + 0.06, 1.3, 0.025), (nz + 0.06, 1.12, 0.025), (nz - 0.03, 0.95, 0.01)):
            rr.append(L.ring((0, dy, z), (0, 0, 1), L.prof(10, 0.085 * k, 0.04 * k, 0.095 * k, p=2.2), lambda q: W.torso(q)))
        mb.loft(rr, 'top', closed=True, name='collar')
        rib_ring(mb, hz - 0.03, hz + 0.01, 0.18, 0.125, 0.13, 'top', wt, n=14, name='waistband')
        # studs on the shoulders
        for sx in (1, -1):
            for k in range(3):
                p, nrm = torso.at(shz + 0.0, 90 - sx * (60 + 25 * k), 0.012)
                L.cone(mb, p, p + nrm * 0.025, 0.012, 'accent', wt, n=4, name='stud', tag='torso')
        for s in ('L', 'R'):
            L.build_sleeve(mb, J, W, s, sleeve_rings(b, 0.076, 0.068, 0.062), 'top', tag='sleeve')
            cuff(mb, J, W, s, b, 0.054, mat='top', length=0.04)
            L.build_hand(mb, J, W, s, sc=1.22)
        # skinny ripped jeans with skin at the knee rips, chain, big boots
        pelvis(mb, J, W, hw=0.155, fr=0.104, bk=0.118)
        for s in ('L', 'R'):
            trousers(mb, J, W, s, 0.086, 0.07, 0.064, hem_z=az + 0.1, x_knee=0.006,
                     matfn=lambda i, k: 'skin' if (i == 2 and k in (7, 0)) or (i == 3 and k == 0) else 'bottom')
        p0 = V(0.14, -0.06, hipz + 0.04)
        L.tube_path(mb, [p0, p0 + V(0.04, 0.03, -0.12), p0 + V(0.02, 0.1, -0.03)], [0.007, 0.007, 0.007], 'accent',
                    lambda q: W.torso(q, skirt=0.5), n=4, name='chain')
        rng = {s: L.build_shoe(mb, J, W, s, 'boot', sole='accent', sc=1.12) for s in ('L', 'R')}
        # mohawk: tall fins along the midline over shaved sides
        H = std_neck_head(mb, J, W, ears=True)
        hem = hair_hem(H, H.eye_z + 0.05, H.O.z + 0.06, H.O.z + 0.02)
        L.hair_cap(mb, H, hem, lambda th, t: 0.006, n=12, rows=3, mat='gear')
        fins = [(H.eye_z + 0.07, 90, 0.13, -0.25), (H.O.z + 0.165, 90, 0.16, 0.0), (H.O.z + 0.19, 120, 0.17, 0.35),
                (H.O.z + 0.16, 270, 0.16, 0.7), (H.O.z + 0.1, 270, 0.13, 1.0), (H.O.z + 0.045, 270, 0.1, 1.35)]
        for z, th, ln, back in fins:
            if th == 120:
                p, nrm = H.apex + V(0, 0.0, 0.0), V(0, 0, 1)
            else:
                p, nrm = H.hair_surf.at(z, th, 0.0)
            d = (nrm * 0.6 + V(0, math.sin(back) * 0.8, math.cos(back) * 0.8)).normalized()
            L.cone(mb, p - nrm * 0.01, p + d * ln, 0.045, 'hair', {'head': 1.0}, n=4, ry=0.014, up=(1, 0, 0), name='fin')
        decal_face(mb, H, 'fierce')

    walk = dict(chest_yaw=0.42, arm_swing=0.5, arm_out=0.24, elbow=0.2, elbow_swing=0.2, sh_fwd=0.2, lean=-0.04, head_bob=0.04,
                hip_yaw=0.15, bounce=0.024, shrug=0.04, head_pitch=-0.05, step_w=0.095)
    return dict(build=b, parts=parts, colors=colors, walk=walk, skates=False, idle=dict(look=0.55, stance_w=0.15, toe_out=0.28))


@variant
def jersey():
    b = L.Build(shin=0.46, thigh=0.46, upper_arm=0.31, forearm=0.28, shoulder_w=0.192, hip_w=0.09,
                ankle_h=0.165, ball_h=0.11, skates=True)
    colors = dict(skin='#8a5a3e', hair='#1a1210', top='#ffd21e', top2='#7a2ad8', bottom='#7a2ad8',
                  shoes='#16161c', accent='#ffd21e', gear='#16161c')

    def parts(mb, J, W):
        hz, sz, cz, nz, shz, hipz, kz, az = Z(J)
        wt = lambda q: W.torso(q, skirt=0.25)
        # basketball jersey: tank with contrasting trim, long and loose
        jr = [(hipz - 0.08, 0.182, 0.126, 0.13, 0.0, 2.4), (hz + 0.02, 0.178, 0.124, 0.124, 0.0, 2.4),
              (sz + 0.06, 0.188, 0.13, 0.126, 0.0, 2.5)] + upper_rings(J, b, 0.196, 0.134, 0.128, sh_extra=-0.01, top_k=0.55, neck_hw=0.075)
        torso = torso_garment(mb, J, W, jr, skirt=0.25, matfn=lambda i, k, a: 'top2' if i == 0 else None)
        rib_ring(mb, nz - 0.03, nz + 0.0, 0.082, 0.082, 0.088, 'top2', lambda q: W.torso(q), n=10, inner=0.85, name='neckline')
        logo_print(mb, torso, 'number', cz - 0.06, 90.0, 0.17, lambda q: W.torso(q), label='jersey front')
        logo_print(mb, torso, 'number', cz - 0.02, 270.0, 0.24, lambda q: W.torso(q), label='jersey back')
        for s in ('L', 'R'):
            # bare arms out of the armhole, wristband
            L.build_sleeve(mb, J, W, s, [(-0.05, 0.05, 0.056, 0.056, 0.05), (0.0, 0.064, 0.066, 0.066, 0.062), (0.1, 0.06, 0.062, 0.06, 0.058),
                                         (b.upper_arm - 0.03, 0.05, 0.052, 0.05, 0.048), (b.upper_arm + 0.03, 0.046, 0.048, 0.046, 0.044),
                                         (b.upper_arm + b.forearm - 0.02, 0.036, 0.038, 0.036, 0.034)], 'skin', name='arm')
            L.build_sleeve(mb, J, W, s, [(-0.04, 0.072, 0.074, 0.074, 0.07), (0.03, 0.076, 0.078, 0.078, 0.074)], 'top2', n=8, name='armhole')
            L.build_sleeve(mb, J, W, s, [(b.upper_arm + b.forearm - 0.09, 0.046, 0.048, 0.046, 0.044), (b.upper_arm + b.forearm - 0.02, 0.044, 0.046, 0.044, 0.042)],
                           'accent', n=8, name='wristband')
            L.build_hand(mb, J, W, s, sc=1.26)
        # long baggy shorts with side stripe
        angs, edges = L.angles_with_strips(8, [(0.0, 7.0)], start=0.0)
        pelvis(mb, J, W, hw=0.17, fr=0.115, bk=0.13)
        for s in ('L', 'R'):
            trousers(mb, J, W, s, 0.116, 0.112, 0.114, hem_z=kz - 0.09, x_knee=0.012, angles=angs,
                     matfn=lambda i, k: 'accent' if k in edges else 'bottom')
            bare_leg(mb, J, W, s, kz - 0.06, kz - 0.17, r_calf=0.056)
            L.build_leg(mb, J, W, s, [(kz - 0.16, 0.056, 0.052, 0.054, 0.06, 0.004, -0.004), (0.25, 0.05, 0.046, 0.048, 0.052, 0.004, 0.0)],
                        'top2', name='sock')
            L.build_skate(mb, J, W, s, 'inline', boot='shoes', frame='top2', wheel='accent', cuff='top2')
        # afro + headband
        H = std_neck_head(mb, J, W, ears=True)
        hem = hair_hem(H, H.eye_z + 0.045, H.O.z + 0.05, H.O.z + 0.015)
        L.hair_cap(mb, H, hem, lambda th, t: 0.012, n=12, rows=3)
        lump = lambda th, ph: 1.0 + 0.07 * math.sin(3 * th + 1.3) * math.cos(2 * ph) + 0.05 * math.sin(5 * th)
        L.blob(mb, H.O + V(0, 0.03, 0.16), 0.145, 0.145, 0.13, 'hair', {'head': 1.0}, n=12, rows=6, lump=lump, name='afro')
        head_band(mb, H, H.eye_z + 0.045, H.eye_z + 0.075, 0.03, 0.006, 'accent', n=14, flat=True, name='headband')
        decal_face(mb, H, 'grin')

    walk = dict(chest_yaw=0.36, arm_swing=0.5, arm_out=0.2, elbow=0.24, sh_fwd=0.16, lean=0.0, head_bob=0.035, hip_yaw=0.14)
    return dict(build=b, parts=parts, colors=colors, walk=walk, skates=True, skate=dict(lean=0.48, arm_swing=0.9, crouch=0.16),
                idle=dict(look=0.5, stance_w=0.15))


# --------------------------------------------------------------------------------------
# Alternate palettes (partial slot overrides on top of each variant's default colours).
# The game picks one per spawned person, so the same mesh never walks by twice in the
# same clothes. Linked slots (suit = top + bottom, uniform navy) are kept together.
# --------------------------------------------------------------------------------------

PALETTES = {
    'bomber': [dict(top='#2a2a35', top2='#ffd21e', bottom='#56703c', accent='#ffd21e', skin='#c98e68', hair='#3a2a20'),
               dict(top='#c8283a', top2='#f2f0ea', bottom='#24242e', accent='#31e0c8', skin='#f4d2b4', hair='#c8a070'),
               dict(top='#3d7bd8', top2='#ff7a2a', bottom='#c8b89a', accent='#ff7a2a', skin='#8a5a3e', hair='#16141a')],
    'hoodie': [dict(top='#ff5a3c', accent='#31e0c8', bottom='#2a3a6a', skin='#f0c8a8', hair='#16141a'),
               dict(top='#ffd21e', accent='#7a2ad8', bottom='#24242e', skin='#8a5a3e', hair='#1a1210'),
               dict(top='#f2f0ea', accent='#ff3d7a', bottom='#56703c', top2='#ff3d7a', skin='#e8b48e', hair='#7a5ad8')],
    'longcoat': [dict(top='#2a2a35', accent='#c8a878', bottom='#c8b89a', top2='#c8283a', skin='#e8b48e'),
                 dict(top='#56703c', accent='#2a1e1a', bottom='#24242e', top2='#f2f0ea', skin='#a8704e', hair='#2a1810'),
                 dict(top='#8a2a3a', accent='#1a1820', bottom='#2a2a35', top2='#1a1820', skin='#f4d2b4', hair='#c8a070')],
    'schoolgirl': [dict(top2='#1f5a3a', bottom='#1f5a3a', accent='#ffd21e', hair='#16141a', skin='#e8c0a0'),
                   dict(top2='#5a2a3a', bottom='#5a2a3a', accent='#31e0c8', hair='#8a4a2a', skin='#f4d2b4'),
                   dict(top='#f2e6c8', top2='#24242e', bottom='#24242e', accent='#ff3d7a', hair='#3a2a20', skin='#c98e68')],
    'salaryman': [dict(top='#2a2a30', bottom='#2a2a30', accent='#3d7bd8', skin='#f0c8a8', hair='#2a2420'),
                  dict(top='#6a6a72', bottom='#6a6a72', accent='#ffd21e', top2='#dfe8f4', skin='#a8704e', hair='#16141a'),
                  dict(top='#3a3226', bottom='#3a3226', accent='#2a8a5a', skin='#e8b48e', hair='#9a9aa0')],
    'roller': [dict(hair='#ffd21e', bottom='#31e0c8', accent='#ff5a3c', top2='#ff5a3c', skin='#c98e68'),
               dict(hair='#16141a', bottom='#7a2ad8', accent='#ffd21e', top2='#24242e', skin='#8a5a3e'),
               dict(hair='#2bd0e0', bottom='#ff3d7a', accent='#f2f0ea', top='#24242e', top2='#ff3d7a', skin='#f4d2b4')],
    'puffer': [dict(top='#2a2a35', accent='#ff5a3c', bottom='#56703c', skin='#f0c8a8'),
               dict(top='#c8283a', accent='#f2f0ea', bottom='#24242e', gear='#24242e', skin='#8a5a3e'),
               dict(top='#9ad04a', accent='#7a2ad8', bottom='#2a2a35', skin='#e8b48e', hair='#5a3a28')],
    'tracksuit': [dict(top='#2a3a8a', bottom='#2a3a8a', accent='#ff5a3c', skin='#f0c8a8'),
                  dict(top='#c8283a', bottom='#c8283a', accent='#f2f0ea', gear='#f2f0ea', skin='#c98e68'),
                  dict(top='#24242e', bottom='#24242e', accent='#ffd21e', skin='#8a5a3e', hair='#16141a')],
    'dress': [dict(top='#9ad0f0', bottom='#9ad0f0', top2='#2a3a8a', shoes='#2a3a8a', accent='#ff8a1e', hair='#16141a'),
              dict(top='#ffd21e', bottom='#ffd21e', top2='#f2f0ea', shoes='#f2f0ea', accent='#c8283a', skin='#a8704e', hair='#2a1810'),
              dict(top='#ff8ab8', bottom='#ff8ab8', top2='#24242e', shoes='#24242e', accent='#31e0c8', hair='#c8a070')],
    'courier': [dict(top='#1f8a5a', gear='#ffd21e', accent='#24242e', skin='#f0c8a8'),
                dict(top='#ff5a3c', gear='#24242e', accent='#31e0c8', bottom='#2a3a6a', skin='#8a5a3e'),
                dict(top='#ffd21e', gear='#2a3a8a', accent='#ff5a3c', skin='#c98e68', hair='#3a2a20')],
    'elder': [dict(top='#3a5a3a', bottom='#4a4440', gear='#8a6a4a', skin='#c98e68'),
              dict(top='#7a2a2a', bottom='#5a5a62', gear='#2a2a30', hair='#f2f0ea', skin='#f0c8a8'),
              dict(top='#c8b48a', bottom='#3a3a44', gear='#5a4030', top2='#9ad0f0', skin='#8a5a3e')],
    'twintails': [dict(hair='#ff5f9e', top='#f2f0ea', accent='#31e0c8', shoes='#24242e', skin='#e8c0a0'),
                  dict(hair='#ffd21e', top='#9ad0f0', accent='#7a2ad8', top2='#f2f0ea', skin='#c98e68'),
                  dict(hair='#7a5ad8', top='#24242e', accent='#ffd21e', top2='#24242e', bottom='#c8283a')],
    'punk': [dict(hair='#31e0c8', bottom='#24242e', top2='#ffd21e', skin='#c98e68'),
             dict(hair='#ffd21e', top='#7a2a2a', bottom='#2a3a6a', skin='#f4d2b4'),
             dict(hair='#9ad04a', top='#24242e', bottom='#c8283a', top2='#f2f0ea', accent='#ffd21e', skin='#8a5a3e')],
    'jersey': [dict(top='#c8283a', top2='#f2f0ea', bottom='#f2f0ea', accent='#c8283a', skin='#c98e68'),
               dict(top='#1f8a5a', top2='#ffd21e', bottom='#ffd21e', accent='#1f8a5a', skin='#6e4630'),
               dict(top='#2a3a8a', top2='#ff8a1e', bottom='#ff8a1e', accent='#f2f0ea', skin='#e8b48e', hair='#3a2a20')],
}


# ======================================================================================
# Pipeline
# ======================================================================================

def styles(spec):
    st = dict(L.WALK)
    st.update({k: v for k, v in spec.get('walk', {}).items() if v is not None})
    fast = dict(st)
    fast.update(dict(duty=0.58, pitch_hs=0.36, pitch_to=0.7, lift=0.04, hip_drop=0.04, bounce=0.02,
                     lean=st['lean'] + 0.07, arm_swing=st['arm_swing'] * 1.25, elbow=st['elbow'] + 0.25,
                     elbow_swing=0.55, hip_yaw=st['hip_yaw'] * 1.2, chest_yaw=st['chest_yaw'] * 1.1))
    fast.update({k: v for k, v in spec.get('fast', {}).items() if v is not None})
    sk = dict(L.SKATE)
    sk.update(spec.get('skate', {}))
    idle = dict(toe_out=0.2, stagger=0.06, stance_w=0.12, shift=0.035, roll=0.6, drop=0.012, look=0.45, phone=None)
    idle.update(spec.get('idle', {}))
    return st, fast, sk, idle


def arm_mode(name, J, ex):
    """Named arm behaviours -> mode callables (see gen_walk). Points are rest-space,
    carried by the named bone, given for the left side and mirrored for the right."""
    if name is None or name == 'swing':
        return 'swing'
    if callable(name):
        return name
    hipz, shz = J['hip_z'], J['sh_z']
    if name == 'pocket':          # hands in front coat/jacket pockets
        return mode_ik('hips', (0.19, -0.08, hipz - 0.005), (1.0, 0.8, -0.1), swing=0.01,
                       hand_abs=hand_dir('hips', (-0.3, 0.2, -0.93), (-1.0, 0.0, 0.0)))
    if name == 'trouser_pocket':  # hands in trouser side pockets
        return mode_ik('hips', (0.165, -0.04, hipz + 0.02), (1.0, 0.6, -0.1), swing=0.01,
                       hand_abs=hand_dir('hips', (-0.25, 0.1, -0.96), (-1.0, 0.0, 0.0)))
    if name == 'shoulder_carry':  # gripping a bag handle on top of the shoulder
        return mode_ik('chest', (0.13, -0.12, shz - 0.01), (0.25, -1.0, -0.6),
                       hand_abs=hand_dir('chest', (0.05, 0.75, 0.66), (0.0, 0.66, -0.75)))
    if name == 'strap':           # thumbs hooked under backpack straps
        return mode_ik('chest', (0.135, -0.135, shz - 0.2), (0.9, 0.3, -1.0), swing=0.006,
                       hand_abs=hand_dir('chest', (-0.12, 0.25, 0.96), (-0.2, 1.0, 0.0)))
    if name == 'behind':          # hands clasped behind the lower back
        return mode_ik('hips', (0.045, 0.19, hipz + 0.07), (1.0, 0.6, -0.3), swing=0.004,
                       hand_abs=hand_dir('hips', (-0.85, 0.3, -0.42), (0.1, 1.0, 0.0)))
    if name == 'hold':            # carrying something heavy: short swing, straight arm
        return mode_hold()
    if name == 'phone':
        return phone_idle(J)
    raise KeyError(name)


def bag_mode(name, J, ex):
    if name is None or name == 'none':
        return 'none'
    if callable(name):
        return name
    head, tail = ex['bag']
    if name == 'hand_R':
        return hanging_bag_mode('R', Vector(head))
    if name == 'hand_L':
        return hanging_bag_mode('L', Vector(head))
    if name == 'shoulder_bag':
        return pivot_bag_mode('shoulder.R', Vector(head), swing=0.06, side=0.05)
    if name == 'shoulder_bag_low':
        return pivot_bag_mode('shoulder.R', Vector(head), swing=0.05, side=0.04, lag=0.12)
    if name == 'crossbody':
        return pivot_bag_mode('chest', Vector(head), swing=0.08, side=0.07, lag=0.15)
    if name == 'backpack':
        return pivot_bag_mode('chest', Vector(head), swing=0.035, side=0.03, lag=0.1)
    raise KeyError(name)


def build_variant(name, export=True):
    spec = VARIANTS[name]()
    b = spec['build']
    J, bones = L.skeleton(b)
    ex = dict(spec.get('extras') or {})
    if spec.get('extras_fn'):
        ex.update(spec['extras_fn'](J))
    mb = L.MB()
    W = L.Wt(J, b)
    spec['parts'](mb, J, W)
    if spec.get('extras_dyn'):
        ex.update(spec['extras_dyn'])
    # sole contact points (rest space) for the gait's ground clearance: lowest footwear
    # vertex per 1 cm slice along the foot, each side of the foot's centre line
    for s in ('L', 'R'):
        bins = {}
        for vi, (p, w) in enumerate(zip(mb.verts, mb.wts)):
            if p.z > 0.05 or not w:
                continue
            bone = max(w.items(), key=lambda kv: kv[1])[0]
            if bone not in ('foot.' + s, 'toe.' + s):
                continue
            key = (round(p.y / 0.01), p.x > J['ankle.' + s].x)
            if key not in bins or p.z < bins[key][1].z:
                bins[key] = (bone == 'toe.' + s, p.copy())
        J['sole.' + s] = list(bins.values())
    if '--shells' in sys.argv:
        agg = {}
        for f0, f1, nm in mb.shells:
            agg[nm] = agg.get(nm, 0) + sum(len(mb.faces[i]) - 2 for i in range(f0, f1))
        print('   shells:', ', '.join(f'{k} {v}' for k, v in sorted(agg.items(), key=lambda kv: -kv[1])))
    bones += L.extra_bones(J, ex)
    ex = {n: (h, t) for n, h, t, _p, _r in L.extra_bones(J, ex)}
    L.reset_scene(FPS)
    arm = L.make_armature('rig_' + name, bones)
    rig = L.Rig(arm, J)
    ob = L.make_mesh(name, mb, spec['colors'], arm, BLANK_UV)
    ob['person_variant'] = name
    ob['skates'] = bool(spec['skates'])
    st, fast, sk, idle = styles(spec)
    arms = spec.get('arms', (None, None))
    for d in (st, fast):
        d['arm_L'], d['arm_R'] = arm_mode(arms[0], J, ex), arm_mode(arms[1], J, ex)
        d['bag'] = bag_mode(spec.get('bag'), J, ex)
    # skating always swings free arms; things held in a hand stay held
    sk_st = dict(st)
    sk_arms = spec.get('skate_arms', tuple(a if a in ('hold', 'shoulder_carry', 'strap') else None for a in arms))
    sk_st['arm_L'], sk_st['arm_R'] = arm_mode(sk_arms[0], J, ex), arm_mode(sk_arms[1], J, ex)
    id_st = dict(st)
    if isinstance(idle.get('phone'), str):
        idle['phone'] = arm_mode(idle['phone'], J, ex)
    if spec['skates']:
        st['flat'] = True
        fast['flat'] = True
    clips = [L.gen_walk(rig, J, st, 'walk', WALK_T, WALK_S, FPS),
             L.gen_walk(rig, J, fast, 'walk_fast', FAST_T, FAST_S, FPS),
             L.gen_skate(rig, J, sk_st, sk, 'skate', SKATE_T, SKATE_V, FPS),
             L.gen_idle(rig, J, id_st, 'idle', IDLE_T, FPS, idle)]
    cols = dict(detail='#ffffff')
    cols.update(spec['colors'])
    report = {'name': name, 'tris_builder': mb.tri_count(), 'skates': bool(spec['skates']), 'clips': {}, 'colors': cols}
    for c in clips:
        act, diag = L.bake_clip(arm, rig, c)
        reach = max(max(d['reach.L'], d['reach.R']) for d in diag)
        miss = max(max(d['miss.L'], d['miss.R']) for d in diag)
        report['clips'][c.name] = dict(frames=c.frames, seconds=round(c.frames / FPS, 4), speed=round(c.speed, 3),
                                       max_reach=round(reach, 3), max_ankle_miss_mm=round(miss * 1000, 1))
    if export:
        path = os.path.join(OUT, f'person_{name}.glb')
        L.export_glb(path)
        info = L.inspect_glb(path)
        report['glb'] = info
    return report


def main():
    args = sys.argv[1:]
    only = None
    export = '--no-export' not in args
    if '--only' in args:
        only = args[args.index('--only') + 1].split(',')
    os.makedirs(OUT, exist_ok=True)
    L.reset_scene(FPS)
    build_atlas(os.path.join(OUT, 'detail.png'))
    reports = []
    for name in VARIANTS:
        if only and name not in only:
            continue
        print(f'== {name}')
        r = build_variant(name, export)
        reports.append(r)
        g = r.get('glb', {})
        print(f"   tris {g.get('triangles', r['tris_builder'])}  mats {g.get('materials')}  anims {g.get('animations')}")
        for cn, cd in r['clips'].items():
            print(f'   {cn}: {cd}')
    if export and not only:
        man = dict(atlas='detail.png', fps=FPS,
                   clips=dict(walk=dict(seconds=WALK_T, speed=round(WALK_S / WALK_T, 4), stride=WALK_S),
                              walk_fast=dict(seconds=FAST_T, speed=round(FAST_S / FAST_T, 4), stride=FAST_S),
                              skate=dict(seconds=SKATE_T, speed=SKATE_V), idle=dict(seconds=IDLE_T, speed=0.0)),
                   slots=list(L.SLOTS),
                   variants=[dict(name=r['name'], file=f"person_{r['name']}.glb", skates=r['skates'],
                                  triangles=r['glb']['triangles'], height=round(r['glb']['bbox_max'][1], 3),
                                  palettes=[r['colors']] + [dict(r['colors'], **alt) for alt in PALETTES.get(r['name'], [])])
                             for r in reports])
        with open(os.path.join(OUT, 'people.json'), 'w') as f:
            json.dump(man, f, indent=1)
    return reports


if __name__ == '__main__':
    main()
