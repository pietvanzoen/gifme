import { Prisma, PrismaClient } from '@prisma/client';
import { FastifyError, FastifyInstance } from 'fastify';
import {
  AssetCreate,
  AssetCreateType,
  AssetSearch,
  AssetSearchType,
  AssetType,
  AssetUpdate,
  AssetUpdateType,
  UpdateParams,
  UpdateParamsType,
  Upload,
  UploadResponseType,
  UploadType,
} from './api.types';
import { errorHandler } from './error-handler';
import createHttpError from 'http-errors';

export default async function api(app: FastifyInstance) {
  app.post<{ Body: AssetCreateType; Reply: AssetType }>(
    '/assets',
    { schema: { body: AssetCreate } },
    async (request, reply) => {
      const asset = await app.db.asset.create({
        data: request.body,
      });

      reply.status(201);

      return asset;
    }
  );

  app.post<{
    Body: AssetUpdateType;
    Params: UpdateParamsType;
    Reply: AssetType;
  }>(
    '/assets/:id',
    { schema: { params: UpdateParams, body: AssetUpdate } },
    async (request, reply) => {
      const asset = await app.db.asset.update({
        where: { id: request.params.id },
        data: request.body,
      });

      reply.status(200);

      return asset;
    }
  );

  app.get<{
    Params: UpdateParamsType;
    Reply: AssetType;
  }>('/assets/:id', { schema: { params: UpdateParams } }, async (request) => {
    const asset = await app.db.asset.findUnique({
      where: { id: request.params.id },
    });
    if (!asset) throw createHttpError.NotFound();

    return asset;
  });

  app.get<{ Reply: AssetType[]; Querystring: AssetSearchType }>(
    '/assets',
    { schema: { querystring: AssetSearch } },
    async (request) => {
      const { search } = request.query;
      const where: Prisma.AssetWhereInput = {};
      if (search) {
        where.comment = { contains: search.trim() };
      }
      return app.db.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    }
  );

  app.delete<{
    Params: UpdateParamsType;
    Reply: null;
  }>(
    '/assets/:id',
    { schema: { params: UpdateParams } },
    async (request, reply) => {
      const asset = await app.db.asset.delete({
        where: { id: request.params.id },
      });
      if (!asset) throw createHttpError.NotFound();

      reply.status(204);
      return null;
    }
  );

  app.post<{ Body: UploadType; Reply: UploadResponseType }>(
    '/upload',
    { schema: { body: Upload } },
    async (request, reply) => {
      if (await app.storage.exists(request.body.filename)) {
        throw createHttpError.Conflict(
          `File with name "${request.body.filename}" already exists`
        );
      }
      return app.storage.uploadURL(request.body.url, request.body.filename);
    }
  );

  app.setErrorHandler(errorHandler);

  app.addHook('onError', async (request, reply, error: FastifyError) => {
    if (!error.statusCode || error.statusCode >= 500) {
      request.log.error(error, error.message);
    }
  });
}
