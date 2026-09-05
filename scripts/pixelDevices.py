#!/usr/bin/env python3
"""
Pixel-art generator for the flight-log devices.

Each device is drawn as an ASCII grid (one char = one pixel) and compiled to an
inline SVG of horizontal-run rects. Regenerating index.html's pile after editing
a grid:  python3 scripts/pixelDevices.py   (prints the <ul> block to stdout).

Chars: . empty / X casing / S shell / N screen / G screen glint
       R buttons / P power light / L label
"""

# Shared tones. Screens all glow the same navy-blue so the pile reads as one
# family of machines whatever the shell colour.
COMMON = {"X": "#0d0d1c", "N": "#1d2340", "G": "#aebdf5", "R": "#E0507E", "P": "#e04444", "L": "#ccd7ff"}

DEVICES = {
  # CI Technologies — the brick. Portrait Game Boy (1989): screen, d-pad, A/B, speaker.
  "gameboy": ("#E0507E", """
.XXXXXXXXXXXX.
XSSSSSSSSSSSSX
XSXXXXXXXXXXSX
XSXNNNNNNNNXSX
XSXNGNNNNNNXSX
XSXNNNNNNNNXSX
XSXNNNNNNGNXSX
XSXXXXXXXXXXSX
XSSSSSSSSSSSSX
XSSSXSSSSSSSSX
XSSXXXSSSSRSSX
XSSSXSSSSRSSSX
XSSSSSSSSSSSSX
XSSSSSSSXXSSSX
XSSSSSSSXXSSSX
.XXXXXXXXXXXX.
"""),
  # Willful — the GBA (2001). Landscape, screen centred, d-pad left, A/B right.
  "gba": ("#0362D8", """
..XXXXXXXXXXXXXXXXXX..
.XSSSSSSSSSSSSSSSSSSX.
XSSSSXXXXXXXXXXXXSSSSX
XSSXSXNNNNNNNNNNXSSRSX
XSXXXXNNGNNNNNNNXSRSSX
XSSXSXNNNNNNNNNNXSSSSX
XSSSSXXXXXXXXXXXXSSSSX
.XSSSSSSSSSSSSSSSSSSX.
..XXXXXXXXXXXXXXXXXX..
"""),
  # Tempo — the DS (2004). Clamshell open: two screens over a hinge, controls low.
  "ds": ("#EDEFF7", """
.XXXXXXXXXXXX.
XSSSSSSSSSSSSX
XSXXXXXXXXXXSX
XSXNNNNNNNNXSX
XSXNGNNNNNNXSX
XSXNNNNNNNNXSX
XSXXXXXXXXXXSX
XXXXXXXXXXXXXX
XSSSSSSSSSSSSX
XSXXXXXXXXXXSX
XSXNNNNNNNNXSX
XSXNNNNNNGNXSX
XSXXXXXXXXXXSX
XSXSSSSSSSRSSX
XSSSSSSSSSSSSX
.XXXXXXXXXXXX.
"""),
  # TD Bank — the SP (2003). Flip-top screen over a squat base of controls.
  "sp": ("#4FBE72", """
.XXXXXXXXXXXX.
XSSSSSSSSSSSSX
XSXXXXXXXXXXSX
XSXNNNNNNNNXSX
XSXNGNNNNNNXSX
XSXNNNNNNNNXSX
XSXXXXXXXXXXSX
XXXXXXXXXXXXXX
XSSSSSSSSSSSSX
XSXSSSSSSRSRSX
XSXXXSSSSSRSSX
XSSSSSSSSSSSSX
.XXXXXXXXXXXX.
"""),
  # Questrade — the Game Gear (1990). Wide slab, screen, red power light.
  "gamegear": ("#33333C", """
..XXXXXXXXXXXXXXXXXX..
.XSSSSSSSSSSSSSSSSSSX.
XSSSSXXXXXXXXXXXXSSSSX
XSSSSXNNNNNNNNNNXSSSSX
XSPSSXNNGNNNNNNNXSRSSX
XSSSSXNNNNNNNNNNXSSRSX
XSSSSXXXXXXXXXXXXSSSSX
.XSSSSSSSSSSSSSSSSSSX.
..XXXXXXXXXXXXXXXXXX..
"""),
  # Nanoleaf — the Game & Watch (1980). Gold slab, letterbox screen, side buttons.
  "gamewatch": ("#5AC67E", """
.XXXXXXXXXXXXXXXXXX.
XSSSSSSSSSSSSSSSSSSX
XSSXXXXXXXXXXXXXXSSX
XSSXNNNNNNNNNNNNXSSX
XSRXNNNGNNNNNNNNXRSX
XSSXNNNNNNNNNNNNXSSX
XSSXXXXXXXXXXXXXXSSX
XSSSSSSSSSSSSSSSSSSX
.XXXXXXXXXXXXXXXXXX.
"""),
  # Freelance — the cartridge. Ran alongside the consoles; a game, not a machine.
  "cart": ("#F0C443", """
.XXXXXXXXXX.
XSSSSSSSSSSX
XSXXXXXXXXSX
XSSSSSSSSSSX
XSLLLLLLLLSX
XSLGLLLLLLSX
XSLLLLLLLLSX
XSLLLLLLLLSX
XSSSSSSSSSSX
XSSSSSSSSSSX
.XSSSSSSSSX.
.XXXXXXXXXX.
"""),
}

