// scripts/src/lib/ops/emberwatch_prop_styles.ts

import type { PropStyleClass } from '@aikami/types';

export type { PropStyleClass } from '@aikami/types';

/** Shared frame-to-style classification for the Emberwatch prop registry. */
export const PROP_STYLE_CLASSES: Readonly<Record<string, PropStyleClass>> = {
  'prop_well.png': 'landmark',
  'prop_notice_board.png': 'landmark',
  'prop_gate.png': 'structural',
  'shrine_arch.png': 'structural',
  'oak.png': 'vegetation',
  'birch.png': 'vegetation',
  'ward_large.png': 'vegetation',
  'ward_small_a.png': 'vegetation',
  'ward_small_b.png': 'vegetation',
  'ward_small_c.png': 'vegetation',
  'prop_barrel.png': 'furniture',
  'prop_crate.png': 'furniture',
  'prop_table.png': 'furniture',
  'prop_bed.png': 'furniture',
  'prop_bookshelf.png': 'furniture',
  'prop_counter.png': 'furniture',
  'prop_anvil.png': 'furniture',
  'chair.png': 'furniture',
  'prop_brazier.png': 'furniture',
  'prop_hearth.png': 'furniture',
  'prop_support.png': 'structural',
  'prop_oil_pool.png': 'clutter',
  'prop_receipt.png': 'clutter',
  'prop_component.png': 'clutter',
  'prop_cart.png': 'clutter',
  'prop_ward_socket.png': 'landmark',
};
