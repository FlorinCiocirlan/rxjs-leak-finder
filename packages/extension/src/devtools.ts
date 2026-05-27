chrome.devtools.panels.create(
  'RxJS Leaks',
  '',
  'panel.html',
  (panel) => {
    panel.onShown.addListener(() => {});
  },
);
