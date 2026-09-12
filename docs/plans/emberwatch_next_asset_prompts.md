# Emberwatch — single-asset prompts, batch 2

The first batch is usable. The earlier prompts contained alternative subjects; copying those blocks directly could produce variant collections or combined sheets. That ambiguity was in the prompts, not the workflow used to select the best result.

## How to use these

1. **Copy exactly one fenced block per generation request.** Each block is complete: no separate style preamble or bracket substitutions.
2. Prefer a fresh image-generation conversation for each new asset. Attach `ew_b01_inn.png` as a **style reference only**, not one of the multi-asset ward-tree sheets. The prompt explicitly asks for a different subject.
3. If ChatGPT offers several alternatives for that one subject, keep the best one. We do not need all variants.
4. Save the original PNG under `.local/catalog/production/imports/` using the filename above its prompt. Keep transparency; do not export a screenshot of the preview.
5. Generate **barrel, crate and notice board first**. The remaining prompts are the following batch; there is no need to generate them all at once.

The inn, shop, shrine arch, well, oak, ward-tree candidates and four outdoor material textures have already been supplied. **Do not regenerate those now.** Shadow layers, terrain-corner topology and precise game-scale slicing are authoring tasks; they are not solved by asking for a larger sprite sheet.

## 1. Barrel — `ew_f02_barrel.png`

```text
Generate a new image containing exactly ONE wooden barrel for Emberwatch, a top-down 2D fantasy JRPG. This is a new subject, not another version of the inn. Use the attached inn only as a reference for warm weathered timber, cool metal, upper-left lighting, and crisp pixel-art-inspired detail. Do not draw the inn or any other building.

The barrel is upright, made of old oak staves with two dark iron hoops. Its closed circular top is visible from a three-quarter overhead orthogonal RPG view. It should look solid and slightly worn, with a clear rounded silhouette and a readable base. Keep the detail legible when prepared for a game canvas about 32 pixels wide and 48 pixels tall. Do not draw a tiny barrel on a large ground tile.

Use genuine transparent alpha outside the barrel. Keep the barrel body opaque; only the silhouette edge may be partially transparent. Leave empty margin around the entire silhouette. No floor, grass, colored matte, checkerboard pattern, cast-shadow plane, labels, text, additional objects or background scene. Shading on the barrel itself is welcome.

Output one isolated barrel, one view, in one image. No collection, contact sheet, alternative designs, multiple views or repeated barrels. Do not reproduce the reference subject.
```

## 2. Crate — `ew_f03_crate.png`

```text
Generate a new image containing exactly ONE wooden supply crate for Emberwatch, a top-down 2D fantasy JRPG. Use the attached inn only as a reference for warm weathered wood, subdued colors, upper-left light and crisp pixel-art-inspired rendering. Do not draw a building or repeat a previous subject.

Show one closed square crate with a reinforced front face and a clearly visible top surface, viewed from the same three-quarter overhead orthogonal RPG angle as the reference. Use a few broad boards and modest iron nails, not tiny unreadable detail. Make its perspective and volume clear. It should remain readable on a game canvas about 32 by 32 pixels.

Use genuine transparent alpha around the entire crate. The wooden body is opaque, not faded or translucent. Preserve a small empty margin. No grass, floor square, backdrop, cast-shadow plane, lettering, shipping label, loose supplies or other objects. Shading belongs on the wood, not on an opaque patch beneath it.

Output one crate only, one view, in one image. No variants, stacks, grid, comparison sheet or multiple subjects.
```

## 3. Notice board — `ew_f04_notice_board.png`

```text
Generate a new image containing exactly ONE freestanding village notice board for Emberwatch, a top-down 2D fantasy JRPG. Use the attached inn only as the reference for weathered timber, slate colors, moss accents, upper-left light and pixel-art-inspired detail. Do not draw the inn or a new building.

The board has two sturdy wooden posts, a broad rectangular display surface, and a small weathered protective roof. Put three blank cream-colored papers on the board with simple pin marks. No writing or symbols that resemble text. Show it in three-quarter overhead orthogonal RPG view, with its front facing toward the bottom of the image. Make the top, front and supporting feet readable. The intended game canvas is roughly 64 by 64 pixels.

Use genuine transparent alpha outside the board and through the gap between its legs. The board and posts themselves are opaque. Leave margin around the roof and both feet. No ground patch, grass square, floor, large cast shadow, scenery, character, colored background or fake transparency checkerboard.

Output one notice board, one view, in one image. No alternative versions, collection, sprite sheet or additional props.
```

## 4. Inn table — `ew_f05_table.png`

```text
Generate a new image containing exactly ONE long wooden inn table for Emberwatch, a top-down 2D fantasy JRPG. Use the attached inn only as the reference for warm old timber, subdued coloring, upper-left light and crisp pixel-art-inspired detail. Do not draw a building, room or previous subject.

Show a simple rectangular tavern table, approximately three times as wide as a small character's body. Its long edge runs left to right across the image. Use a three-quarter overhead orthogonal RPG view so the tabletop, front apron and supporting legs are visible. The tabletop is empty and made of broad worn boards. Keep the form readable when prepared for a game canvas around 96 by 64 pixels.

Use genuine transparent alpha around and beneath the table, including gaps between the legs. The wood itself is opaque. Keep all four corners and the feet inside the image with empty margins. No chairs, mugs, food, floor, room, grass, large cast-shadow plane, text, background color or checkerboard pattern.

Output one table only, one view, in one image. No furniture collection, variants, multiple angles or sprite sheet.
```

