'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.collections = void 0;
var astro_content_1 = require('astro:content');
var loaders_1 = require('@astrojs/starlight/loaders');
var schema_1 = require('@astrojs/starlight/schema');
exports.collections = {
  docs: (0, astro_content_1.defineCollection)({
    loader: (0, loaders_1.docsLoader)(),
    schema: (0, schema_1.docsSchema)(),
  }),
};
