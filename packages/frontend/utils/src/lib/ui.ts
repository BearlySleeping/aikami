/**
 * The names of the button color.
 *
 * BaseButton component from @aikami/svelte
 *
 * @see libs/shared/frontend/svelte/src/lib/components/base/button/base/BaseButton.svelte
 */

export const buttonColors = [
  'primary',
  'accent',
  'secondary',
  'tertiary',
  'ghost',
  'danger',
] as const

/**
 * The names of the button size.
 *
 * BaseButton component from @aikami/svelte
 *
 * @see libs/shared/frontend/svelte/src/lib/components/base/button/base/BaseButton.svelte
 */

export const buttonSizes = [
  'x-small',
  'small',
  'medium',
  'large',
  'x-large',
] as const

/**
 * The names of the icons used in svelte icons.
 *
 * BaseIcon component from @aikami/svelte
 *
 * @see libs\shared\svelte\src\lib\components\base\icon\BaseIcon.svelte
 */
export const iconNames = [
  'ai',
  'analytics',
  'archive',
  'arrow-left',
  'bell',
  'browsers',
  'buildings',
  'camera',
  'chart',
  'check',
  'chevron',
  'close',
  'cloud-arrow-up',
  'copy',
  'credit-card',
  'crosshair',
  'learn',
  'delete',
  'device-mobile',
  'dots-six',
  'dots-three',
  'download',
  'dropper',
  'embedded',
  'envelope',
  'external-link',
  'eye',
  'eye-off',
  'favorite',
  'favorite-outline',
  'film-strip',
  'floppy-disk',
  'folder-filled',
  'folder-open',
  'folder-plus',
  'fullscreen',
  'fullscreen-exit',
  'help',
  'gear',
  'gif',
  'globe',
  'image',
  'info',
  'key',
  'lifebuoy',
  'link',
  'list-plus',
  'lock',
  'magnifier',
  'megaphone',
  'menu',
  'microphone',
  'microphone-off',
  'minus',
  'monitor',
  'monitor-user',
  'muted',
  'paint-roller',
  'paper-plane',
  'pause',
  'pencil',
  'play',
  'play-rounded',
  'plus',
  'queue',
  'record',
  'redo',
  'restart',
  'rows',
  'scissors',
  'share',
  'share-network',
  'sign-in',
  'sign-out',
  'strip-play',
  'squares-four',
  'star',
  'upload',
  'undo',
  'user',
  'user-focus',
  'user-plus',
  'users',
  'users-three',
  'video-camera',
  'video-fail',
  'volume',
  'volume-low',
  'warning',
] as const satisfies Readonly<string[]>

/** The color classes available for components. */
export type Color = (typeof buttonColors)[number]

/** The sizes available for components. */
export type Size = (typeof buttonSizes)[number]

/**
 * The names of the icons used in svelte icons.
 *
 * BaseIcon component from @aikami/svelte
 *
 * @see libs\shared\svelte\src\lib\components\base\icon\BaseIcon.svelte
 */
export type IconName = (typeof iconNames)[number]