## 5. Chair — `ew_f06_chair.png`

```text
Generate a new image containing exactly ONE wooden tavern chair for Emberwatch, a top-down 2D fantasy JRPG. Use the attached inn only as a style reference for weathered warm timber, upper-left light and crisp pixel-art-inspired detail. Do not draw a building or reproduce a previous subject.

Make a sturdy simple chair with a slatted back, a visible seat and four legs. Use a three-quarter overhead orthogonal RPG view. The chair faces toward the bottom of the image, and its backrest is on the upper side. The visible seat should be easy to read at a final game canvas around 32 by 48 pixels. Keep the silhouette practical and unfussy.

Use genuine transparent alpha outside the chair and through the openings between slats and legs. The wood itself must be opaque. Leave empty margins around every part of the silhouette. No floor tile, room, table, cushion pile, ground patch, large cast shadow, text, colored background or checkerboard pattern.

Output exactly one chair, one view, in one image. No directional sheet, alternative chairs, repetitions or extra objects.
```

## 6. Shop counter — `ew_f07_counter.png`

```text
Generate a new image containing exactly ONE straight wooden shop counter for Emberwatch, a top-down 2D fantasy JRPG. Use the attached inn only as a reference for weathered timber, restrained stone-and-wood colors, upper-left light and pixel-art-inspired rendering. Do not draw a shop building or an interior scene.

The counter is a single long solid furniture object with a broad empty top, a paneled front and simple visible side ends. Its long edge runs left to right. Use a three-quarter overhead orthogonal RPG view so the top and customer-facing front are both clear. Aim for a shape readable on a game canvas around 96 by 64 pixels. No items sitting on it and no visible shopkeeper.

Use real transparent alpha around the counter; the counter itself is opaque. Keep the full outline in the image with empty margins. No room, floor rectangle, grass, back wall, large cast-shadow plane, labels, colored matte or checkerboard pattern.

Output one counter only, one view, in one image. Do not generate modular variants, corner pieces, alternate counters, multiple views or a sheet. Exact module boundaries will be authored separately if needed.
```

## 7. Bed — `ew_f08_bed.png`

```text
Generate a new image containing exactly ONE modest wooden inn bed for Emberwatch, a top-down 2D fantasy JRPG. Use the attached inn only as the reference for warm worn wood, muted moss-green cloth, upper-left lighting and crisp pixel-art-inspired detail. Do not draw the inn, a bedroom or a different piece of furniture.

Show the complete bed from a three-quarter overhead orthogonal RPG viewpoint. Its headboard is at the top of the image and its footboard is at the bottom. Include one plain pillow and a neatly folded muted green blanket. Make the wood frame, mattress volume and ground-contact feet clear. The intended final game canvas is about 64 by 96 pixels.

Use genuine transparent alpha around the bed and in visible gaps under its frame. Keep the body and bedding opaque. Leave empty margins around the full headboard and feet. No person, bedside furniture, rug, floor tile, room, large cast-shadow plane, text, solid background or checkerboard pattern.

Output one bed, one view, in one image. No alternate bedding designs, collection, multiple views or sprite sheet.
```

## 8. Wooden floor material — `ew_t05_wood_floor.png`

```text
Generate exactly ONE square seamless wooden-floor material texture for Emberwatch, a top-down 2D fantasy JRPG. Use the attached inn only as a color/material reference. Do not draw a building, room, furniture or props.

This texture is viewed straight down: it is flat floor material, not a perspective illustration. Use broad warm-brown worn planks, restrained grain and subtle seams. Planks run vertically from the top to the bottom of the image. Keep the contrast quiet behind characters. Avoid tiny noisy details, dramatic lighting, nails arranged in obvious repeating motifs, bevels or a decorative border.

The material must fill the entire square with fully opaque pixels. Match opposite edges for horizontal and vertical repetition. No transparent margin, surrounding terrain, floor-outline shape, scene, grid lines, numbers or text. This is one source material for later controlled tile preparation, not a complete atlas or a numbered tileset.

Output one square material texture only. No alternative woods, swatch collection, variations or multiple images arranged on a sheet.
```

## What not to request yet

- Another ward-tree sheet. Current A/B/C candidates already show useful amber/dormant differences; their geometry must be aligned before treating them as runtime state swaps.
- A complete 16-mask terrain atlas. We will construct and validate topology against the engine's NW/NE/SE/SW bit convention.
- Automatic collision masks, origin coordinates or render-depth metadata from the image model. Those need authored engine-aware definitions and testing.
- A shadows-plus-body sheet. Contact shadows should be separately aligned to accepted native-size art, without reproducing a grass rectangle beneath the prop.
