// ?out=… opens the fullscreen pattern generator instead of the scope app.
if (new URLSearchParams(location.search).has('out')) import('./output').then((m) => m.runOutputWindow());
else import('./main');
