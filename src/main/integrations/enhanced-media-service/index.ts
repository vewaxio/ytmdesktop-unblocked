import { app, BrowserView } from "electron";
import playerStateStore, { PlayerState, Thumbnail, VideoState } from "../../player-state-store";
import IIntegration from "../integration";
import { MediaServiceProvider, MediaType, PlaybackStatus, ThumbnailType } from "xosms/dist/binding";
import Integration from "../integration";
import YTMViewManager from "../../services/ytmviewmanager";

function getHighestResThumbnail(thumbnails: Thumbnail[]) {
  let currentWidth = 0;
  let currentHeight = 0;
  let url = null;
  for (const thumbnail of thumbnails) {
    if (thumbnail.width > currentWidth && thumbnail.height > currentHeight) {
      currentWidth = thumbnail.width;
      currentHeight = thumbnail.height;
      url = thumbnail.url;
    }
  }
  return url;
}

export default class EnhancedMediaService extends Integration {
  public override name = "EnhancedMediaService";
  public override storeEnableProperty: Integration["storeEnableProperty"] = "integrations.enhancedMediaServiceEnabled";
  
  private enabled = false;
  private stateCallback: (event: PlayerState) => void = null;
  private mediaServiceProvider: MediaServiceProvider = new MediaServiceProvider("ytmd", "YouTube Music Desktop App");

  constructor() {
    super();

    this.mediaServiceProvider.buttonPressed = (button: unknown) => {
      const ytmViewManager = this.getService(YTMViewManager);
      const ytmView = ytmViewManager.getView();

      if (ytmView) {
        switch (button) {
          case "playpause":
            ytmView.webContents.send("remoteControl:execute", "playPause");
            break;
          case "play":
            ytmView.webContents.send("remoteControl:execute", "play");
            break;
          case "pause":
            ytmView.webContents.send("remoteControl:execute", "pause");
            break;
          case "stop":
            this.ytmView.webContents.send("remoteControl:execute", "pause");
            break;
          case "next":
            ytmView.webContents.send("remoteControl:execute", "next");
            break;
          case "previous":
            ytmView.webContents.send("remoteControl:execute", "previous");
            break;
          default:
            break;
        }
      }
    };
    this.mediaServiceProvider.isEnabled = true;
    this.mediaServiceProvider.nextButtonEnabled = true;
    this.mediaServiceProvider.pauseButtonEnabled = true;
    this.mediaServiceProvider.playButtonEnabled = true;
    this.mediaServiceProvider.previousButtonEnabled = true;
    this.mediaServiceProvider.trackId = "'/org/mpris/MediaPlayer2/ytmdesktop'";
  }
  
  public override onSetup(): void {
    app.commandLine.appendSwitch("disable-features", "MediaSessionService");
  }

  public override onEnabled(): void {
    this.mediaServiceProvider.isEnabled = true;
    this.enabled = true;
    this.stateCallback = event => {
      this.playerStateChanged(event);
    };
    playerStateStore.addEventListener(this.stateCallback);
  }
  
  public override onDisabled(): void {
    this.mediaServiceProvider.isEnabled = false;
    this.enabled = false;
    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
    }
  }

  private playerStateChanged(state: PlayerState) {
    if (this.enabled && state.videoDetails) {
      this.mediaServiceProvider.mediaType = MediaType.Music;
      if (state.videoDetails.album !== null && state.videoDetails.album !== undefined) this.mediaServiceProvider.albumTitle = state.videoDetails.album;
      this.mediaServiceProvider.artist = state.videoDetails.author;
      this.mediaServiceProvider.title = state.videoDetails.title;
      this.mediaServiceProvider.trackId = state.videoDetails.id;
      this.mediaServiceProvider.setThumbnail(ThumbnailType.Uri, getHighestResThumbnail(state.videoDetails.thumbnails));

      if (state.trackState === VideoState.Playing) this.mediaServiceProvider.playbackStatus = PlaybackStatus.Playing;
      if (state.trackState === VideoState.Paused) this.mediaServiceProvider.playbackStatus = PlaybackStatus.Paused;
      if (state.trackState === VideoState.Buffering) this.mediaServiceProvider.playbackStatus = PlaybackStatus.Changing;
      if (state.trackState === VideoState.Unknown) this.mediaServiceProvider.playbackStatus = PlaybackStatus.Closed;
    } else if (this.enabled && !state.videoDetails) {
      this.mediaServiceProvider.playbackStatus = PlaybackStatus.Closed;
    }
  }
}
