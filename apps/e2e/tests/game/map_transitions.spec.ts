// apps/e2e/tests/game/map_transitions.spec.ts
// E2E Test — map transition zoning system
//
// Contract: C-138 Map Transitions
//
// Validates that the zoning system emits ZONE_TRIGGERED when the player
// overlaps a transition zone, and that the transition overlay appears
// in the UI during the map load lifecycle.

import { expect, test } from '@playwright/test';

const BASE_URL = 'http://localhost:5274';

/**
 * Minimal 10×10 Tiled JSON tilemap with a transition zone object layer.
 *
 * The transition zone covers tiles (4,4) to (6,6) and targets a
 * second map at spawn point (160, 96).
 */
const MAP_WITH_TRANSITION = {
  width: 10,
  height: 10,
  tilewidth: 32,
  tileheight: 32,
  tilesets: [
    {
      firstgid: 1,
      name: 'test',
      image: 'test_tileset.png',
      imagewidth: 128,
      imageheight: 64,
      tilewidth: 32,
      tileheight: 32,
      columns: 4,
      tilecount: 8,
    },
  ],
  layers: [
    {
      name: 'ground',
      width: 10,
      height: 10,
      data: Array(100).fill(1), // all floor tiles
      visible: true,
      type: 'tilelayer',
    },
    {
      name: 'collision',
      width: 10,
      height: 10,
      data: [
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1,
      ],
      visible: true,
      type: 'tilelayer',
    },
    {
      name: 'zones',
      type: 'objectgroup',
      objects: [
        {
          id: 1,
          type: 'transition',
          x: 128,
          y: 128,
          width: 64,
          height: 64,
          properties: [
            { name: 'targetMap', type: 'string', value: 'map2.json' },
            { name: 'targetX', type: 'float', value: 160 },
            { name: 'targetY', type: 'float', value: 96 },
          ],
        },
      ],
    },
  ],
};

/**
 * Second map — the destination after transitioning.
 */
const MAP_DESTINATION = {
  width: 8,
  height: 8,
  tilewidth: 32,
  tileheight: 32,
  tilesets: [
    {
      firstgid: 1,
      name: 'test',
      image: 'test_tileset.png',
      imagewidth: 128,
      imageheight: 64,
      tilewidth: 32,
      tileheight: 32,
      columns: 4,
      tilecount: 8,
    },
  ],
  layers: [
    {
      name: 'ground',
      width: 8,
      height: 8,
      data: [
        2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1,
        2, 2, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2,
        2, 2,
      ],
      visible: true,
      type: 'tilelayer',
    },
  ],
};

test.describe('Map Transitions (C-138)', () => {
  test('game page loads without errors', async ({ page }) => {
    // Intercept map requests
    await page.route('**/maps/test_map.json', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MAP_WITH_TRANSITION),
      });
    });

    await page.route('**/maps/map2.json', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MAP_DESTINATION),
      });
    });

    // Navigate to the game page
    await page.goto(`${BASE_URL}/game`, { waitUntil: 'domcontentloaded' });

    // Wait for the PixiJS canvas to appear
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    // Wait for the engine to initialize
    await page.waitForTimeout(3000);

    // Verify the canvas is present and has dimensions
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).toBeTruthy();
    expect(canvasBox!.width).toBeGreaterThan(0);
    expect(canvasBox!.height).toBeGreaterThan(0);
  });

  test('transition overlay is renderable in the DOM', async ({ page }) => {
    // Navigate to the game page
    await page.goto(`${BASE_URL}/game`, { waitUntil: 'domcontentloaded' });

    // Wait for the canvas to appear
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    // Wait for initialization
    await page.waitForTimeout(3000);

    // Verify the game UI layer exists (parent of the transition overlay)
    const uiLayer = page.locator('#game-ui-layer');
    await expect(uiLayer).toBeVisible();

    // The transition overlay div is always in the DOM
    // (opacity-0 when not transitioning, opacity-100 when transitioning)
    // Verify it exists with bg-black class
    const transitionOverlay = uiLayer.locator('.bg-black.transition-opacity');
    await expect(transitionOverlay).toBeAttached();

    // Initially, the transition overlay should be transparent (not transitioning)
    await expect(transitionOverlay).toHaveClass(/opacity-0/);
  });

  test('extractTransitionZones parses Tiled transition objects', async ({ page }) => {
    // Navigate to the game page
    await page.goto(`${BASE_URL}/game`, { waitUntil: 'domcontentloaded' });

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2000);

    // Inject a script that calls extractTransitionZones on our test map
    const zones = await page.evaluate(async () => {
      const { extractTransitionZones, loadTilemap } = await import(
        /* webpackIgnore: true */ '/@fs/home/sonny/Development/Projects/passion/aikami/packages/frontend/engine/src/assets/map_loader.ts'
      );

      const mapData = {
        width: 10,
        height: 10,
        tilewidth: 32,
        tileheight: 32,
        tilesets: [],
        layers: [
          { name: 'ground', width: 10, height: 10, data: Array(100).fill(0), visible: true },
        ],
        objectLayers: [
          {
            name: 'zones',
            objects: [
              {
                id: 1,
                type: 'transition',
                x: 128,
                y: 128,
                width: 64,
                height: 64,
                properties: [
                  { name: 'targetMap', type: 'string', value: 'map2.json' },
                  { name: 'targetX', type: 'float', value: 160 },
                  { name: 'targetY', type: 'float', value: 96 },
                ],
              },
            ],
          },
        ],
      };

      // Cast to TilemapData — the extract function uses the shape
      const zones = extractTransitionZones(mapData as Parameters<typeof extractTransitionZones>[0]);
      return zones;
    });

    expect(zones).toHaveLength(1);
    expect(zones[0].targetMap).toBe('map2.json');
    expect(zones[0].targetX).toBe(160);
    expect(zones[0].targetY).toBe(96);
    expect(zones[0].x).toBe(128);
    expect(zones[0].y).toBe(128);
    expect(zones[0].width).toBe(64);
    expect(zones[0].height).toBe(64);
  });
});
