import Fastify, { FastifyInstance } from "fastify";
import FastifyIO from "fastify-socket.io/dist/index";
import CompanionServerAPIv1, { transformPlayerState } from "./api/v1";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { AuthToken } from "~shared/integrations/companion-server/types";
import { RemoteSocket } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import cors from "@fastify/cors";
import log from "electron-log";
import { isDefinedAPIError } from "./api-shared/errors";
import Integration from "../integration";
import { safeStorage } from "electron";
import { MemoryStoreSchema } from "~shared/store/schema";
import MemoryStore from "../../services/memorystore";
import ConfigStore from "../../services/configstore";
import { Constructor } from "~shared/types";
import Service from "../../services/service";
import net from "node:net";
import playerStateStore, { PlayerState } from "../../player-state-store";

const API_VERSIONS = ["v1"];
// The defaults here are for the IPC server
// Developer Note: If updating the DEFAULT_API_VERSION ensure that the DEFAULT_TRANSFORM_PLAYER_STATE points to the correct API version
const DEFAULT_API_VERSION = "v1";
const DEFAULT_TRANSFORM_PLAYER_STATE = transformPlayerState;

export default class CompanionServer extends Integration {
  public name = "CompanionServer";
  public storeEnableProperty: Integration["storeEnableProperty"] = "integrations.companionServerEnabled";
  public override dependentStoreProperties: Integration["dependentStoreProperties"] = ["integrations.companionServerCORSWildcardEnabled"];

  private listenIp = "0.0.0.0";
  private listenPort = 9863;
  private fastifyServer: FastifyInstance;
  private storeListener: () => void | null = null;
  private authWindowTimeout: NodeJS.Timeout | null = null;

  private ipcServer: net.Server;
  private ipcServerClients: net.Socket[] = [];
  private stateStoreListener: (state: PlayerState) => void | null = null;

  private createServer() {
    const configStore = this.getService(ConfigStore);
    this.fastifyServer = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    this.fastifyServer.register(cors, {
      origin: configStore.get("integrations.companionServerCORSWildcardEnabled", false) ? "*" : false
    });
    this.fastifyServer.register(FastifyIO, {
      transports: ["websocket"],
      allowUpgrades: false,
      // While this is websocket only we still apply cors just in case
      cors: {
        origin: configStore.get("integrations.companionServerCORSWildcardEnabled", false) ? "*" : false
      }
    });
    this.fastifyServer.register(CompanionServerAPIv1, {
      prefix: "/api/v1",
      getService: <T extends Service>(service: Constructor<T>) => {
        return this.getService<T>(service);
      }
    });
    this.fastifyServer.setErrorHandler((error, request, reply) => {
      if (!isDefinedAPIError(error)) {
        if (!error.statusCode || error.statusCode >= 500) {
          log.error(error);
          reply.send(new Error("An internal server error occurred"));
          return;
        }
      }

      reply.send(error);
    });
    this.fastifyServer.get("/metadata", (request, reply) => {
      reply.send({
        apiVersions: API_VERSIONS
      });
    });

    // Disconnect connections to the default namespace
    this.fastifyServer.ready().then(() => {
      this.fastifyServer.io.on("connection", socket => socket.disconnect());
    });
  }

  private getIpcPath() {
    if (process.platform === "win32") {
      return `\\\\?\\pipe\\ytmdesktop-ipc`;
    }

    const dirtyPrefix = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
    const prefix = dirtyPrefix.replace(/\/$/, "");

    return `${prefix}/ytmdesktop-ipc`;
  }

