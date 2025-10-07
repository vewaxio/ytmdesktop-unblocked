import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitterService } from "../service";
import { app, ipcMain } from "electron";
import { Context, Unleash } from "unleash-client";

declare const YTMD_UNLEASH_SERVER: string;
declare const YTMD_UNLEASH_INSTANCE_ID: string;

export type FlagManagerEventMap = {
  ready: [];
  synchronized: [];
  changed: [{ [flag: string]: boolean }];
};

export default class FlagManager extends EventEmitterService<FlagManagerEventMap> {
  private context: Context = {
    sessionId: Math.floor(Math.random() * 1_000_000_000).toString()
  };
  private unleash: Unleash;

  public override onPreInitialized(): void {}
  public override async onInitialized(): Promise<void> {
    if (YTMD_UNLEASH_SERVER) {
      const unleashSessionIdPath = path.join(app.getPath("userData"), ".unleash-sid");

      try {
        await fs.access(unleashSessionIdPath, fs.constants.F_OK);

        try {
          this.context.sessionId = await fs.readFile(unleashSessionIdPath, { encoding: "utf8" });
        } catch {
          /* Do nothing and just default to random every time if we couldn't properly read the file */
        }
      } catch {
        await fs.writeFile(unleashSessionIdPath, this.context.sessionId);
      }

      this.unleash = new Unleash({
        url: YTMD_UNLEASH_SERVER,
        appName: app.isPackaged ? "production" : "development",
        instanceId: YTMD_UNLEASH_INSTANCE_ID,
        backupPath: app.getPath("userData")
      });

      this.unleash.on("ready", () => {
        this.emit("ready");
      });
      this.unleash.on("synchronized", () => {
        this.emit("synchronized");
      });
      this.unleash.on("changed", data => {
        this.emit("changed", data);
      });
    }

    ipcMain.handle("flags:getFlag", (event, flag: string) => {
      return this.getFlag(flag);
    });
    ipcMain.handle("flags:getFlags", () => {
      return this.getFlags();
    });
  }
  public override onPostInitialized(): void {}
  public override onTerminated(): void {}

  public get isSynchronized() {
    return this.unleash?.isSynchronized() ?? false;
  }

  /**
   * Gets the flag enable state
   * @param flag
   * @returns
   */
  public getFlag(flag: string): boolean {
    return this.unleash?.getFeatureToggleDefinition(flag)?.enabled ?? false;
  }

  /**
   * Gets the flags and their enable state
   * @returns
   */
  public getFlags(): { flag: string; enabled: boolean }[] {
    return this.unleash?.getFeatureToggleDefinitions()?.map(flag => ({ flag: flag.name, enabled: flag.enabled }));
  }
}
