import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface BrandContextRequest {
  activeBrandId?: string;
}

export const ActiveBrandId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest<BrandContextRequest>().activeBrandId as string,
);