  private createIpcServer() {
    this.ipcServer = net.createServer(socket => {
      log.info("ipc: client connected");
      this.ipcServerClients.push(socket);
      let heartbeated = true;
      const heartbeatInterval = setInterval(() => {
        if (!heartbeated) {
          log.info("ipc: client missed heartbeat - disconnecting");
          socket.destroy();
        }
        heartbeated = false;
      }, 30 * 1000);

      const helloPayload = Buffer.from(
        JSON.stringify({
          version: DEFAULT_API_VERSION
        })
      );
      const buffer = Buffer.alloc(8 + helloPayload.byteLength);
      buffer.writeInt32LE(0, 0);
      buffer.writeInt32LE(helloPayload.byteLength, 4);
      helloPayload.copy(buffer, 8);
      socket.write(buffer);

      socket.on("data", data => {
        try {
          const op = data.readInt32LE(0);
          if (op == 2) {
            heartbeated = true;
            const pong = Buffer.alloc(4);
            pong.writeInt32LE(3);
            socket.write(pong);
          }
        } catch {
          socket.destroy();
        }
      });

      socket.on("error", error => {
        log.info(`ipc: client errored ${error}`);
      });

      socket.on("close", () => {
        log.info("ipc: client disconnected");

        clearInterval(heartbeatInterval);

        const clientIndex = this.ipcServerClients.indexOf(socket);
        if (clientIndex !== -1) {
          this.ipcServerClients.splice(clientIndex, 1);
        }
      });
    });

    const pipePath = this.getIpcPath();
    this.ipcServer.listen(pipePath, () => {
      log.info(`ipc: listening on ${pipePath}`);
    });

    this.stateStoreListener = (state: PlayerState) => {
      const eventNameBuffer = Buffer.from("state-update");
      const stateBuffer = Buffer.from(JSON.stringify(DEFAULT_TRANSFORM_PLAYER_STATE(state)));
      const buffer = Buffer.alloc(12 + eventNameBuffer.byteLength + stateBuffer.byteLength);
      buffer.writeInt32LE(1, 0);
      buffer.writeInt32LE(eventNameBuffer.byteLength, 4);
      buffer.writeInt32LE(stateBuffer.byteLength, 8);
      eventNameBuffer.copy(buffer, 12);
      stateBuffer.copy(buffer, 12 + eventNameBuffer.length);

      this.ipcServerClients.forEach(socket => {
        socket.write(buffer);
      });
    };
    playerStateStore.addEventListener(this.stateStoreListener);
  }

  public onSetup() {}

  public async onEnabled() {
    const configStore = this.getService(ConfigStore);
    const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);

    if (!memoryStore.get("safeStorageAvailable")) {
      log.info("Refusing to enable Companion Server Integration with reason: safeStorage unavailable");
      return;
    }

    this.createIpcServer();

    memoryStore.onStateChanged(this.memoryStoryListenerCallback);

    if (!this.fastifyServer || (this.fastifyServer && !this.fastifyServer.server.listening)) {
      this.createServer();
      await this.fastifyServer.listen({
        host: this.listenIp,
        port: this.listenPort
      });
      this.storeListener = configStore.onDidChange("integrations", async newState => {
        const validTokenIds: string[] = newState.companionServerAuthTokens
          ? JSON.parse(safeStorage.decryptString(Buffer.from(newState.companionServerAuthTokens, "hex"))).map((authToken: AuthToken) => authToken.id)
          : [];
        if (this.fastifyServer.server.listening) {
          const namespaces = this.fastifyServer.io._nsps.keys();
          let sockets: RemoteSocket<DefaultEventsMap, { tokenId: string }>[] = [];

          for (const namespace of namespaces) {
            const namespacedSockets = await this.fastifyServer.io.of(namespace).fetchSockets();
            sockets = sockets.concat(namespacedSockets);
          }

          for (const socket of sockets) {
            if (!validTokenIds.includes(socket.data.tokenId)) {
              socket.disconnect(true);
            }
          }
        }
      });
    }
  }

  public async onDisabled() {
    const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);
    memoryStore.set("companionServerAuthWindowEnabled", false);
    memoryStore.removeOnStateChanged(this.memoryStoryListenerCallback);
    if (this.fastifyServer) {
      await this.fastifyServer.close();
      if (this.storeListener) {
        this.storeListener();
      }
    }
    if (this.ipcServer) {
      this.ipcServer.close();
      if (this.stateStoreListener) {
        playerStateStore.removeEventListener(this.stateStoreListener);
      }
    }
  }

  private memoryStoryListenerCallback(newState: MemoryStoreSchema, oldState: MemoryStoreSchema) {
    if (newState.companionServerAuthWindowEnabled && !oldState.companionServerAuthWindowEnabled) {
      this.authWindowTimeout = setTimeout(
        () => {
          const memoryStore = this.getService(MemoryStore<MemoryStoreSchema>);
          memoryStore.set("companionServerAuthWindowEnabled", false);
          this.authWindowTimeout = null;
        },
        5 * 60 * 1000
      );
    } else if (!newState.companionServerAuthWindowEnabled) {
      if (this.authWindowTimeout) {
        clearTimeout(this.authWindowTimeout);
        this.authWindowTimeout = null;
      }
    }
  }
}
