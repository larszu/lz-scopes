// ?out=… pattern generator, ?view=… output window, ?widget=… embeddable view, otherwise the scope app.
const q = new URLSearchParams(location.search);
// own images and logo (IndexedDB, #52) first, so ?out=img:… finds its pattern
if (q.has('out')) import('./userPatterns').then((u) => u.loadUserPatterns()).catch(() => {}).then(() => import('./output')).then((m) => m.runOutputWindow());
else if (q.has('view')) import('./outputView').then((m) => m.runOutputView());
// ?widget=… embeddable single view (#238, src/widget.ts)
else if (q.has('widget')) import('./widget').then((m) => m.runWidget());
else if ((window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) {
  // iOS/iPadOS app (ios/, docs/ios.md): native set-up around the same web app
  import('./native/ios').then(async (n) => { await n.beforeApp(); await import('./main'); n.afterApp(); });
} else import('./main');
