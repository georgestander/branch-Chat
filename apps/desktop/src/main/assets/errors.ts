export type AssetStoreErrorCode =
  | "ASSET_CORRUPT"
  | "ASSET_EMPTY"
  | "ASSET_ID_INVALID"
  | "ASSET_NOT_FOUND"
  | "ASSET_TOO_LARGE"
  | "FILENAME_INVALID"
  | "MIME_EXTENSION_MISMATCH"
  | "MIME_MISMATCH"
  | "SOURCE_NOT_ALLOWED"
  | "SOURCE_NOT_REGULAR"
  | "SOURCE_PATH_INVALID"
  | "STORE_PATH_INVALID"
  | "UNSUPPORTED_MIME";

export class AssetStoreError extends Error {
  readonly code: AssetStoreErrorCode;

  constructor(code: AssetStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AssetStoreError";
    this.code = code;
  }
}
