// @effect-diagnostics nodeBuiltinImport:off -- Fixtures use Chromium's standard OSCrypt format.
import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { beforeEach, vi } from "vite-plus/test";

import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import { importSetup } from "./DesktopT3CodeSetup.ts";

const { getPassword } = vi.hoisted(() => ({ getPassword: vi.fn<() => string | null>() }));
vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    getPassword = getPassword;
  },
}));

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeTokens = Schema.decodeSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);
const decodeEnvelope = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      encryptedCatalog: Schema.String,
    }),
  ),
);
const decodeCatalog = Schema.decodeSync(Schema.fromJsonString(ConnectionCatalogDocument));
const decodeSettings = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      theme: Schema.String,
      onboardingCompletedAt: Schema.String,
    }),
  ),
);
const decodeLegacy = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      records: Schema.Array(
        Schema.Struct({ environmentId: Schema.String, encryptedBearerToken: Schema.String }),
      ),
    }),
  ),
);
const secret = "official-keychain-test-secret";
function officialEncryption(value: string) {
  const key = NodeCrypto.pbkdf2Sync(secret, "saltysalt", 1003, 16, "sha1");
  const cipher = NodeCrypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
  return Buffer.concat([Buffer.from("v10"), cipher.update(value), cipher.final()]).toString(
    "base64",
  );
}
const paperEncryption = (value: string) => Buffer.from(`paper:${value}`).toString("base64");
const paperDecryption = (value: string) => Buffer.from(value, "base64").toString().slice(6);

const layerSafeStorage = Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, {
  isEncryptionAvailable: Effect.succeed(true),
  encryptString: (value) => Effect.succeed(Buffer.from(`paper:${value}`)),
  decryptString: (value) => Effect.succeed(Buffer.from(value).toString().slice(6)),
  selectedStorageBackend: Effect.succeedNone,
});

beforeEach(() => getPassword.mockReset().mockReturnValue(secret));

const withHome = <A, E, R>(
  effect: Effect.Effect<A, E, R | DesktopEnvironment.DesktopEnvironment>,
  overrides: { readonly isPackaged?: boolean; readonly customHome?: boolean } = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const homeDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-paper-import-" });
    const environment = DesktopEnvironment.layer({
      dirname: "/repo/apps/desktop/dist-electron",
      homeDirectory,
      platform: "darwin",
      processArch: "arm64",
      appVersion: "0.1.0",
      appPath: "/repo",
      isPackaged: overrides.isPackaged ?? true,
      resourcesPath: "/resources",
      runningUnderArm64Translation: false,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeServices.layer,
          DesktopConfig.layerTest({
            T3CODE_HOME: overrides.customHome ? `${homeDirectory}/isolated` : undefined,
          }),
        ),
      ),
    );
    return yield* effect.pipe(Effect.provide(environment));
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, layerSafeStorage)), Effect.scoped);

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const source = path.join(environment.homeDirectory, ".t3", "userdata");
  yield* fs.makeDirectory(source, { recursive: true });
  yield* fs.makeDirectory(environment.stateDir, { recursive: true });
  return { fs, path, environment, source };
});

