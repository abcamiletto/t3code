import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import { decryptChromiumValue } from "../preview/BrowserImport/ChromiumCookies.ts";
import { resolveChromiumKeys } from "../preview/BrowserImport/ChromiumKeys.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const EncryptedCatalog = Schema.fromJsonString(
  Schema.Struct({ version: Schema.Literal(1), encryptedCatalog: Schema.String }),
);
const StringRecord = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));
const CatalogJson = Schema.fromJsonString(ConnectionCatalogDocument);
const SavedEnvironmentsJson = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.optionalKey(Schema.Number),
    records: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);
const decodeEncryptedCatalog = Schema.decodeEffect(EncryptedCatalog);
const encodeEncryptedCatalog = Schema.encodeEffect(EncryptedCatalog);
const decodeTokens = Schema.decodeEffect(StringRecord);
const encodeTokens = Schema.encodeEffect(StringRecord);
const decodeCatalog = Schema.decodeEffect(CatalogJson);
const encodeCatalog = Schema.encodeEffect(CatalogJson);
const decodeSavedEnvironments = Schema.decodeEffect(SavedEnvironmentsJson);
const encodeSavedEnvironments = Schema.encodeEffect(SavedEnvironmentsJson);
const SettingsRecord = Schema.Record(Schema.String, Schema.Unknown);
const SettingsJson = Schema.fromJsonString(SettingsRecord);
const decodeSettings = Schema.decodeEffect(SettingsJson);
const decodeSettingsRecord = Schema.decodeUnknownEffect(SettingsRecord);
const encodeSettings = Schema.encodeEffect(SettingsJson);
const KEYCHAIN_NAMES = [
  "T3 Code Beta",
  "T3 Code Alpha",
  "T3 Code",
  "T3 Code (Alpha)",
  "T3 Code (Beta)",
];
const MARKER = "t3code-setup-imported";

