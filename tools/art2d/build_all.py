"""Builds all 2D art for the game.

    python3 tools/art2d/build_all.py

Outputs:
  assets/sprites/nature.png + nature.json   atlas of upright sprites, ground decals and shadows
  assets/sprites/ground_*.png, noise.png    tileable ground textures (256 px = 8 m)
  tools/art2d/out/review_*.png              sheets for the critic
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ground as G  # noqa: E402
import nature as N  # noqa: E402
from paint import PX_PER_M, Canvas  # noqa: E402

ROOT = HERE.parent.parent
SPRITES = ROOT / "assets" / "sprites"
OUT = HERE / "out"


# name -> (painter result, metadata)
def nature_sprites():
    s = {}

    def add(name, res, kind, collider=0.0, sway=0.0, radius=0.0):
        s[name] = (res, {"kind": kind, "collider": collider, "sway": sway, "radius": radius})

    # trees (radius = crown radius in meters, used for spacing)
    add("oak_round_1", N.oak(11, "round"), "tree", 0.35, 0.05, 2.5)
    add("oak_round_2", N.oak(23, "round"), "tree", 0.35, 0.05, 2.5)
    add("oak_wide_1", N.oak(37, "wide"), "tree", 0.4, 0.05, 3.9)
    add("oak_tall_1", N.oak(43, "tall"), "tree", 0.33, 0.05, 2.0)
    add("oak_lean_1", N.oak(47, "lean"), "tree", 0.33, 0.05, 2.4)
    add("oak_twin_1", N.oak(59, "twin"), "tree", 0.5, 0.05, 3.2)
    add("oak_hero_1", N.oak(61, "hero"), "tree", 0.6, 0.04, 3.8)
    add("oak_autumn_1", N.oak(41, "round", pal_name="oak_autumn"), "tree", 0.35, 0.05, 2.5)
    add("oak_blossom_1", N.oak(53, "wide", pal_name="oak_blossom", blossoms=(["white", "pink"], 34)), "tree", 0.4, 0.05, 3.9)
    add("birch_1", N.birch(3), "tree", 0.15, 0.06, 1.7)
    add("birch_2", N.birch(8, height_m=7.2), "tree", 0.15, 0.06, 1.7)
    add("dead_1", N.dead_tree(5), "tree", 0.25, 0.0, 1.6)
    add("pine_s_1", N.pine(4, height_m=4.2, width_m=2.2), "tree", 0.2, 0.04, 1.1)
    add("pine_1", N.pine(5), "tree", 0.3, 0.04, 1.6)
    add("pine_2", N.pine(9, height_m=8.4, width_m=3.6), "tree", 0.3, 0.04, 1.8)
    add("pine_t_1", N.pine(13, height_m=10.2, width_m=3.8), "tree", 0.35, 0.03, 1.9)
    # bushes
    add("bush_1", N.bush(1), "bush", 0.55, 0.02, 0.9)
    add("bush_2", N.bush(2, blossoms=(["white", "pink"], 10)), "bush", 0.55, 0.02, 0.9)
    add("bush_3", N.bush(3, berries=True), "bush", 0.55, 0.02, 0.9)
    add("bush_4", N.bush(4, width_m=1.2, height_m=0.85), "bush", 0.4, 0.02, 0.6)
    add("hedge_1", N.hedge(6), "bush", 1.2, 0.01, 1.3)
    # rocks
    add("rock_s1", N.rock(1, width_m=0.55, height_m=0.35, moss=0.1), "rock", 0.2, 0, 0.3)
    add("rock_s2", N.rock(2, width_m=0.7, height_m=0.45, moss=0.3), "rock", 0.25, 0, 0.35)
    add("rock_m1", N.rock(3, width_m=1.1, height_m=0.75), "rock", 0.45, 0, 0.55)
    add("rock_m2", N.rock(4, width_m=1.3, height_m=0.6, moss=0.5), "rock", 0.5, 0, 0.65)
    add("rock_buried_1", N.rock(14, width_m=1.2, height_m=0.5, buried=0.5, moss=0.4), "rock", 0.4, 0, 0.6)
    add("boulder_1", N.rock(5, width_m=1.6, height_m=1.3, moss=0.45), "rock", 0.75, 0, 0.8)
    add("rock_group_1", N.rock(15, width_m=1.3, height_m=0.85, lumps=3, moss=0.3), "rock", 0.95, 0, 1.2)
    # small plants and props
    for i, (w, h) in enumerate([(10, 8), (12, 10), (9, 9), (12, 8)], 1):
        add(f"grass_{i}", N.grass_tuft(i, w, h), "grass")
    add("grass_flower_y", N.grass_tuft(7, 12, 11, flowers="yellow", nflowers=3), "grass")
    add("grass_flower_w", N.grass_tuft(8, 12, 11, flowers="white", nflowers=3), "grass")
    add("grass_flower_l", N.grass_tuft(9, 12, 11, flowers="lilac", nflowers=2), "grass")
    add("tall_grass_1", N.tall_grass(1), "grass", 0, 0.12)
    add("tall_grass_2", N.tall_grass(2, 22, 20, 1), "grass", 0, 0.12)
    add("fern_1", N.fern(1), "grass", 0, 0.05)
    add("fern_2", N.fern(2, 22), "grass", 0, 0.05)
    add("tall_flowers_l", N.tall_flowers(1, "lilac"), "grass", 0, 0.08)
    add("tall_flowers_y", N.tall_flowers(2, "yellow"), "grass", 0, 0.08)
    add("mushrooms_1", N.mushrooms(1), "grass")
    add("stump_1", N.stump(1), "prop", 0.35, 0, 0.4)
    add("log_1", N.log(1), "prop", 0.5, 0, 1.0)
    # flat ground decals
    for i, cols in enumerate([("white",), ("yellow",), ("lilac",), ("blue",), ("red",), ("white", "yellow", "lilac", "blue")], 1):
        add(f"decal_flowers_{i}", N.flower_decal(i, cols, size_m=1.6 + 0.45 * (i % 4)), "decal")
    # small single-color clumps and long drifts (G1 review: more variety, less "round stamps")
    for i, (col, size, aspect) in enumerate([("white", 1.0, 1.0), ("yellow", 1.1, 1.0), ("lilac", 0.9, 1.0), ("blue", 1.2, 1.0),
                                             ("white", 2.6, 2.4), ("yellow", 2.2, 2.1), ("lilac", 2.4, 2.6)], 7):
        add(f"decal_flowers_{i}", N.flower_decal(i * 3, (col,), size_m=size, aspect=aspect), "decal")
    for col in N.BUTTERFLY:
        for fr in (0, 1):
            add(f"butterfly_{col}_{fr}", N.butterfly(col, fr), "fx")
    add("decal_leaves_dry", N.leaves_decal(1), "decal")
    add("decal_leaves_autumn", N.leaves_decal(2, (("#e0a040", "#8f4030"), ("#d0702e", "#7a3c29"))), "decal")
    add("decal_clover_1", N.clover_decal(3), "decal")
    add("decal_pebbles_1", N.pebbles_decal(4), "decal")
    return s


def pack(images, width=1024, pad=2):
    """Simple shelf packer: returns {name: (x, y)} and the atlas height (power of two)."""
    order = sorted(images, key=lambda k: -images[k].height)
    x = y = shelf_h = 0
    pos = {}
    for name in order:
        im = images[name]
        if x + im.width + pad > width:
            x = 0
            y += shelf_h + pad
            shelf_h = 0
        pos[name] = (x, y)
        x += im.width + pad
        shelf_h = max(shelf_h, im.height)
    h = y + shelf_h
    p2 = 1
    while p2 < h:
        p2 *= 2
    return pos, p2


def build_nature():
    sprites = nature_sprites()
    images, frames = {}, {}
    for name, ((spr, anchor, shadow, sh_anchor), meta) in sprites.items():
        images[name] = spr.to_image()
        frames[name] = {"anchor": [round(float(anchor[0]), 1), round(float(anchor[1]), 1)], **meta}
        if shadow is not None:
            images[name + "_shadow"] = shadow.to_image()
            frames[name + "_shadow"] = {"anchor": [round(float(sh_anchor[0]), 1), round(float(sh_anchor[1]), 1)], "kind": "shadow"}
            frames[name]["shadow"] = name + "_shadow"
    pos, height = pack(images, width=1024)
    atlas = Image.new("RGBA", (1024, height), (0, 0, 0, 0))
    for name, im in images.items():
        atlas.paste(im, pos[name])
        frames[name]["rect"] = [int(pos[name][0]), int(pos[name][1]), int(im.width), int(im.height)]
    for f in frames.values():  # drop zero-valued optional fields
        for k in ("collider", "sway", "radius"):
            if k in f and not f[k]:
                del f[k]
    SPRITES.mkdir(parents=True, exist_ok=True)
    atlas.save(SPRITES / "nature.png", optimize=True)
    manifest = {"image": "nature.png", "size": [1024, height], "pxPerMeter": PX_PER_M,
                "frames": dict(sorted(frames.items()))}
    (SPRITES / "nature.json").write_text(json.dumps(manifest, indent=1))
    print(f"nature atlas 1024x{height}, {len(frames)} frames")
    return sprites, images, frames


def build_ground():
    tiles = {
        "ground_grass_a": G.grass(1),
        "ground_grass_b": G.grass(2, G.GRASS_B, flowers=1.0, contrast=0.6),
        "ground_dirt": G.dirt(3),
        "ground_cobble": G.cobble(4),
        "noise": G.noise_rgb(5),
    }
    for name, c in tiles.items():
        c.to_image().convert("RGB").save(SPRITES / f"{name}.png", optimize=True)
    print("ground textures:", ", ".join(tiles))
    return tiles


def review(sprites, images, frames, tiles):
    OUT.mkdir(exist_ok=True)
    # 1. contact sheet with names on grass, 2x
    grass = tiles["ground_grass_a"].to_image()
    W, H = 1500, 1000
    bg = Image.new("RGBA", (W, H))
    for x in range(0, W, 256):
        for y in range(0, H, 256):
            bg.paste(grass, (x, y))
    draw = ImageDraw.Draw(bg)
    x, y, row = 16, 16, 0
    for name in sprites:
        im = images[name]
        f = frames[name]
        if x + im.width + 16 > W:
            x, y, row = 16, y + row + 26, 0
        if "shadow" in f:
            sh = images[f["shadow"]]
            sa = frames[f["shadow"]]["anchor"]
            bg.alpha_composite(sh, (int(x + f["anchor"][0] - sa[0]), int(y + f["anchor"][1] - sa[1])))
        bg.alpha_composite(im, (x, y))
        draw.text((x, y + im.height + 2), name, fill=(255, 255, 255, 255))
        x += max(im.width, 60) + 16
        row = max(row, im.height)
    bg.resize((W * 2, H * 2), Image.NEAREST).save(OUT / "review_nature_sheet.png")
    # 2. ground tiles 2x2 each
    sheet = Image.new("RGB", (5 * 266, 512 + 10), (20, 20, 24))
    for i, (name, c) in enumerate(tiles.items()):
        im = c.to_image().convert("RGB")
        t = Image.new("RGB", (256, 512))
        t.paste(im, (0, 0))
        t.paste(im, (0, 256))
        sheet.paste(t, (i * 266, 0))
    sheet.save(OUT / "review_ground_tiles.png")


def main():
    sprites, images, frames = build_nature()
    tiles = build_ground()
    review(sprites, images, frames, tiles)


if __name__ == "__main__":
    main()