# Per-device palette tweaks, applied over COMMON. The rose buttons vanish on
# CI's rose shell, so that one machine gets white ones.
OVERRIDES = {
    "gameboy": {"R": "#f7f7ff"},
}


def svg(name):
    shell, grid = DEVICES[name]
    palette = dict(COMMON, S=shell, **OVERRIDES.get(name, {}))
    rows = [r for r in grid.strip("\n").split("\n")]
    w, h = len(rows[0]), len(rows)
    rects = []
    for y, row in enumerate(rows):
        x = 0
        while x < w:
            c = row[x]
            if c == ".":
                x += 1
                continue
            run = 1
            while x + run < w and row[x + run] == c:
                run += 1
            rects.append(f'<rect x="{x}" y="{y}" width="{run}" height="1" fill="{palette[c]}"/>')
            x += run
    body = "".join(rects)
    return (f'<svg class="log-dev log-dev--{name}" viewBox="0 0 {w} {h}" '
            f'shape-rendering="crispEdges" role="img" aria-hidden="true">{body}</svg>')

# Cards run in career order, newest first. The DEVICE each one gets runs in
# hardware chronology the same direction time does along that row — the newest
# job holds the newest machine (DS, 2004) and the oldest holds the oldest
# (Game & Watch, 1980), so scanning the shelf is scanning both histories at
# once. Freelance ran alongside the sequence, so it is the cartridge — a game,
# not a machine. Shell colours belong to the employers, not the hardware.
#
# Notes are bullet fragments with the load-bearing words marked <b> — they set
# heavier and white against the pale frame text.
CARDS = [
  ("ds",       "Tempo",           "UX Engineer",           "Summer 2026"),
  ("sp",       "TD Bank",         "UX Design Intern",      "Fall 2025"),
  ("gba",      "Willful",         "UX Design Intern",      "Winter 2025"),
  ("gamegear", "Questrade",       "UX Design Intern",      "2024"),
  # Two tours in one posting, so two titles on one card.
  ("gameboy",  "CI Technologies", "UI/UX Designer &middot; Fullstack Developer", "2022 &ndash; 2023"),
  ("gamewatch","Nanoleaf",        "Product Design Intern", "Winter 2022"),
  ("cart",     "Freelance",       None,                    "2023 &rarr; now"),
]


# Devices that start a fresh row rather than flowing on from the last. Freelance
# ran alongside the numbered sequence, so it sits apart from it.
ALONE = {"cart"}


def emit():
    out = ['          <ul class="log-cards">']
    for dev, where, role, when in CARDS:
        if dev in ALONE:
            # Zero-height full-width flex item: the standard way to force a wrap
            # without touching the card itself. Sizing the CARD to 100% instead
            # would have worked too, but its scatter rotation is applied to the
            # card box — spinning a full-width box swings its centred contents
            # right across the row.
            out.append('            <li class="log-break" aria-hidden="true"></li>')
        out.append('            <li class="log-card">')
        out.append(f'              {svg(dev)}')
        out.append(f'              <p class="log-card-where">{where}</p>')
        if role:
            out.append(f'              <p class="log-card-role">{role}</p>')
        out.append(f'              <p class="log-card-when">{when}</p>')
        out.append('            </li>')
    out.append('          </ul>')
    return "\n".join(out)

if __name__ == "__main__":
    print(emit())
