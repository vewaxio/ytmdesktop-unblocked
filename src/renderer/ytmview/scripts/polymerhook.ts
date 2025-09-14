export class PolymerHook {
  private reflectDecorate: (...args: unknown[]) => unknown;
  private hookedObjs: object[] = [];
  private recordObjects = true;

  private _ytmStore;
  public get ytmStore(): unknown {
    return this._ytmStore;
  }

  public init() {
    Object.defineProperty(Reflect, "decorate", {
      set: value => {
        this.reflectDecorate = value;
      },
      get: () => {
        return (...args: unknown[]) => {
          if (this.recordObjects) {
            const obj = args[1];
            if (typeof obj === "object") {
              this.hookedObjs.push(obj);
            }
          }

          return this.reflectDecorate(...args);
        };
      }
    });
  }

  public async ready(): Promise<void> {
    if (this._ytmStore) return Promise.resolve();

    return new Promise<void>(resolve => {
      const interval = setInterval(() => {
        for (const hookedObj of this.hookedObjs) {
          if (hookedObj.is && hookedObj.is === "ytmusic-app") {
            if (hookedObj.provide) {
              for (const provider of hookedObj.provide) {
                if (provider.useValue && provider.useValue.store) {
                  this._ytmStore = provider.useValue.store;
                  this.recordObjects = false;
                  this.hookedObjs = [];
                }
              }
            }
          }
        }

        if (this._ytmStore) {
          resolve();
          clearInterval(interval);
        }
      });
    });
  }
}

export default new PolymerHook();
