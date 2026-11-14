// On Android, an in-app WebView can reach behind the system navigation
    // bar while env(safe-area-inset-bottom) reports it wrong (WebViews before
    // 140 often say 0), which left the pedals and the nitro pill under the bar.
    // Tag in-app Android WebViews so --safe-bottom keeps a floor.
    (function () {
      var ua = navigator.userAgent;
      if (!/Android/i.test(ua)) return;
      // Every Android build keeps a floor: the navigation bar is there whether
      // or not the WebView admits to overlaying it, and a button under it can't
      // be tapped. In-app WebViews keep the taller floor.
      document.documentElement.classList.add('android');
      var tag = function () {
        if (/; wv\)/.test(ua)) {
          document.documentElement.classList.add('android-inapp');
        }
      };
      tag();
      // src/host.ts also tags a page laid out edge to edge.
    })();