class T3CodeSetupImportError extends Schema.TaggedError<T3CodeSetupImportError>()(
  "T3CodeSetupImportError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}

/** Read the official install's client setup; its server databases and browser profile stay owned by it. */
export const importSetup = Effect.fn("desktop.t3CodeSetup.import")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const path = yield* Path.Path;
  if (
    !environment.isPackaged ||
    environment.isDevelopment ||
    environment.platform !== "darwin" ||
    environment.baseDir !== path.join(environment.homeDirectory, ".t3-paper")
  )
    return;

  const fs = yield* FileSystem.FileSystem;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const marker = path.join(environment.stateDir, MARKER);
  if (yield* fs.exists(marker)) return;
  const sourceDir = path.join(environment.homeDirectory, ".t3", "userdata");
  if (!(yield* fs.exists(sourceDir))) return;
  if (!(yield* safeStorage.isEncryptionAvailable)) return;

  const readOptional = (file: string) =>
    fs.readFileString(file).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
    );
  const keys = yield* Effect.cached(
    Effect.gen(function* () {
      const candidates = [];
      for (const name of KEYCHAIN_NAMES) {
        const result = yield* resolveChromiumKeys({
          platform: "darwin",
          keychainService: `${name} Safe Storage`,
          keychainAccount: name,
          linuxSecretApplication: undefined,
        }).pipe(
          Effect.catchIf(
            (error) => error.reason === "keychainItemMissing",
            () => Effect.succeed(null),
          ),
        );
        if (result !== null) candidates.push(result);
      }
      return candidates;
    }),
  );
  const decrypt = Effect.fnUntraced(function* (encoded: string) {
    const encrypted = Buffer.from(encoded, "base64");
    // safeStorage's synchronous macOS format matches Chromium's pre-domain-binding CBC format.
    if (encrypted.subarray(0, 3).toString() !== "v10") {
      return yield* new T3CodeSetupImportError({
        detail: "T3 Code uses an unsupported credential format.",
      });
    }
    for (const candidate of yield* keys) {
      const value = decryptChromiumValue(encrypted, candidate, "", 23, "darwin");
      if (value !== null) return value;
    }
    return yield* new T3CodeSetupImportError({
      detail: "Could not unlock T3 Code's saved login. Allow T3 Paper access to its Keychain item.",
    });
  });
  const encrypt = (value: string) =>
    safeStorage
      .encryptString(value)
      .pipe(Effect.map((bytes) => Buffer.from(bytes).toString("base64")));
  const write = Effect.fnUntraced(function* (file: string, value: string) {
    yield* fs.makeDirectory(environment.stateDir, { recursive: true });
    const destination = path.join(environment.stateDir, file);
    const temporary = `${destination}.${process.pid}.tmp`;
    yield* fs.writeFileString(temporary, `${value}\n`, { mode: 0o600 });
    yield* fs
      .rename(temporary, destination)
      .pipe(Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
  });

  let imported = false;
  const tokens = yield* readOptional(path.join(sourceDir, "clerk-tokens.json"));
  if (tokens !== null) {
    const ownTokens = yield* readOptional(path.join(environment.stateDir, "clerk-tokens.json"));
    const current = ownTokens === null ? {} : yield* decodeTokens(ownTokens);
    const source = yield* decodeTokens(tokens);
    // Import only the client credential. Clerk refreshes it through Paper's own storage adapter.
    const sourceToken = source.__clerk_client_jwt;
    if (!current.__clerk_client_jwt && sourceToken) {
      const value = sourceToken.startsWith("enc:")
        ? yield* decrypt(sourceToken.slice(4))
        : sourceToken.startsWith("raw:")
          ? sourceToken.slice(4)
          : null;
      if (value === null)
        return yield* new T3CodeSetupImportError({
          detail: "T3 Code's saved login could not be read.",
        });
      yield* write(
        "clerk-tokens.json",
        yield* encodeTokens({
          ...current,
          __clerk_client_jwt: `enc:${yield* encrypt(value)}`,
        }),
      );
      imported = true;
    }
  }

  const catalog = yield* readOptional(path.join(sourceDir, "connection-catalog.json"));
  if (catalog !== null) {
    const own = yield* readOptional(path.join(environment.stateDir, "connection-catalog.json"));
    const ownDocument = own === null ? null : yield* decodeEncryptedCatalog(own);
    const current =
      ownDocument === null
        ? null
        : yield* safeStorage
            .decryptString(Buffer.from(ownDocument.encryptedCatalog, "base64"))
            .pipe(Effect.flatMap(decodeCatalog));
    if (current === null || current.targets.length === 0) {
      const document = yield* decodeEncryptedCatalog(catalog);
      const source = yield* decrypt(document.encryptedCatalog).pipe(Effect.flatMap(decodeCatalog));
      // DPoP credentials are bound to the other client's key; the imported account renews them.
      const encoded = yield* encodeCatalog({ ...source, remoteDpopTokens: [] });
      yield* write(
        "connection-catalog.json",
        yield* encodeEncryptedCatalog({
          version: 1,
          encryptedCatalog: yield* encrypt(encoded),
        }),
      );
      imported = imported || source.targets.length > 0;
    }
  } else if (!(yield* fs.exists(environment.savedEnvironmentRegistryPath))) {
    const saved = yield* readOptional(path.join(sourceDir, "saved-environments.json"));
    if (saved !== null) {
      const source = yield* decodeSavedEnvironments(saved);
      const records = [];
      for (const record of source.records) {
        records.push(
          typeof record.encryptedBearerToken === "string"
            ? {
                ...record,
                encryptedBearerToken: yield* encrypt(yield* decrypt(record.encryptedBearerToken)),
              }
            : record,
        );
      }
      yield* write(
        "saved-environments.json",
        yield* encodeSavedEnvironments({
          ...source,
          records,
        }),
      );
      imported = imported || source.records.length > 0;
    }
  }

  if (!imported) return;
  const clientSettings = yield* readOptional(path.join(sourceDir, "client-settings.json"));
  const current = yield* readOptional(environment.clientSettingsPath);
  const sourceDocument = clientSettings === null ? {} : yield* decodeSettings(clientSettings);
  const currentDocument = current === null ? {} : yield* decodeSettings(current);
  const source =
    sourceDocument.settings === undefined
      ? sourceDocument
      : yield* decodeSettingsRecord(sourceDocument.settings);
  const own =
    currentDocument.settings === undefined
      ? currentDocument
      : yield* decodeSettingsRecord(currentDocument.settings);
  // Existing installs predate the welcome wizard; adopting their setup completes it here too.
  yield* write(
    "client-settings.json",
    yield* encodeSettings({
      ...source,
      ...own,
      onboardingCompletedAt:
        own.onboardingCompletedAt ??
        source.onboardingCompletedAt ??
        DateTime.formatIso(yield* DateTime.now),
    }),
  );
  yield* write(MARKER, "");
  yield* Effect.logInfo("Imported T3 Code's account and connections into T3 Paper.");
  return true;
});
