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

  get characterEditToggle() {
    return this.page.getByTestId('character-edit-toggle');
  }

  get inventoryPaperdoll() {
    return this.page.getByTestId('inventory-paperdoll');
  }

  get inventoryBag() {
    return this.page.getByTestId('inventory-bag');
  }

  get inventoryDetail() {
    return this.page.getByTestId('inventory-detail');
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
  async seedManagementContent(scenario: 'empty' | 'populated'): Promise<void> {
    await this.page.evaluate((contentScenario) => {
      const seam = (window as unknown as Record<string, unknown>).__AIKAMI_TEST__ as
        | {
            seedManagementContent(options: {
              scenario: 'empty' | 'populated';
            }): Record<string, number>;
          }
        | undefined;
      seam?.seedManagementContent({ scenario: contentScenario });
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
}
