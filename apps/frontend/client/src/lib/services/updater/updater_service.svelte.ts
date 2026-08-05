// apps/frontend/client/src/lib/services/updater/updater_service.svelte.ts
//
// Tauri desktop auto-updater. Runs a background update check against the
// configured plugin endpoints (GitHub Releases latest.json), prompts the
// player before downloading, and relaunches the app once the new version is
// installed. No-op in the browser PWA (no `__TAURI__` global) — the Tauri
// plugin modules are dynamically imported (platform-specific code).

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';

export type UpdaterServiceOptions = BaseFrontendClassOptions;

export type UpdaterServiceInterface = BaseFrontendClassInterface & {
  /**
   * Checks for a newer desktop build and, if one is available, prompts the
   * player to download + install it (relaunching on success).
   * Safe to call multiple times — a concurrent check is ignored.
   */
  checkForUpdates(): Promise<void>;
};

export class UpdaterService
  extends BaseFrontendClass<UpdaterServiceOptions>
  implements UpdaterServiceInterface
{
  /** True while a check/install is in flight — prevents overlapping prompts. */
  private _checking = false;

  async checkForUpdates(): Promise<void> {
    if (this._checking) {
      return;
    }
    if (typeof window === 'undefined' || !('__TAURI__' in window)) {
      // Browser (PWA) build — there is no desktop updater.
      return;
    }
    this._checking = true;
    try {
      // Tauri-only modules — dynamic import is justified (platform-specific).
      const [{ check }, { relaunch }] = await Promise.all([
        import('@tauri-apps/plugin-updater'),
        import('@tauri-apps/plugin-process'),
      ]);

      let update: Awaited<ReturnType<typeof check>>;
      try {
        update = await check();
      } catch (error) {
        // Offline / unreachable endpoint is normal on startup — stay quiet.
        this.debug('checkForUpdates:check-failed', { error: String(error) });
        return;
      }
      if (!update) {
        this.debug('checkForUpdates:up-to-date');
        return;
      }

      this.info('checkForUpdates:update-available', { version: update.version });
      const confirmed = await this.openConfirmDialog({
        title: 'Update available',
        message: `Aikami v${update.version} is available. Download and install it now? The app will relaunch once the update is ready.`,
        agreeLabel: 'Download & Install',
        disagreeLabel: 'Later',
      });
      if (!confirmed) {
        this.info('checkForUpdates:declined');
        return;
      }

      this.setAppLoading(true, `Downloading v${update.version}…`);
      try {
        await update.downloadAndInstall();
        this.info('checkForUpdates:installed', { version: update.version });
        await relaunch();
      } catch (error) {
        this.error('checkForUpdates:install-failed', error);
        this.showErrorNotification(error, 'Update installation failed');
      } finally {
        this.setAppLoading(false);
      }
    } finally {
      this._checking = false;
    }
  }
}

export const updaterService: UpdaterServiceInterface = UpdaterService.create({
  className: 'UpdaterService',
});
