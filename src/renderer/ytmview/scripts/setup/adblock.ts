function cleanPlayerResponse(json: any): any {
  if (!json || typeof json !== "object") return json;

  if (Array.isArray(json.adPlacements) || json.adPlacements) {
    delete json.adPlacements;
  }
  if (Array.isArray(json.adSlots) || json.adSlots) {
    delete json.adSlots;
  }
  if (json.playerAds) {
    delete json.playerAds;
  }
  if (json.adBreakHeartbeatParams) {
    delete json.adBreakHeartbeatParams;
  }
  if (json.playerResponse && typeof json.playerResponse === "object") {
    cleanPlayerResponse(json.playerResponse);
  }

  return json;
}

export function initAdblock(): void {
  // 1. Intercept global window.ytInitialPlayerResponse if set or defined later
  try {
    if ((window as any).ytInitialPlayerResponse) {
      cleanPlayerResponse((window as any).ytInitialPlayerResponse);
    }
    let initialResponse = (window as any).ytInitialPlayerResponse;
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      get() {
        return initialResponse;
      },
      set(val) {
        initialResponse = cleanPlayerResponse(val);
      },
      configurable: true,
      enumerable: true
    });
  } catch (err) {
    console.warn("[ytmd-adblock] Could not hook ytInitialPlayerResponse", err);
  }

  // 2. Intercept window.fetch to prune player API responses and block ad requests
  try {
    const originalFetch = window.fetch;
    window.fetch = async function (...args: any[]) {
      const resource = args[0];
      const url = typeof resource === "string" ? resource : resource?.url || "";

      // Block known ad tracking endpoints
      if (
        url.includes("/api/stats/ads") ||
        url.includes("/pagead/") ||
        url.includes("doubleclick.net") ||
        url.includes("googleadservices.com") ||
        url.includes("googlesyndication.com")
      ) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      const response = await originalFetch.apply(this, args as any);

      // Prune ad metadata from player responses
      if (url.includes("/youtubei/v1/player")) {
        try {
          const clone = response.clone();
          const json = await clone.json();
          cleanPlayerResponse(json);
          return new Response(JSON.stringify(json), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch {
          return response;
        }
      }

      return response;
    };
  } catch (err) {
    console.warn("[ytmd-adblock] Could not hook fetch", err);
  }

  // 3. Intercept XMLHttpRequest for fallback requests
  try {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
      (this as any).__ytmdUrl = typeof url === "string" ? url : url.toString();
      return originalOpen.apply(this, [method, url, ...rest] as any);
    };

    XMLHttpRequest.prototype.send = function (...args: any[]) {
      const url: string = (this as any).__ytmdUrl || "";

      if (
        url.includes("/api/stats/ads") ||
        url.includes("/pagead/") ||
        url.includes("doubleclick.net") ||
        url.includes("googleadservices.com")
      ) {
        return;
      }

      if (url.includes("/youtubei/v1/player")) {
        this.addEventListener("readystatechange", function () {
          if (this.readyState === 4 && this.status === 200) {
            try {
              const data = JSON.parse(this.responseText);
              cleanPlayerResponse(data);
              Object.defineProperty(this, "responseText", { value: JSON.stringify(data), configurable: true });
              Object.defineProperty(this, "response", { value: JSON.stringify(data), configurable: true });
            } catch {
              // ignore parse error
            }
          }
        });
      }

      return originalSend.apply(this, args as any);
    };
  } catch (err) {
    console.warn("[ytmd-adblock] Could not hook XMLHttpRequest", err);
  }

  // 4. In-player ad auto-skipper and promo dismisser
  function skipAdsAndPromos(): void {
    const moviePlayer = document.getElementById("movie_player") as any;
    const video = document.querySelector("video") as HTMLVideoElement | null;
    const adShowing =
      document.querySelector(".ad-showing, .ad-interrupting, .ytp-ad-player-overlay, ytd-ad-slot-renderer") !== null ||
      moviePlayer?.classList?.contains("ad-showing") ||
      moviePlayer?.isAdPlaying?.() === true;

    if (adShowing) {
      // Click native skip button if present
      const skipSelectors = [
        ".ytp-ad-skip-button",
        ".ytp-ad-skip-button-modern",
        ".ytp-skip-ad-button",
        ".videoAdUiSkipButton",
        ".ytp-ad-skip-button-slot",
        "button.ytp-ad-skip-button",
        "[id^='skip-button'] button"
      ];
      for (const selector of skipSelectors) {
        const btn = document.querySelector(selector) as HTMLElement | null;
        if (btn) {
          btn.click();
          break;
        }
      }

      // Try playerApi skipAd
      try {
        if (moviePlayer && typeof moviePlayer.skipAd === "function") {
          moviePlayer.skipAd();
        }
      } catch {}

      // Fast-forward video element to end
      if (video && !isNaN(video.duration) && isFinite(video.duration) && video.duration > 0) {
        video.muted = true;
        video.currentTime = video.duration;
        video.playbackRate = 16;
      }
    }

    // Dismiss promotional mealbars and upgrade prompts
    const promoSelectors = [
      "ytmusic-mealbar-promo-renderer #dismiss-button",
      "ytmusic-popup-container yt-button-renderer#dismiss-button",
      "ytmusic-mealbar-promo-renderer button#dismiss-button",
      "ytmusic-you-there-renderer yt-button-renderer#button",
      "#mealbar-promo #dismiss-button"
    ];
    for (const selector of promoSelectors) {
      const promoBtn = document.querySelector(selector) as HTMLElement | null;
      if (promoBtn) {
        promoBtn.click();
      }
    }
  }

  setInterval(skipAdsAndPromos, 200);

  document.addEventListener(
    "timeupdate",
    e => {
      const target = e.target as HTMLElement;
      if (target && target.tagName === "VIDEO") {
        skipAdsAndPromos();
      }
    },
    true
  );
}
