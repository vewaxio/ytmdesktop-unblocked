import { YTMViewSetupCompletionFlags } from "~shared/types";
import initPlayerStateStore, { waitForYTMPlayerApiReady } from "./playerstatestore";
import polymerhook from "./polymerhook";
import protectedapimanager from "./protectedapimanager";
import { createMaterialSymbolsLink, createStyleSheet } from "./setup/styles";
import { createNavigationMenuArrows } from "./setup/navigation";
import initRemote from "./setup/remote";
import { addTimedLyrics, createAdditionalPlayerBarControls, hideChromecastButton, overrideHistoryButtonDisplay } from "./setup/extras";

protectedapimanager.init();
polymerhook.init();

window.addEventListener("load", async () => {
  let setupCompletions = 0;
  try {
    {
      await polymerhook.ready();

      setupCompletions |= YTMViewSetupCompletionFlags.Early;
    }

    {
      createStyleSheet();
      const materialSymbols = createMaterialSymbolsLink();
      let materialSymbolsLoaded = false;
      materialSymbols.onload = () => {
        materialSymbolsLoaded = true;
      };
      document.head.appendChild(materialSymbols);

      await new Promise<void>(resolve => {
        const interval = setInterval(async () => {
          if (materialSymbolsLoaded) {
            clearInterval(interval);
            resolve();
          }
        }, 250);
      });

      setupCompletions |= YTMViewSetupCompletionFlags.Styles;
    }

    {
      createNavigationMenuArrows();

      setupCompletions |= YTMViewSetupCompletionFlags.Navigation;
    }

    {
      await waitForYTMPlayerApiReady();
      initPlayerStateStore();

      setupCompletions |= YTMViewSetupCompletionFlags.Hooks;
    }

    {
      initRemote();

      setupCompletions |= YTMViewSetupCompletionFlags.Remote;
    }

    {
      overrideHistoryButtonDisplay();
      hideChromecastButton();
      createAdditionalPlayerBarControls();
      addTimedLyrics();

      setupCompletions |= YTMViewSetupCompletionFlags.Extras;
    }
  } catch (error) {
    window.postMessage(
      {
        op: "ytmd-errored",
        error
      },
      "*"
    );
  } finally {
    window.postMessage(
      {
        op: "ytmd-ready",
        completions: setupCompletions
      },
      "*"
    );
  }
});
