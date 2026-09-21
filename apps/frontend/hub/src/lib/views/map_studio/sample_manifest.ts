// apps/frontend/hub/src/lib/views/map_studio/sample_manifest.ts
//
// Embedded sample map manifest for the map studio.
//
// Shape mirrors the published Tiled-JSON maps (`sandbox_combat.json`), so it
// loads through the engine's unified scene loader exactly like a real map:
// `sceneFromTilemap` with the GID frame resolver. The tileset image reference
// uses a game-data-relative path that the studio's CDN resolver (path lookup
// enabled) resolves to the published catalog asset — real tiles render.
//
// Keep this file free of engine imports — the manifest is plain data and the
// route must not pull the engine into the server bundle.

const MAP_WIDTH = 12;
const MAP_HEIGHT = 9;

/** A 12×9 debug-tiles map: grass field, rock cluster, walled border. */
export const SAMPLE_MANIFEST_TEXT = JSON.stringify(
  {
    compressionlevel: -1,
    height: 9,
    infinite: false,
    layers: [
      {
        // Ground — tile GIDs into debug_tiles (1 = floor, 2 = wall, 3 = rock).
        data: _groundData(),
        height: 9,
        id: 1,
        name: 'ground',
        opacity: 1,
        type: 'tilelayer',
        visible: true,
        width: 12,
        x: 0,
        y: 0,
      },
      {
        // Collision — non-zero cells are blocked. Mirrors the rock cluster +
        // the map border so the overlay is meaningful.
        data: _collisionData(),
        height: 9,
        id: 2,
        name: 'collision',
        opacity: 1,
        type: 'tilelayer',
        visible: true,
        width: 12,
        x: 0,
        y: 0,
      },
    ],
    nextlayerid: 3,
    nextobjectid: 1,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.9.0',
    tileheight: 32,
    tilesets: [
      {
        firstgid: 1,
        columns: 4,
        image: '/game-data/sprites/tilesets/debug_tiles.png',
        imageheight: 32,
        imagewidth: 128,
        margin: 0,
        name: 'debug_tiles',
        spacing: 0,
        tilecount: 4,
        tilewidth: 32,
        tileheight: 32,
      },
    ],
    tilewidth: 32,
    type: 'map',
    version: 1,
    width: 12,
  },
  undefined,
  2,
);

/** Ground: floor with a walled border and a 2×2 rock cluster at (5,3). */
function _groundData(): number[] {
  const data: number[] = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const border = x === 0 || y === 0 || x === MAP_WIDTH - 1 || y === MAP_HEIGHT - 1;
      const rock = x >= 5 && x <= 6 && y >= 3 && y <= 4;
      let gid = 1; // floor
      if (rock) {
        gid = 3;
      }
      if (border) {
        gid = 2; // wall
      }
      data.push(gid);
    }
  }
  return data;
}

/** Collision: the border ring and the rock cluster. */
function _collisionData(): number[] {
  const data: number[] = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const border = x === 0 || y === 0 || x === MAP_WIDTH - 1 || y === MAP_HEIGHT - 1;
      const rock = x >= 5 && x <= 6 && y >= 3 && y <= 4;
      data.push(border || rock ? 1 : 0);
    }
  }
  return data;
}
