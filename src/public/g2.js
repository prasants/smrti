/**
 * g2.js — Even Hub G2 bridge module for SMRTi
 * Handles all communication with Even Realities G2 smart glasses via the SDK.
 */

import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';

const DISPLAY_W = 576;
const DISPLAY_H = 136;

export class G2Bridge {
  constructor() {
    this.bridge = null;
    this.initialized = false; // tracks whether createStartUpPageContainer has been called
    this.onListSelect = null; // callback: (itemName) => void
    this.unsubEvents = null;
    this.unsubDevice = null;
  }

  /**
   * Attempt to connect to the Even App bridge.
   * Returns true if running inside Even App WebView, false otherwise.
   */
  async connect() {
    try {
      this.bridge = await waitForEvenAppBridge();
      console.log('[G2] Bridge connected');

      // Listen for events
      this.unsubEvents = this.bridge.onEvenHubEvent((event) => {
        if (event.listEvent && this.onListSelect) {
          this.onListSelect(event.listEvent.currentSelectItemName);
        }
      });

      // Monitor device status
      this.unsubDevice = this.bridge.onDeviceStatusChanged((status) => {
        console.log('[G2] Device status:', status.connectType);
      });

      return true;
    } catch (err) {
      console.log('[G2] Not in Even App WebView:', err.message);
      return false;
    }
  }

  /**
   * Show a page with a text area and a list of actions.
   * @param {string} text - Text to display (top area)
   * @param {string[]} actions - List items (bottom area)
   */
  async showPage(text, actions) {
    if (!this.bridge) return;

    const container = {
      containerTotalNum: 2,
      textObject: [{
        xPosition: 10,
        yPosition: 4,
        width: DISPLAY_W - 20,
        height: 90,
        containerID: 1,
        containerName: 'main-text',
        content: text.slice(0, 1000),
        isEventCapture: 0,
      }],
      listObject: [{
        xPosition: 10,
        yPosition: 96,
        width: DISPLAY_W - 20,
        height: 36,
        containerID: 2,
        containerName: 'actions',
        itemContainer: {
          itemCount: actions.length,
          itemWidth: 0,
          isItemSelectBorderEn: 1,
          itemName: actions,
        },
        isEventCapture: 1,
      }],
    };

    try {
      if (!this.initialized) {
        const result = await this.bridge.createStartUpPageContainer(container);
        if (result === 0) {
          this.initialized = true;
          console.log('[G2] Startup page created');
        } else {
          console.error('[G2] createStartUpPageContainer failed:', result);
        }
      } else {
        await this.bridge.rebuildPageContainer(container);
      }
    } catch (err) {
      console.error('[G2] showPage error:', err);
    }
  }

  /**
   * Update just the text content (faster than full rebuild).
   */
  async updateText(text) {
    if (!this.bridge || !this.initialized) return;
    try {
      await this.bridge.textContainerUpgrade({
        containerID: 1,
        containerName: 'main-text',
        contentOffset: 0,
        contentLength: text.length,
        content: text.slice(0, 2000),
      });
    } catch (err) {
      console.error('[G2] updateText error:', err);
    }
  }

  /**
   * Store a value in Even App localStorage.
   */
  async store(key, value) {
    if (!this.bridge) return;
    try {
      await this.bridge.setLocalStorage(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch (err) {
      console.error('[G2] store error:', err);
    }
  }

  /**
   * Retrieve a value from Even App localStorage.
   */
  async load(key) {
    if (!this.bridge) return null;
    try {
      const val = await this.bridge.getLocalStorage(key);
      if (!val) return null;
      try { return JSON.parse(val); } catch { return val; }
    } catch (err) {
      console.error('[G2] load error:', err);
      return null;
    }
  }

  /**
   * Shut down the page container and exit the plugin.
   */
  async exit() {
    if (!this.bridge) return;
    try {
      await this.bridge.shutDownPageContainer(0);
    } catch (err) {
      console.error('[G2] exit error:', err);
    }
  }

  destroy() {
    if (this.unsubEvents) this.unsubEvents();
    if (this.unsubDevice) this.unsubDevice();
  }
}
