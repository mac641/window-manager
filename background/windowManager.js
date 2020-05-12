import { configManager } from "./configManager.js";
import { menuManager } from "./menuManager.js";

class windowManager {
  constructor() {
    // Class attributes
    this.config = new configManager();
    this.menu = new menuManager();
    this.windows = [];

    // call startup functions
    this.init();
  }

  async init() {
    browser.menus.onClicked.addListener(async (info) => {
      if (info.menuItemId === this.menu.splitId) {
        this.split();
      } else if (info.menuItemId === this.menu.thresholdId) {
        this.config.askForThresholdConfig();
      } else if (info.menuItemId === this.menu.mergeId) {
        this.merge();
      } else if (info.menuItemId === this.menu.repinId) {
        let config = await this.config.getConfiguration().then(
          (value) => value,
          (error) => console.error(error)
        );
        if (info.checked) {
          config.repinTabs = true;
        } else {
          config.repinTabs = false;
        }
        this.config.setConfiguration(config);
      }
    });

    this.windows = await this.getCurrentWindows().then(
      (value) => value,
      (error) => console.error(error)
    );
  }

  async getCurrentWindows() {
    // get current window as window.Window object and all windows as window.Window array
    const currentWindow = await browser.windows.getCurrent();
    const windows = await browser.windows.getAll({});

    // Remove incognito windows and return
    return windows.filter((windowObj) => {
      return windowObj.incognito === currentWindow.incognito;
    });
  }

  // TODO: split / merge -> reduce code duplication when implementing in separate class
  async split() {
    // ask for confirmation before splitting tabs into windows
    let isSplit = false;
    await this.config.askForSplitPermission().then(
      (value) => (isSplit = value[0]),
      (error) => console.error(error)
    );

    if (!isSplit) {
      return;
    }

    this.windows = await this.getCurrentWindows().then(
      (value) => value,
      (error) => console.error(error)
    );
    const windows = this.windows;

    const config = await this.config.getConfiguration().then(
      (value) => value,
      (error) => console.error(error)
    );
    if (config.repinTabs) {
      splitRepinTabs(windows);
    } else {
      splitIgnorePinnedTabs(windows);
    }

    async function splitRepinTabs(windows) {
      // For each window get all tabs, map them to current window object and push pinned tabs into repin array after unpinning
      let repin = [];
      const promises = windows.map(async (windowObj) => {
        const tabs = await browser.tabs.query({
          windowId: windowObj.id
        });
        tabs.map((tab) => {
          if (tab.pinned) {
            repin.push(
              browser.tabs.update(tab.id, {
                pinned: false
              })
            );
          }
          return tab.id;
        });
        if (tabs.length < 2) {
          return;
        }
        tabs.map((tab) => {
          browser.windows.create({
            tabId: tab.id
          });
        });
      });

      // Solve all Promises and repin previously unpinned tabs
      await Promise.all(promises);
      const repinTabs = await Promise.all(repin);
      repinTabs.forEach(async function (tab) {
        // FIXME: browser.tabs.update does not repin tab - WHYYYYY?!
        browser.tabs.update(tab.id, { pinned: true });
      });
    }

    async function splitIgnorePinnedTabs(windows) {
      const promises = windows.map(async (windowObj) => {
        const tabs = await browser.tabs.query({
          windowId: windowObj.id
        });
        if (tabs.length < 2) {
          return;
        }
        tabs.map((tab) => {
          browser.windows.create({
            tabId: tab.id
          });
        });
      });

      // Solve all Promises and repin previously unpinned tabs
      await Promise.all(promises);
    }
    this.menu.calculateTemporaryMenu();
  }

  async merge() {
    const windowMap = new Map();
    let biggestCount = 0;
    let biggest = null;
    let repin = [];

    this.windows = await this.getCurrentWindows().then(
      (value) => value,
      (error) => console.error(error)
    );
    const windows = this.windows;

    const config = await this.config.getConfiguration().then(
      (value) => value,
      (error) => console.error(error)
    );
    if (config.repinTabs) {
      mergeRepinTabs(windows);
    } else {
      mergeIgnorePinnedTabs(windows);
    }

    async function mergeRepinTabs(windows) {
      // For each window map tabs to window objects, unpin pinned tabs and push them into repin array
      const promises = windows.map(async function (windowObj) {
        const tabs = await browser.tabs.query({
          windowId: windowObj.id
        });
        windowMap.set(
          windowObj,
          tabs.map((tab) => {
            if (tab.pinned) {
              repin.push(browser.tabs.update(tab.id, { pinned: false }));
            }
            return tab.id;
          })
        );
        if (tabs.length > biggestCount) {
          biggest = windowObj;
          biggestCount = tabs.length;
        }
      });

      // Solve all Promises and repin previously unpinned tabs
      await Promise.all(promises);
      const repinTabs = await Promise.all(repin);
      windows.forEach((windowObj) => {
        if (windowObj === biggest) {
          return;
        }
        browser.tabs.move(windowMap.get(windowObj), {
          index: -1,
          windowId: biggest.id
        });
      });
      repinTabs.forEach((tab) => {
        browser.tabs.update(tab.id, {
          pinned: true
        });
      });
    }

    async function mergeIgnorePinnedTabs(windows) {
      // For each window map tabs to window objects, unpin pinned tabs and push them into repin array
      const promises = windows.map(async function (windowObj) {
        const tabs = await browser.tabs.query({
          windowId: windowObj.id
        });
        windowMap.set(
          windowObj,
          tabs.map((tab) => {
            browser.tabs.update(tab.id, { pinned: false });
            return tab.id;
          })
        );
        if (tabs.length > biggestCount) {
          biggest = windowObj;
          biggestCount = tabs.length;
        }
      });

      // Solve all Promises and repin previously unpinned tabs
      await Promise.all(promises);
      windows.forEach((windowObj) => {
        if (windowObj === biggest) {
          return;
        }
        browser.tabs.move(windowMap.get(windowObj), {
          index: -1,
          windowId: biggest.id
        });
      });
    }
    this.menu.calculateTemporaryMenu();
  }
}

new windowManager();
