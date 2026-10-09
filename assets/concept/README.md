# Concept previews

These are design concepts illustrating Aikami’s intended visual direction, **not
screenshots of the current build**. Campaign creation depicts a planned experience;
today’s narrative drafts are not yet compiled into playable campaigns.

| Asset | Depicts |
| --- | --- |
| [dialogue.webp](dialogue.webp) | Tavern dialogue with Elder Thalia and a persuasion check |
| [world_gen.webp](world_gen.webp) | Campaign creation and The Lantern Coast preview |
| [persona_gen.webp](persona_gen.webp) | Character appearance, clothing layers, colors, and backstory |
| [menu.webp](menu.webp) | Character sheet, abilities, saving throws, and equipment |
| [combat_1.webp](combat_1.webp) | Tactical move planning during a forest ambush |
| [combat_2.webp](combat_2.webp) | Environmental combat with a risky brazier and fire spread |

## Image preparation

All six images retain their original **1672 × 941** dimensions, without cropping.
ImageMagick converts the source PNGs to WebP at quality 88, strips metadata, and
uses sharp YUV conversion to keep UI text and pixel-art edges clear:

```bash
magick source.png -strip -quality 88 \
  -define webp:method=6 -define webp:use-sharp-yuv=true output.webp
```

Use the original PNG when preparing a replacement; do not repeatedly recompress
a WebP. The delivery files total about **1.65 MiB**, down from **12.14 MiB**
of PNGs (about **86% smaller**). Originals from this conversion are preserved locally
in the gitignored `.local/concept-originals/` directory; they are not shipped.

The [root README](../../README.md), [vision docs](../../docs/intro/vision.md#visual-direction),
and marketing homepage share these assets. The homepage shows them in a manually
controlled slideshow; hover or keyboard focus reveals each title and description.
The site imports assets through its `$concept/*` alias and renders responsive,
lazy-loaded WebP variants through `picture.astro`. Moon source inputs include this
directory so asset changes invalidate the site build cache.