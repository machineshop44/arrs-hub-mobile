"""Generate Android mipmap + web favicons from Arrs Hub icon.png."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

SRC = Path(r"C:\Users\machi\Desktop\Arrs-Hub\build\icon.png")
MOBILE = Path(r"C:\Users\machi\Desktop\Arrs-Hub-Mobile")
RES = MOBILE / "android" / "app" / "src" / "main" / "res"
PUBLIC = MOBILE / "public"
SCRIPTS = MOBILE / "scripts"


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


def bilinear(
    x: int,
    y: int,
    size: int,
    tl: tuple[int, int, int],
    tr: tuple[int, int, int],
    bl: tuple[int, int, int],
    br: tuple[int, int, int],
) -> tuple[int, int, int, int]:
    u = x / (size - 1)
    v = y / (size - 1)
    top = lerp(tl, tr, u)
    bot = lerp(bl, br, u)
    rgb = lerp(top, bot, v)
    return (*rgb, 255)


def inside_rounded_rect(x: int, y: int, size: int, rad: int) -> bool:
    cx = min(max(x, rad), size - 1 - rad)
    cy = min(max(y, rad), size - 1 - rad)
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad**2


def resize_hq(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.Resampling.LANCZOS)


def make_round(im: Image.Image) -> Image.Image:
    size = im.size[0]
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(im.convert("RGBA"), (0, 0), mask)
    return out


def main() -> None:
    PUBLIC.mkdir(exist_ok=True)
    SCRIPTS.mkdir(exist_ok=True)

    src = Image.open(SRC).convert("RGBA")
    w, h = src.size
    if w != h:
        raise SystemExit(f"Expected square icon, got {w}x{h}")

    # Sample interior corners of the squircle for a matching full-bleed gradient.
    tl = src.getpixel((90, 90))[:3]
    tr = src.getpixel((w - 90, 90))[:3]
    bl = src.getpixel((90, h - 90))[:3]
    br = src.getpixel((w - 90, h - 90))[:3]
    radius = int(w * 0.22)

    full_bleed = Image.new("RGBA", (w, h))
    sp = src.load()
    fp = full_bleed.load()
    for y in range(h):
        for x in range(w):
            if inside_rounded_rect(x, y, w, radius):
                r, g, b, _a = sp[x, y]
                fp[x, y] = (r, g, b, 255)
            else:
                fp[x, y] = bilinear(x, y, w, tl, tr, bl, br)

    master_path = SCRIPTS / "icon-master-1024.png"
    full_bleed.convert("RGB").save(master_path, "PNG")

    mid = bilinear(w // 2, h // 2, w, tl, tr, bl, br)
    bg_hex = "#{:02X}{:02X}{:02X}".format(*mid[:3])
    (SCRIPTS / "icon-bg-color.txt").write_text(bg_hex + "\n", encoding="utf-8")
    print("master", master_path)
    print("bg", bg_hex)

    launcher_sizes = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    fg_sizes = {
        "mipmap-mdpi": 108,
        "mipmap-hdpi": 162,
        "mipmap-xhdpi": 216,
        "mipmap-xxhdpi": 324,
        "mipmap-xxxhdpi": 432,
    }

    master = full_bleed

    for folder, size in launcher_sizes.items():
        dest_dir = RES / folder
        dest_dir.mkdir(parents=True, exist_ok=True)
        icon = resize_hq(master, size).convert("RGBA")
        icon.save(dest_dir / "ic_launcher.png", "PNG")
        make_round(icon).save(dest_dir / "ic_launcher_round.png", "PNG")
        print("launcher", folder, size)

    # Adaptive foreground: slight inset so Samsung circular masks keep the house clear.
    for folder, canvas in fg_sizes.items():
        dest_dir = RES / folder
        content = int(round(canvas * 0.88))
        scaled = resize_hq(master, content).convert("RGBA")
        fg = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        off = (canvas - content) // 2
        fg.paste(scaled, (off, off))
        fg.save(dest_dir / "ic_launcher_foreground.png", "PNG")
        print("foreground", folder, canvas, "content", content)

    # Web / PWA icons
    resize_hq(master, 32).convert("RGBA").save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    resize_hq(master, 32).convert("RGBA").save(PUBLIC / "favicon.png", "PNG")
    resize_hq(master, 180).convert("RGBA").save(PUBLIC / "apple-touch-icon.png", "PNG")
    resize_hq(master, 192).convert("RGBA").save(PUBLIC / "icon-192.png", "PNG")
    resize_hq(master, 512).convert("RGBA").save(PUBLIC / "icon-512.png", "PNG")
    master.convert("RGBA").save(PUBLIC / "app-icon.png", "PNG")
    print("web assets written to", PUBLIC)


if __name__ == "__main__":
    main()
