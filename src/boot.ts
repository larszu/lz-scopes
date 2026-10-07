// ?out=… pattern generator, ?view=… output window, otherwise the scope app.
const q = new URLSearchParams(location.search);
if (q.has('out')) import('./output').then((m) => m.runOutputWindow());
else if (q.has('view')) import('./outputView').then((m) => m.runOutputView());
else if ((window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) {
  // iOS/iPadOS app (ios/, docs/ios.md): native set-up around the same web app
  import('./native/ios').then(async (n) => { await n.beforeApp(); await import('./main'); n.afterApp(); });
} else import('./main');