describe("existing T3 Code setup", () => {
  it.effect(
    "imports the account and machine connections without touching the official install",
    () =>
      withHome(
        Effect.gen(function* () {
          const { fs, path, environment, source } = yield* setup;
          const tokens = encodeJson({
            __clerk_client_jwt: `enc:${officialEncryption("account-session")}`,
          });
          const catalog = {
            schemaVersion: 1,
            targets: [
              { _tag: "RelayConnectionTarget", environmentId: "my-machine", label: "My Mac" },
            ],
            profiles: [],
            credentials: [],
            remoteDpopTokens: [
              {
                environmentId: "my-machine",
                label: "My Mac",
                accessToken: "device-bound-token",
                endpoint: {
                  httpBaseUrl: "https://machine.example",
                  wsBaseUrl: "wss://machine.example",
                  providerKind: "t3_relay",
                },
                expiresAtEpochMs: 1234567890,
                dpopThumbprint: "other-device-key",
              },
            ],
            disabledEnvironmentIds: [],
          };
          const encryptedCatalog = encodeJson({
            version: 1,
            encryptedCatalog: officialEncryption(encodeJson(catalog)),
          });
          yield* fs.writeFileString(path.join(source, "clerk-tokens.json"), tokens);
          yield* fs.writeFileString(path.join(source, "connection-catalog.json"), encryptedCatalog);
          yield* fs.writeFileString(
            path.join(environment.stateDir, "connection-catalog.json"),
            encodeJson({
              version: 1,
              encryptedCatalog: paperEncryption(
                encodeJson({ ...catalog, targets: [], remoteDpopTokens: [] }),
              ),
            }),
          );
          yield* fs.writeFileString(
            path.join(source, "statev2.sqlite"),
            "must never open this database",
          );
          yield* fs.writeFileString(path.join(source, "client-settings.json"), '{"theme":"dark"}');

          yield* importSetup();

          const importedTokens = decodeTokens(
            yield* fs.readFileString(path.join(environment.stateDir, "clerk-tokens.json")),
          );
          assert.equal(
            paperDecryption(importedTokens.__clerk_client_jwt!.slice(4)),
            "account-session",
          );
          const importedCatalog = decodeEnvelope(
            yield* fs.readFileString(path.join(environment.stateDir, "connection-catalog.json")),
          );
          assert.deepEqual(
            decodeCatalog(paperDecryption(importedCatalog.encryptedCatalog)),
            decodeCatalog(encodeJson({ ...catalog, remoteDpopTokens: [] })),
          );
          assert.equal(yield* fs.readFileString(path.join(source, "clerk-tokens.json")), tokens);
          assert.equal(
            yield* fs.readFileString(path.join(source, "connection-catalog.json")),
            encryptedCatalog,
          );
          assert.equal(
            yield* fs.readFileString(path.join(source, "statev2.sqlite")),
            "must never open this database",
          );
          assert.isFalse(yield* fs.exists(path.join(environment.stateDir, "statev2.sqlite")));
          const settings = decodeSettings(yield* fs.readFileString(environment.clientSettingsPath));
          assert.equal(settings.theme, "dark");
          assert.match(settings.onboardingCompletedAt, /^\d{4}-/);

          yield* fs.writeFileString(path.join(environment.stateDir, "clerk-tokens.json"), "{}");
          yield* importSetup();
          assert.equal(
            yield* fs.readFileString(path.join(environment.stateDir, "clerk-tokens.json")),
            "{}",
          );
        }),
      ),
  );

  it.effect("preserves an existing Paper account and connections", () =>
    withHome(
      Effect.gen(function* () {
        const { fs, path, environment, source } = yield* setup;
        const tokens = '{"__clerk_client_jwt":"enc:already-signed-in"}';
        const catalog = encodeJson({
          version: 1,
          encryptedCatalog: paperEncryption(
            encodeJson({
              schemaVersion: 1,
              targets: [
                { _tag: "RelayConnectionTarget", environmentId: "paper-machine", label: "Paper" },
              ],
              profiles: [],
              credentials: [],
              remoteDpopTokens: [],
              disabledEnvironmentIds: [],
            }),
          ),
        });
        yield* fs.writeFileString(path.join(environment.stateDir, "clerk-tokens.json"), tokens);
        yield* fs.writeFileString(
          path.join(environment.stateDir, "connection-catalog.json"),
          catalog,
        );
        yield* fs.writeFileString(
          path.join(source, "clerk-tokens.json"),
          '{"__clerk_client_jwt":"enc:should-not-read"}',
        );
        yield* fs.writeFileString(
          path.join(source, "connection-catalog.json"),
          '{"version":1,"encryptedCatalog":"should-not-read"}',
        );
        yield* importSetup();
        assert.equal(
          yield* fs.readFileString(path.join(environment.stateDir, "clerk-tokens.json")),
          tokens,
        );
        assert.equal(
          yield* fs.readFileString(path.join(environment.stateDir, "connection-catalog.json")),
          catalog,
        );
        assert.equal(getPassword.mock.calls.length, 0);
      }),
    ),
  );

  it.effect("re-encrypts legacy saved bearer credentials", () =>
    withHome(
      Effect.gen(function* () {
        const { fs, path, environment, source } = yield* setup;
        const record = {
          environmentId: "legacy-machine",
          label: "Legacy",
          encryptedBearerToken: officialEncryption("bearer-token"),
        };
        yield* fs.writeFileString(
          path.join(source, "saved-environments.json"),
          encodeJson({ version: 1, records: [record] }),
        );
        yield* importSetup();
        const saved = decodeLegacy(
          yield* fs.readFileString(environment.savedEnvironmentRegistryPath),
        );
        assert.equal(saved.records[0]!.environmentId, "legacy-machine");
        assert.equal(paperDecryption(saved.records[0]!.encryptedBearerToken), "bearer-token");
      }),
    ),
  );

  it.effect("carries over completed setup while preserving Paper preferences", () =>
    withHome(
      Effect.gen(function* () {
        const { fs, path, environment, source } = yield* setup;
        yield* fs.writeFileString(
          path.join(source, "clerk-tokens.json"),
          encodeJson({
            __clerk_client_jwt: `enc:${officialEncryption("account-session")}`,
          }),
        );
        yield* fs.writeFileString(
          path.join(source, "client-settings.json"),
          encodeJson({
            settings: { theme: "dark", onboardingCompletedAt: "2026-10-17T00:00:00Z" },
          }),
        );
        yield* fs.writeFileString(
          environment.clientSettingsPath,
          encodeJson({ theme: "light", onboardingCompletedAt: null }),
        );
        yield* importSetup();
        const settings = decodeSettings(yield* fs.readFileString(environment.clientSettingsPath));
        assert.equal(settings.theme, "light");
        assert.equal(settings.onboardingCompletedAt, "2026-10-17T00:00:00Z");
      }),
    ),
  );

  it.effect("retries after Keychain access is denied without marking setup imported", () =>
    withHome(
      Effect.gen(function* () {
        const { fs, path, environment, source } = yield* setup;
        yield* fs.writeFileString(
          path.join(source, "clerk-tokens.json"),
          encodeJson({ __clerk_client_jwt: `enc:${officialEncryption("account-session")}` }),
        );
        getPassword.mockImplementation(() => {
          throw new Error("User denied access");
        });
        const error = yield* importSetup().pipe(Effect.flip);
        assert.equal(error._tag, "ChromiumKeyError");
        assert.isFalse(yield* fs.exists(path.join(environment.stateDir, "t3code-setup-imported")));
        assert.isFalse(yield* fs.exists(path.join(environment.stateDir, "clerk-tokens.json")));
        getPassword.mockReturnValue(secret);
        yield* importSetup();
        assert.isTrue(yield* fs.exists(path.join(environment.stateDir, "t3code-setup-imported")));
      }),
    ),
  );

  it.effect.each([{ isPackaged: false }, { customHome: true }])(
    "leaves development and explicitly configured homes alone (%j)",
    (overrides) =>
      withHome(
        Effect.gen(function* () {
          const { fs, path, environment, source } = yield* setup;
          yield* fs.writeFileString(
            path.join(source, "clerk-tokens.json"),
            encodeJson({
              __clerk_client_jwt: `enc:${officialEncryption("account-session")}`,
            }),
          );
          yield* importSetup();
          assert.equal(getPassword.mock.calls.length, 0);
          assert.isFalse(yield* fs.exists(path.join(environment.stateDir, "clerk-tokens.json")));
        }),
        overrides,
      ),
  );
});
