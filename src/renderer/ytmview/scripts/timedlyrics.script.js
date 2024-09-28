// eslint-disable-next-line @typescript-eslint/no-unused-expressions
(function () {
  const ytmStore = window.__YTMD_HOOK__.ytmStore;

  let currentLyricBrowseId = "";
  let currentTimedLyrics = null;

  let timedLyricsContainer = document.createElement("div");
  timedLyricsContainer.classList.add("ytmd-lyrics");
  let timedLyricsSource = document.createElement("p");
  timedLyricsSource.classList.add("ytmd-lyrics-source");

  async function getTimedLyrics() {
    const response = await fetch("/youtubei/v1/browse?prettyPrint=false", {
      method: "POST",
      body: JSON.stringify({
        browseId: currentLyricBrowseId,
        context: {
          client: {
            clientName: "ANDROID_MUSIC",
            clientVersion: "7.12.5"
          }
        }
      })
    });

    if (response.ok) {
      const json = await response.json();
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
            document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.seekTo(parseInt(lyric.cueRange.startTimeMilliseconds) / 1000);
          }
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
      contents.replaceChildren(timedLyricsContainer, timedLyricsSource);
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
          lyric.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "center"
          });
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
        if (tab.tabRenderer && tab.tabRenderer.title === "Lyrics") {
          lyricsTab = i;
          break;
        }
      }

      const lyricBrowseId = state.playerPage.playerPageTabs[lyricsTab].tabRenderer.endpoint.browseEndpoint.browseId;
      if (currentLyricBrowseId !== lyricBrowseId) {
        currentLyricBrowseId = lyricBrowseId;
        await getTimedLyrics();
      }

      if (state.playerPage.playerPageTabSelectedIndex && state.playerPage.playerPageTabSelectedIndex === lyricsTab) {
        updateLyricsTab();
      }
    }
  });

  document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.addEventListener("onVideoProgress", progress => {
    updateLyricLines(progress);
  });
});
