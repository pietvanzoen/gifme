import { PassThrough } from "stream";
import type { S3StorageOptions } from "./s3-storage.server";
import S3Storage from "./s3-storage.server";
import type { Response } from "fetch-h2";
import { fetch } from "fetch-h2";
import * as Minio from "minio";

jest.mock("minio");
jest.mock("fetch-h2");

describe("S3Storage", () => {
  let storageOptions: S3StorageOptions;
  let fileStorage: S3Storage;

  beforeEach(() => {
    jest.resetAllMocks();

    (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      readable: jest.fn().mockResolvedValue(new PassThrough()),
    } as unknown as Response);

    Minio.Client.prototype.putObject = jest.fn().mockResolvedValue({
      etag: "test-etag",
      versionId: "test-version-id",
    });

    storageOptions = {
      bucket: "test-bucket",
      storageBaseURL: "https://test-bucket.s3.amazonaws.com",
      basePath: "test-base-path",
      defaultAcl: "fake-acl",
      storage: {
        endPoint: "s3.amazonaws.com",
        useSSL: true,
        accessKey: "test-access-key",
        secretKey: "test-secret-key",
      },
    };
    fileStorage = new S3Storage(storageOptions);
  });

  describe("upload", () => {
    let buffer: Buffer;
    let filename: string;

    beforeEach(() => {
      fileStorage.getHash = jest.fn().mockReturnValue("test-hash");
      buffer = Buffer.from("test");
      filename = "test.jpg";
    });

    it("uploads a file", async () => {
      const uploadResponse = await fileStorage.upload(buffer, filename);
      expect(uploadResponse).toEqual({
        url: "https://test-bucket.s3.amazonaws.com/test-base-path/test.jpg",
        etag: "test-etag",
        versionId: "test-version-id",
        hash: "test-hash",
      });
    });

    it("allows single directory in filename", async () => {
      const filename = "test/test.jpg";
      await fileStorage.upload(buffer, filename);
      expect(Minio.Client.prototype.putObject).toHaveBeenCalledWith(
        "test-bucket",
        "test-base-path/test/test.jpg",
        buffer,
        buffer.length,
        {
          "Content-Type": "image/jpeg",
          "Cache-Control": "max-age=86400",
          "x-amz-acl": "fake-acl"
        }
      );
    });

    it("sets metaData", async () => {
      await fileStorage.upload(buffer, filename);
      expect(Minio.Client.prototype.putObject).toHaveBeenCalledWith(
        "test-bucket",
        "test-base-path/test.jpg",
        buffer,
        buffer.length,
        {
          "Content-Type": "image/jpeg",
          "Cache-Control": "max-age=86400",
          "x-amz-acl": "fake-acl"
        }
      );
    });
  });

  describe("getFilenameFromURL", () => {
    it("returns the filename from a URL", () => {
      const url =
        "https://test-bucket.s3.amazonaws.com/test-base-path/test.jpg";
      expect(fileStorage.getFilenameFromURL(url)).toBe("test.jpg");
    });

    it("returns null if the URL is not valid", () => {
      const url = "https://test-bucket.s3.amazonaws.com/test.jpg";
      expect(fileStorage.getFilenameFromURL(url)).toBeNull();
    });

    it("works when basePath is empty", () => {
      fileStorage = new S3Storage({
        ...storageOptions,
        basePath: "",
      });
      const url = "https://test-bucket.s3.amazonaws.com/test.jpg";
      expect(fileStorage.getFilenameFromURL(url)).toBe("test.jpg");
    });
  });


  describe("ACL options", () => {

    let buffer: Buffer;
    let filename: string;

    beforeEach(() => {
      fileStorage.getHash = jest.fn().mockReturnValue("test-hash");
      buffer = Buffer.from("test");
      filename = "test.jpg";
    });


    it("sets metaData with ACL", async () => {
      storageOptions = {
        bucket: "test-bucket",
        storageBaseURL: "https://test-bucket.s3.amazonaws.com",
        basePath: "test-base-path",
        defaultAcl: "fake-acl-foobar",
        storage: {
          endPoint: "s3.amazonaws.com",
          useSSL: true,
          accessKey: "test-access-key",
          secretKey: "test-secret-key",
        },
      };
      fileStorage = new S3Storage(storageOptions);

      await fileStorage.upload(buffer, filename);
      expect(Minio.Client.prototype.putObject).toHaveBeenCalledWith(
        "test-bucket",
        "test-base-path/test.jpg",
        buffer,
        buffer.length,
        {
          "Content-Type": "image/jpeg",
          "Cache-Control": "max-age=86400",
          "x-amz-acl": "fake-acl-foobar"
        }
      );
    });

    it("sets metaData without ACL", async () => {
      storageOptions = {
        bucket: "test-bucket",
        storageBaseURL: "https://test-bucket.s3.amazonaws.com",
        basePath: "test-base-path",
        defaultAcl: undefined,
        storage: {
          endPoint: "s3.amazonaws.com",
          useSSL: true,
          accessKey: "test-access-key",
          secretKey: "test-secret-key",
        },
      };
      fileStorage = new S3Storage(storageOptions);

      await fileStorage.upload(buffer, filename);
      expect(Minio.Client.prototype.putObject).toHaveBeenCalledWith(
        "test-bucket",
        "test-base-path/test.jpg",
        buffer,
        buffer.length,
        {
          "Content-Type": "image/jpeg",
          "Cache-Control": "max-age=86400"
        }
      );
    });
  });

  describe("delete", () => {
    let filename: string;

    beforeEach(() => {
      filename = "test.jpg";
    });

    it("deletes a file", async () => {
      await fileStorage.delete(filename);
      expect(Minio.Client.prototype.removeObject).toHaveBeenCalledWith(
        "test-bucket",
        "test-base-path/test.jpg"
      );
    });
  });
});
