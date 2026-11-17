/* Live updates through Lovable Cloud realtime. Stands in for the old /api/stream:
   it behaves like an EventSource that fires a "v" event whenever results change. */
(function () {
  'use strict';
  var cfg = window.SD_CLOUD;
  if (!cfg || !window.supabase || !window.supabase.createClient) return;
  var client = null;
  function getClient() {
    return client || (client = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }));
  }
  function LiveSource() {
    var self = this, timer = null;
    this.onopen = null; this.onerror = null; this._l = {};
    function emit() {                        // coalesce bursts: at most ~5 refreshes a second
      if (timer) return;
      timer = setTimeout(function () { timer = null; (self._l.v || []).forEach(function (fn) { try { fn({ data: '' }); } catch (e) { /* ignore */ } }); }, 200);
    }
    this._ch = getClient()
      .channel('sd-live-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_version' }, emit)
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') { if (self.onopen) self.onopen(); emit(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { if (self.onerror) self.onerror(); }
      });
  }
  LiveSource.prototype.addEventListener = function (name, fn) { (this._l[name] = this._l[name] || []).push(fn); };
  LiveSource.prototype.close = function () { if (this._ch) getClient().removeChannel(this._ch); this._ch = null; };
  window.SDLiveSource = LiveSource;
})();
