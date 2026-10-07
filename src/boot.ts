// ?out=… pattern generator, ?view=… output window, otherwise the scope app.
const q = new URLSearchParams(location.search);
// own images and logo (IndexedDB, #52) first, so ?out=img:… finds its pattern
if (q.has('out')) import('./userPatterns').then((u) => u.loadUserPatterns()).catch(() => {}).then(() => import('./output')).then((m) => m.runOutputWindow());
else if (q.has('view')) import('./outputView').then((m) => m.runOutputView());
else import('./main');
