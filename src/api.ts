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
  UserType,
  LoginType,
  Login,
} from './api.types';
import { errorHandler } from './error-handler';
import createHttpError from 'http-errors';
import { getImageData } from './image-service';
import ms from 'ms';

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
    async (request, reply) => {
      const { search } = request.query;
      const where: Prisma.AssetWhereInput = {};
      if (search) {
        where.comment = { contains: search.trim() };
      }
      reply.header('Cache-Control', 'private, max-age=60');
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

  app.post<{
    Reply: AssetType;
    Params: UpdateParamsType;
  }>(
    '/assets/:id/parse',
    { schema: { params: UpdateParams } },
    async (request, reply) => {
      const asset = await app.db.asset.findUnique({
        where: { id: request.params.id },
      });
      if (!asset) throw createHttpError.NotFound();
      try {
        const imageData = await getImageData(asset.url);
        const updatedAsset = await app.db.asset.update({
          where: { id: request.params.id },
          data: imageData,
        });
        return updatedAsset;
      } catch (error) {
        request.log.error(error, "Couldn't parse image");
        return asset;
      }
    }
  );

  app.post<{
    Reply: UserType;
  }>('/users', async (request, reply) => {
    const user = await app.db.user.create({ data: {} });
    reply.status(201);
    request.session.set('userId', user.id);
    request.session.options({ maxAge: ms('1 day') / 1000 });
    return user;
  });

  app.post<{
    Body: LoginType;
  }>('/login', { schema: { body: Login } }, async (request, reply) => {
    const user = await app.db.user.findUnique({
      where: { account: request.body.account },
    });
    if (!user) throw createHttpError.NotFound();

    request.session.set('userId', user.id);
    request.session.options({ maxAge: ms('1 day') / 1000 });

    return {
      message: 'Logged in',
    };
  });

  app.setErrorHandler(errorHandler);

  app.addHook('onError', async (request, reply, error: FastifyError) => {
    if (!error.statusCode || error.statusCode >= 500) {
      request.log.error(error, error.message);
    }
  });
}
