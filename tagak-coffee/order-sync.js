// A null event requests a snapshot after LISTEN is ready, including any changes missed offline.
function watchOrderChanges(getUrl, refresh) {
  let source, activeUrl, timer, reconnect, snapshot, running = false;
  let retryMs = 2000;
  const changed = new Set();

  function schedule(ticket = null, delay = 80) {
    if (ticket === null) snapshot = true;
    else changed.add(ticket);
    if (!running && !timer) timer = setTimeout(flush, delay);
  }
  async function flush() {
    timer = null;
    if (!activeUrl) return;
    running = true;
    const pending = snapshot ? null : [...changed];
    snapshot = false;
    changed.clear();
    let ok = false;
    try { ok = await refresh(pending); }
    finally {
      running = false;
      if (activeUrl) {
        if (!ok) schedule(null, 5000);
        else if (changed.size || snapshot) timer = setTimeout(flush, 80);
      }
    }
  }
  function stop() {
    source?.close();
    clearTimeout(reconnect);
    clearTimeout(timer);
    source = activeUrl = timer = null;
    changed.clear();
    snapshot = false;
  }
  function connect() {
    const url = !document.hidden && navigator.onLine && getUrl();
    if (url && url === activeUrl) return;
    stop();
    if (!url) return;
    activeUrl = url;
    source = new EventSource(url);
    source.onmessage = ({ data }) => {
      retryMs = 2000;
      schedule(JSON.parse(data));
    };
    source.onerror = () => {
      source.close();
      // Refresh from the regular API while the event transport is unavailable.
      schedule();
      reconnect = setTimeout(() => { stop(); connect(); }, retryMs);
      retryMs = Math.min(retryMs * 2, 30000);
    };
  }
  document.addEventListener('visibilitychange', connect);
  window.addEventListener('online', connect);
  window.addEventListener('offline', connect);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', connect);
  return connect;
}
