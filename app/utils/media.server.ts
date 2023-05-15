import { payloadTooLarge } from "./request.server";
import bytes from "bytes";
import { storage } from "./s3-storage.server";
import { getColor } from "colorthief";
import Jimp from "jimp";
import { debug } from "debug";
import type { Media } from "@prisma/client";
import { db } from "./db.server";
const log = debug("app:media-helpers");

const MAX_FILE_SIZE = bytes("10MB");

type UploadOutput = {
  url: string;
  size: number;
  hash: string;
};

export async function storeURL(
  originalURL: string,
  filename: string
): Promise<UploadOutput> {
  const buffer = await storage().download(originalURL, {
    progress(size) {
      if (size > MAX_FILE_SIZE) {
        throw payloadTooLarge({
          formError: `File size is too large (max ${bytes(MAX_FILE_SIZE)})`,
        });
      }
    },
  });

  const exists = await storage().exists(filename);

  if (exists) {
    throw new Error("File already exists");
  }

  const { url, hash } = await storage().upload(buffer, filename);

  return { url, size: buffer.length, hash };
}

export async function storeBuffer(
  buffer: Buffer,
  filename: string
): Promise<UploadOutput> {
  const exists = await storage().exists(filename);

  if (exists) {
    throw new Error("File already exists");
  }

  const { url, hash } = await storage().upload(buffer, filename);
  return { url, size: buffer.length, hash };
}

type ImageData = {
  color: string | null;
  width: number;
  height: number;
  thumbnail: Buffer;
};

export async function getImageData(url: string): Promise<ImageData> {
  const image = await Jimp.read(url);
  const { width, height } = image.bitmap;

  const thumbnail = await image
    .resize(500, Jimp.AUTO)
    .quality(80)
    .getBufferAsync(Jimp.MIME_JPEG);

  return {
    color: await getPrimaryColor(url),
    width,
    height,
    thumbnail,
  };
}

export async function reparse(media: Media) {
  const filename = storage().getFilenameFromURL(media.url);

  if (!filename) {
    return media;
  }

  const buffer = await storage().download(media.url);

  const { width, height, color, thumbnail } = await getImageData(media.url);

  const { url: thumbnailUrl } = await storage().upload(
    thumbnail,
    makeThumbnailFilename(filename)
  );

  let fileHash = media.fileHash;
  if (!fileHash) {
    fileHash = await storage().getHash(buffer);
  }

  return {
    width,
    height,
    color,
    thumbnailUrl,
    size: buffer.length,
    fileHash,
  };
}

export async function getPrimaryColor(url: string): Promise<string | null> {
  try {
    const color: [number, number, number] = await getColor(url);
    return `#${color.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  } catch (e) {
    log("Failed to get primary color", e);
    return null;
  }
}

export async function deleteURL(url: string | null) {
  if (!url) {
    return;
  }
  const filename = storage().getFilenameFromURL(url);
  if (!filename) {
    return;
  }
  await storage().delete(filename);
}

export async function rename(
  media: Pick<Media, "url" | "thumbnailUrl">,
  newFilename: string
) {
  const filename = storage().getFilenameFromURL(media.url);
  if (!filename) {
    return null;
  }
  const requests = [storage().rename(filename, newFilename)];

  const thumbnailFilename = storage().getFilenameFromURL(
    media.thumbnailUrl || ""
  );
  if (thumbnailFilename) {
    requests.push(
      storage().rename(thumbnailFilename, makeThumbnailFilename(newFilename))
    );
  }

  const [urlResp, thumbnailResp] = await Promise.all(requests);

  return {
    url: urlResp.url,
    thumbnailUrl: thumbnailResp?.url || null,
  };
}

export function makeThumbnailFilename(filename: string) {
  return `${filename.split(".")[0]}-thumbnail.jpg`;
}

type TermsOptions = {
  limit?: number;
  filter?: (term: [string, number]) => boolean;
  randomize?: boolean;
};

export function getCommonLabelsTerms(
  media: Pick<Media, "labels">[],
  { limit = 5, filter = () => true, randomize = false }: TermsOptions
) {
  const terms = media.reduce((terms, m) => {
    m.labels?.split(",").forEach((c) => {
      const term = c.trim().toLowerCase();
      terms[term] = (terms[term] || 0) + 1;
    });
    return terms;
  }, {} as Record<string, number>);

  return Object.entries(terms)
    .filter(([term, count]) => count > 1 && term && filter([term, count]))
    .sort((a, b) => {
      if (randomize) {
        return Math.random() - 0.5;
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit);
}

export async function getMediaLabels(
  options?: TermsOptions & { userId?: string | { not: string } }
) {
  const { userId, ...termsOptions } = options || {};
  const where = userId ? { userId } : {};
  const media = await db.media.findMany({
    where: {
      ...where,
      OR: [{ labels: { not: null } }, { labels: { not: "" } }],
    },
    select: {
      labels: true,
    },
  });

  return getCommonLabelsTerms(media, termsOptions);
}
