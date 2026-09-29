// ?out=… pattern generator, ?view=… output window, otherwise the scope app.
const q = new URLSearchParams(location.search);
if (q.has('out')) import('./output').then((m) => m.runOutputWindow());
else if (q.has('view')) import('./outputView').then((m) => m.runOutputView());
else import('./main');
