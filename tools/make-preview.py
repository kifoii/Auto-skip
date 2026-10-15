# 生成 mod.json 的 preview 图片（1280x720，16:9）。
# 官方仓库 CI 的 tools/lib/image.mjs 要求：PNG/JPG/WebP、>=640x360、
# 宽高比 1.5~2.0、不超过 1 MB。改完样式重跑本脚本即可。
#
#   python tools/make-preview.py

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
OUT = "preview.png"

BG_TOP = (11, 11, 15)
BG_BOTTOM = (24, 22, 30)
ACCENT = (239, 68, 68)
TEXT = (245, 245, 247)
DIM = (150, 150, 160)
MSYH = r"C:\Windows\Fonts\msyh.ttc"
MSYH_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
SEGOE = r"C:\Windows\Fonts\segoeuib.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def text_at(draw, xy, s, f, fill):
    draw.text(xy, s, font=f, fill=fill)


def centered(draw, cx, y, s, f, fill):
    box = draw.textbbox((0, 0), s, font=f)
    draw.text((cx - (box[2] - box[0]) / 2, y), s, font=f, fill=fill)


def pill(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


# 背景渐变
img = Image.new("RGB", (W, H), BG_TOP)
top = Image.new("RGB", (1, H))
for y in range(H):
    t = y / (H - 1)
    top.putpixel((0, y), tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)))
img = top.resize((W, H))
draw = ImageDraw.Draw(img, "RGBA")

# 左上角标题
text_at(draw, (72, 80), "Auto skip", font(SEGOE, 62), TEXT)
text_at(draw, (74, 158), "自动跳过无法播放的歌曲", font(MSYH, 30), DIM)

# 播放失败提示卡（模仿 Folia 顶部的 toast：图标 + 文字 + 跳过 + 重试）
CARD = (72, 268, 1208, 396)
pill(draw, CARD, radius=64, fill=(255, 255, 255, 26), outline=(255, 255, 255, 30), width=2)

# 红色叹号图标
cx, cy, r = 140, 332, 19
draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=ACCENT, width=3)
text_at(draw, (cx - 4, cy - 15), "!", font(SEGOE, 26), ACCENT)

text_at(draw, (188, 310), "暂时无法播放这首歌", font(MSYH, 32), TEXT)

# 「跳过」（次要样式）
text_at(draw, (940, 312), "跳过", font(MSYH, 30), (200, 200, 208))

# 「重试」（白色实心胶囊）
pill(draw, (1052, 296, 1176, 368), radius=36, fill=(255, 255, 255, 255))
centered(draw, 1114, 311, "重试", font(MSYH_BOLD, 30), (24, 24, 27))

# 模组替用户按下「跳过」
text_at(draw, (76, 432), "↑ 本模组直接调用宿主的跳过回调，不再等用户手动点", font(MSYH, 27), (110, 231, 183))

# 三条特性
chips = [
    "接管原版倒计时",
    "连续跳过上限可调",
    "支持模拟点击",
]
x = 72
f = font(MSYH, 26)
for c in chips:
    box = draw.textbbox((0, 0), c, font=f)
    w = box[2] - box[0] + 56
    pill(draw, (x, 536, x + w, 600), radius=32, fill=(255, 255, 255, 20), outline=(255, 255, 255, 26), width=1)
    text_at(draw, (x + 28, 552), c, f, DIM)
    x += w + 20

img.save(OUT, "PNG", optimize=True)
print(f"saved {OUT} {img.size[0]}x{img.size[1]}")
