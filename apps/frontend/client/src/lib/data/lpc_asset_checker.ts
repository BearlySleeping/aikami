export const getAvailableLpcAssets = () => {
  const files = import.meta.glob('/static/lpc/**/*.png', {
    eager: true,
    query: '?url',
    import: 'default',
  });
  const assetIds = new Set<string>();

  for (const path of Object.keys(files)) {
    // path: /static/lpc/slot/asset_folder/sub_folder/state.png
    // e.g. /static/lpc/body/human/male/walk.png
    // The assetId in catalog is e.g. 'human/male'
    // Let's strip /static/lpc/ and the state.png
    const parts = path.split('/');
    // [ "", "static", "lpc", "body", "human", "male", "walk.png" ]
    if (parts.length >= 6) {
      // parts.slice(4, -1) -> ["human", "male"]
      const assetId = parts.slice(4, -1).join('/');
      assetIds.add(assetId);
    }
  }
  return assetIds;
};
