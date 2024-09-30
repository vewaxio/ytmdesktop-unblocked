// eslint-disable-next-line @typescript-eslint/no-unused-expressions
(function () {
  const ytmStore = window.__YTMD_HOOK__.ytmStore;

  let currentLyricBrowseId = "";
  let currentTimedLyrics = null;
  let autoScrolling = false;
  let autoScrollPaused = false;
  let viewingLyricsTab = false;

  let timedLyricsContainer = document.createElement("div");
  timedLyricsContainer.classList.add("ytmd-lyrics");
  let timedLyricsSource = document.createElement("p");
  timedLyricsSource.classList.add("ytmd-lyrics-source");

  let returnToLiveContainer = document.createElement("div");
  returnToLiveContainer.classList.add("ytmd-lyrics-return-live-container");
  let returnToLive = document.createElement("yt-button-renderer");
  returnToLive.classList.add("ytmd-lyrics-return-live");
  returnToLive.data = {
    text: {
      runs: [
        {
          text: "Scroll to Current"
        }
      ]
    },
    style: "STYLE_OVERLAY"
  };

  function enableAutoScroll() {
    autoScrollPaused = false;
    returnToLive.hidden = true;
    
  }

  function disableAutoScroll() {
    autoScrollPaused = true;
    returnToLive.hidden = false;
  }

  returnToLive.onClick = () => {
    enableAutoScroll();
    autoScrolling = true;
    timedLyricsContainer.querySelector(".active").scrollIntoView({
      behavior: "instant",
      block: "center",
      inline: "center"
    });
  }
  returnToLiveContainer.appendChild(returnToLive);

  let tabRenderer = document.querySelector("#player-page #tab-renderer");
  tabRenderer.addEventListener("scroll", () => {
    if (!viewingLyricsTab) return;
    if (autoScrolling) return;

    disableAutoScroll();
  });
  tabRenderer.addEventListener("scrollend", () => {
    if (!viewingLyricsTab) return;
    if (autoScrolling) {
      autoScrolling = false;
      return;
    }
  });

  async function getTimedLyrics() {
    try {
      const json = await document.querySelector("ytmusic-app").networkManager.fetch("/browse", {
        browseId: currentLyricBrowseId,
        context: {
          ytmdOverrides: {
            context: {
              client: {
                clientName: "ANDROID_MUSIC",
                clientVersion: "7.12.5"
              }
            }
          }
        }
      });

      // This is likely a timed lyrics response
      if (json.contents && json.contents.elementRenderer) {
        const timedLyrics = json.contents.elementRenderer.newElement.type.componentType.model.timedLyricsModel.lyricsData.timedLyricsData;
        const source = json.contents.elementRenderer.newElement.type.componentType.model.timedLyricsModel.lyricsData.sourceMessage;

        timedLyricsSource.innerText = source;

        let lyricElements = [];
        for (let lyric of timedLyrics) {
          let lyricElement = document.createElement("p");
          lyricElement.innerText = lyric.lyricLine;
          lyricElement.classList.add("ytmd-lyric-line");
          lyricElement.setAttribute("data-start-ms", lyric.cueRange.startTimeMilliseconds);
          lyricElement.setAttribute("data-end-ms", lyric.cueRange.endTimeMilliseconds);
          lyricElement.onclick = () => {
            enableAutoScroll();
            document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.seekTo(parseInt(lyric.cueRange.startTimeMilliseconds) / 1000);
          };
          lyricElements.push(lyricElement);
        }
        timedLyricsContainer.replaceChildren(...lyricElements);

        currentTimedLyrics = {
          timedLyrics,
          source
        };
      } else {
        currentTimedLyrics = null;
      }
    } catch (err) {
      /* empty */
    }
  }

  function waitForElement(root, selector) {
    return new Promise(resolve => {
      if (root.querySelector(selector)) {
        return resolve(root.querySelector(selector));
      }

      const observer = new MutationObserver(() => {
        if (root.querySelector(selector)) {
          observer.disconnect();
          resolve(root.querySelector(selector));
        }
      });

      observer.observe(root, {
        childList: true,
        subtree: true
      });
    });
  }

  async function updateLyricsTab() {
    if (currentTimedLyrics) {
      let tabRenderer = document.querySelector("#player-page #tab-renderer");

      const contents = await waitForElement(tabRenderer, ".ytmusic-tab-renderer[page-type='MUSIC_PAGE_TYPE_TRACK_LYRICS'] > #contents");
      contents.replaceChildren(timedLyricsContainer, timedLyricsSource, returnToLiveContainer);
    }
  }

  // This could definitely be optimized far better
  function updateLyricLines(progress) {
    let msProgress = progress * 1000;
    for (let lyric of timedLyricsContainer.children) {
      let lyricStart = parseInt(lyric.getAttribute("data-start-ms"));
      let lyricEnd = parseInt(lyric.getAttribute("data-end-ms"));

      if (msProgress >= lyricStart && msProgress < lyricEnd) {
        if (!lyric.classList.contains("active")) {
          lyric.classList.add("active");
          if (!autoScrollPaused) {
            autoScrolling = true;
            lyric.scrollIntoView({
              behavior: "smooth",
              block: "center",
              inline: "center"
            });
          }
        }
      } else {
        if (lyric.classList.contains("active")) lyric.classList.remove("active");
      }
    }
  }

  ytmStore.subscribe(async () => {
    const state = ytmStore.getState();
    if (state.playerPage && state.playerPage.playerPageTabs) {
      let lyricsTab = -1;
      for (let i = 0; i < state.playerPage.playerPageTabs.length; i++) {
        const tab = state.playerPage.playerPageTabs[i];
        // Check if this is the Music Page Lyrics tab
        if (tab.tabRenderer?.endpoint?.browseEndpoint?.browseId.startsWith("MPLY")) {
          lyricsTab = i;
          break;
        }
      }

      const lyricBrowseId = state.playerPage.playerPageTabs[lyricsTab].tabRenderer.endpoint.browseEndpoint.browseId;
      if (currentLyricBrowseId !== lyricBrowseId) {
        currentLyricBrowseId = lyricBrowseId;
        enableAutoScroll();
        await getTimedLyrics();
      }

      if (state.playerPage.playerPageTabSelectedIndex && state.playerPage.playerPageTabSelectedIndex === lyricsTab) {
        viewingLyricsTab = true;
        await updateLyricsTab();
        enableAutoScroll();
        autoScrolling = true;
        timedLyricsContainer.querySelector(".active").scrollIntoView({
          behavior: "instant",
          block: "center",
          inline: "center"
        });
      } else {
        viewingLyricsTab = false;
      }
    }
  });

  document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.addEventListener("onVideoProgress", progress => {
    updateLyricLines(progress);
  });
});
