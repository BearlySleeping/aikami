// apps/e2e/src/pom/play_shell_page.ts
// Production play-shell readiness and management navigation.

import type { Page } from '@playwright/test';

export class PlayShellPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get canvasContainer() {
    return this.page.locator('#game-canvas-container');
  }

  get managementMenuEntry() {
    return this.page.getByTestId('hud-menu-entry');
  }

  get managementHost() {
    return this.page.getByTestId('management-host');
  }

  /** The single substantial workspace surface inside the management host. */
  get managementWorkspace() {
    return this.page.getByTestId('management-workspace');
  }

  /** The workspace header title (the active section label). */
  get managementHeading() {
    return this.page.getByTestId('management-heading');
  }

  /** The single host-owned Return/Back control. */
  get managementReturn() {
    return this.page.getByTestId('management-close');
  }

  get sectionTabs() {
    return this.page.getByTestId('management-section-tabs');
  }

  sectionTab(section: string) {
    return this.page.getByTestId(`section-tab-${section}`);
  }

  sectionPanel(panel: string) {
    return this.page.getByTestId(`management-panel-${panel}`);
  }

  get characterSummary() {
    return this.page.getByTestId('character-summary');
  }

  get characterScroll() {
    return this.page.getByTestId('character-scroll');
  }

  get characterEditToggle() {
    return this.page.getByTestId('character-edit-toggle');
  }

  get inventoryPaperdoll() {
    return this.page.getByTestId('inventory-paperdoll');
  }

  get inventorySlots() {
    return this.inventoryPaperdoll.locator('.game-inventory__slot');
  }

  get inventoryUnequipButtons() {
    return this.inventoryPaperdoll.getByRole('button', { name: /Unequip/ });
  }

  get inventoryBag() {
    return this.page.getByTestId('inventory-bag');
  }

  get inventoryDetail() {
    return this.page.getByTestId('inventory-detail');
  }

  get inventoryScroll() {
    return this.page.getByTestId('inventory-overlay');
  }

  get inventoryEmptyState() {
    return this.page.getByTestId('inventory-empty-state');
  }

  get inventoryItemList() {
    return this.page.getByTestId('inventory-item-list');
  }

  get journalTabs() {
    return this.page.getByTestId('journal-tabs');
  }

  get journalPanel() {
    return this.page.getByTestId('journal-panel');
  }

  get journalNoteList() {
    return this.page.getByTestId('journal-note-list');
  }

  get journalNoteDetail() {
    return this.page.getByTestId('journal-note-detail');
  }

  get journalNotesEmpty() {
    return this.page.getByTestId('journal-notes-empty');
  }

  /** Seeds real production management stores through the non-production seam. */
  async seedManagementContent(scenario: 'empty' | 'populated'): Promise<Record<string, number>> {
    return await this.page.evaluate(async (contentScenario) => {
      const seam = (window as unknown as Record<string, unknown>).__AIKAMI_TEST__ as
        | {
            seedManagementContent(options: {
              scenario: 'empty' | 'populated';
            }): Promise<Record<string, number>>;
          }
        | undefined;
      if (!seam || typeof seam.seedManagementContent !== 'function') {
        throw new Error('Management evidence seam is unavailable');
      }
      const counts = await seam.seedManagementContent({ scenario: contentScenario });
      const expected: Record<string, number> =
        contentScenario === 'empty'
          ? { inventoryCount: 0, equippedCount: 0, questCount: 0, noteCount: 0 }
          : { inventoryCount: 4, equippedCount: 3, questCount: 1, noteCount: 2 };
      for (const [key, value] of Object.entries(expected)) {
        if (counts[key] !== value) {
          throw new Error(`Management seed mismatch for ${key}: ${counts[key]} !== ${value}`);
        }
      }
      return counts;
    }, scenario);
  }

  /** Confirms PixiJS selected its WebGL renderer. */
  async expectWebGl(): Promise<void> {
    await this.page.waitForFunction(() => {
      const app = (window as unknown as Record<string, unknown>).__PIXI_APP__ as
        | { renderer?: { name?: unknown } }
        | undefined;
      return typeof app?.renderer?.name === 'string';
    });
    const renderer = await this.page.evaluate(() => {
      const app = (window as unknown as Record<string, unknown>).__PIXI_APP__ as
        | { renderer?: { name?: unknown } }
        | undefined;
      return typeof app?.renderer?.name === 'string' ? app.renderer.name : 'none';
    });
    if (renderer !== 'webgl') {
      throw new Error(`Expected PixiJS WebGL renderer, received ${renderer}`);
    }
  }

  /** Bounding box of the workspace surface, for geometry assertions. */
  async managementWorkspaceBox(): Promise<{
    readonly width: number;
    readonly height: number;
  } | null> {
    const box = await this.managementWorkspace.boundingBox();
    return box === null ? null : { width: box.width, height: box.height };
  }

  /** Viewport-relative proportion of the workspace surface. */
  async managementWorkspaceAreaRatio(): Promise<number> {
    const box = await this.managementWorkspaceBox();
    const viewport = this.page.viewportSize();
    if (!box || !viewport) {
      return 0;
    }
    return (box.width * box.height) / (viewport.width * viewport.height);
  }

  /** Reads the active Character scroll owner after setting it to the bottom. */
  async scrollCharacterToBottom(): Promise<{
    clientHeight: number;
    scrollHeight: number;
    scrollTop: number;
  }> {
    return await this.characterScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      };
    });
  }

  /**
   * Verifies that required Inventory controls can be brought inside the
   * management scroll owner, rather than merely existing below a clipped panel.
   */
  async inventoryControlReachability(): Promise<
    readonly { readonly label: string; readonly reachable: boolean }[]
  > {
    return await this.inventoryScroll.evaluate((owner) => {
      const controls = [
        ...owner.querySelectorAll<HTMLElement>(
          '[data-testid="inventory-paperdoll"] button, [data-testid="inventory-detail"] button, [data-testid="inventory-empty-state"]',
        ),
      ];
      return controls.map((control) => {
        const ownerRect = owner.getBoundingClientRect();
        const controlRect = control.getBoundingClientRect();
        owner.scrollTop += controlRect.top - ownerRect.top - 8;
        const reachableRect = control.getBoundingClientRect();
        return {
          label: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? control.id,
          reachable:
            reachableRect.top >= ownerRect.top - 1 && reachableRect.bottom <= ownerRect.bottom + 1,
        };
      });
    });
  }

  /** Measures each paperdoll slot and its optional Unequip control. */
  async paperdollControlGeometry(): Promise<
    readonly { slotBottom: number; buttonBottom: number | undefined }[]
  > {
    return await this.inventorySlots.evaluateAll((slots) =>
      slots.map((slot) => {
        const button = slot.querySelector('button');
        const slotRect = slot.getBoundingClientRect();
        const buttonRect = button?.getBoundingClientRect();
        return {
          slotBottom: slotRect.bottom,
          buttonBottom: buttonRect?.bottom,
        };
      }),
    );
  }

  /** Open the production play shell and wait for its management entry point. */
  async open(): Promise<void> {
    await this.page.goto('/game');
    await this.canvasContainer.waitFor({ state: 'attached', timeout: 30_000 });
    await this.managementMenuEntry.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Activate the management host and wait until it owns the UI. */
  async openManagementHost(): Promise<void> {
    await this.managementMenuEntry.click();
    await this.managementHost.waitFor({ state: 'visible', timeout: 10_000 });
  }

  /** Activate a management section through the production section rail. */
  async openManagementSection(section: string): Promise<void> {
    await this.page.getByTestId(`section-tab-${section}`).click();
  }

  /**
   * Return keyboard focus from a restored HUD control to the game surface.
   *
   * The management host deliberately restores focus to its opener for
   * accessibility. A focused button owns subsequent key events, so movement
   * probes must explicitly return to the game before treating a key as fresh
   * gameplay input.
   */
  async focusGameplaySurface(): Promise<void> {
    await this.page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
  }

  /**
   * Return to the authored walkable village spawn through the production loader.
   *
   * Movement probes can otherwise finish inside a solid prop, making a fresh
   * key look inert even though the input path resumed correctly. The reset is
   * a real `loadMap` call, not a position mutation or query-parameter fixture.
   */
  async resetToVillageSpawn(): Promise<void> {
    const loaded = await this.page.evaluate(async () => {
      const seam = (window as unknown as Record<string, unknown>).__AIKAMI_TEST__ as
        | {
            loadPackMap(options: {
              mapId: string;
              nearX?: number;
              nearY?: number;
            }): Promise<boolean>;
            isMapReady(): boolean;
            getCurrentMapId(): string;
          }
        | undefined;
      if (!seam || typeof seam.loadPackMap !== 'function') {
        throw new Error('Map reset test seam is unavailable');
      }
      return await seam.loadPackMap({ mapId: 'village', nearX: 1024, nearY: 1408 });
    });
    if (!loaded) {
      throw new Error('Production map loader rejected the village reset');
    }
    await this.page.waitForFunction(() => {
      const seam = (window as unknown as Record<string, unknown>).__AIKAMI_TEST__ as
        | {
            isMapReady?: () => boolean;
            getCurrentMapId?: () => string;
            getPlayerPosition?: () => { x: number; y: number } | undefined;
          }
        | undefined;
      const position = seam?.getPlayerPosition?.();
      return (
        seam?.isMapReady?.() === true &&
        seam.getCurrentMapId?.() === 'village' &&
        Math.abs((position?.x ?? Number.NaN) - 1024) <= 1 &&
        Math.abs((position?.y ?? Number.NaN) - 1408) <= 1
      );
    });
  }
}
