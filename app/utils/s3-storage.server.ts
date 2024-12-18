import { fetch } from "fetch-h2";
import * as Minio from "minio";
import { debug } from "debug";
import path from "node:path";
import env from "./env.server";
import hasha from "hasha";
const debugLog = debug("app:s3-storage");

export type S3StorageOptions = {
  bucket: string;
  storageBaseURL: string;
  basePath?: string;
  storage: Minio.ClientOptions;
  defaultAcl?: string;
};

const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};

export type UploadResponse = Minio.UploadedObjectInfo & {
  url: string;
  hash: string;
};

export function storage() {
  const storageOptions: S3StorageOptions = {
    bucket: env.require("S3_BUCKET"),
    basePath: env.get("S3_BASE_PATH"),
    storageBaseURL: env.require("S3_STORAGE_BASE_URL"),
    defaultAcl: env.require("S3_DEFAULT_ACL"),
    storage: {
      endPoint: env.require("S3_ENDPOINT"),
      port: Number(env.get("S3_PORT")) || undefined,
      useSSL: env.get("S3_USE_SSL")
        ? env.get("S3_USE_SSL") === "true"
        : undefined,
      accessKey: env.require("S3_ACCESS_KEY"),
      secretKey: env.require("S3_SECRET_KEY"),
      region: env.get("S3_REGION"),
    },
  };

  return new S3Storage(storageOptions);
}

export default class S3Storage {
  private minioClient: Minio.Client;
  private bucket: string;
  private storageBaseURL: string;
  private basePath?: string;
  private defaultAcl?: string;

  constructor(options: S3StorageOptions) {
    this.minioClient = new Minio.Client(options.storage);
    this.bucket = options.bucket;
    this.basePath = options.basePath;
    this.storageBaseURL = options.storageBaseURL;
    this.defaultAcl = options.defaultAcl;
  }

  async exists(filename: string): Promise<boolean> {
    const filePath = this.makeFilePath(filename);
    debugLog("exists", filePath);
    return Boolean(
      await this.minioClient
        .statObject(this.bucket, filePath)
        .catch(() => false)
    );
  }

  async upload(buffer: Buffer, filename: string): Promise<UploadResponse> {
    const filePath = this.makeFilePath(filename);

    debugLog("uploading file", filePath);

    const metaData = {
      "Content-Type": EXTENSION_TO_MIME_TYPE[path.extname(filename).slice(1)],
      "Cache-Control": "max-age=86400",
      ...(this.defaultAcl ? {"x-amz-acl": this.defaultAcl} : {})
    };

    const [data, hash] = await Promise.all([
      this.minioClient.putObject(
        this.bucket,
        filePath,
        buffer,
        buffer.length,
        metaData
      ),
      this.getHash(buffer),
    ]);

    return {
      ...data,
      url: this.makeFileURL(filePath),
      hash,
    };
  }

  makeFilePath(filename: string) {
    const basePath = this.basePath || "";
    return path.join(basePath.replace("^/", ""), filename);
  }

  private makeFileURL(filePath: string) {
    return urljoin(this.storageBaseURL, filePath);
  }

  async download(
    url: string,
    options?: { progress?: (size: number) => void }
  ): Promise<Buffer> {
    debugLog("downloading file", url);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to fetch file");
    }
    return response.readable().then((stream) => {
      return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => {
          chunks.push(chunk);
          const totalSize = chunks.reduce(
            (acc, chunk) => acc + chunk.length,
            0
          );
          if (options?.progress) {
            try {
              options.progress(totalSize);
            } catch (err) {
              reject(err);
            }
          }
        });
        stream.on("end", () => resolve(Buffer.concat(chunks as never)));
        stream.on("error", reject);
      });
    });
  }

  getFilenameFromURL(url: string): string | null {
    const baseStorageURL = new URL(this.basePath || "", this.storageBaseURL)
      .href;

    if (!url.startsWith(baseStorageURL)) {
      return null;
    }

    return url.slice(baseStorageURL.length).replace(/^\//, "");
  }

  async delete(filename: string): Promise<void> {
    const filePath = this.makeFilePath(filename);
    debugLog("deleting file", filePath);
    await this.minioClient.removeObject(this.bucket, filePath);
  }

  async rename(
    oldFilename: string,
    newFilename: string
  ): Promise<{ url: string }> {
    const oldFilePath = this.makeFilePath(oldFilename);
    const newFilePath = this.makeFilePath(newFilename);
    debugLog("renaming file", this.bucket, oldFilePath, newFilePath);

    await this.minioClient.copyObject(
      this.bucket,
      newFilePath,
      `/${this.bucket}/${oldFilePath}`,
      // @ts-ignore https://github.com/minio/minio-js/issues/1097
      null
    );
    await this.delete(oldFilename);
    return {
      url: this.makeFileURL(newFilePath),
    };
  }

  async getHash(buffer: Buffer): Promise<string> {
    return hasha.async(buffer, { algorithm: "md5" });
  }
}

function urljoin(...parts: string[]) {
  return parts
    .map((part) => part.replace(/(^\/|\/$)/g, ""))
    .filter(Boolean)
    .join("/");
}
