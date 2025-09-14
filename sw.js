let lastContentTabId = null;

// Open side panel
chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
});
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-side-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
});

// Track last non-extension tab the user activates
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const t = await chrome.tabs.get(tabId);
    if (t?.url && !t.url.startsWith('chrome-extension://') && !t.url.startsWith('chrome://')) {
      lastContentTabId = tabId;
    }
  } catch {}
});

// Also update on navigation
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab?.url && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('chrome://')) {
    lastContentTabId = tabId;
  }
});

// Message bridge for target tab + image handoff
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'HNE_SET_LAST_TAB' && msg.tabId) {
    lastContentTabId = msg.tabId;
  }
  if (msg?.type === 'HNE_GET_LAST_TAB') {
    sendResponse({ tabId: lastContentTabId || null });
  }
  return true;
});

// Context menu (guard if API absent)
if (chrome.contextMenus) {
  chrome.runtime.onInstalled.addListener(() => {
    try {
      chrome.contextMenus.create({
        id: "openRedactor",
        title: "Redact this page",
        contexts: ["all"]
      });
    } catch (e) { console.warn('contextMenus.create failed', e); }
  });
  chrome.contextMenus.onClicked?.addListener(async (info, tab) => {
    if (info.menuItemId === "openRedactor" && tab?.id) {
      if (tab.url && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('chrome://')) {
        lastContentTabId = tab.id;
      }
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  });
}
