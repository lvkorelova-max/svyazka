import { AttributionSource, OrderStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ListFinanceQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  offerId?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  orderStatus?: OrderStatus;

  @IsOptional()
  @IsEnum(AttributionSource)
  attributionSource?: AttributionSource;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @IsOptional()
  @IsIn(['orderDate', 'amountKopecks', 'createdAt'])
  sortBy: 'orderDate' | 'amountKopecks' | 'createdAt' = 'orderDate';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'desc';
}

export class CreatorAnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  offerId?: string;

  @IsOptional()
  @IsUUID()
  creatorId?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  orderStatus?: OrderStatus;

  @IsOptional()
  @IsEnum(AttributionSource)
  attributionSource?: AttributionSource;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @IsOptional()
  @IsIn([
    'creatorName',
    'clicksCount',
    'ordersCount',
    'paidOrdersCount',
    'grossSalesKopecks',
    'netSalesKopecks',
    'creatorCommissionKopecks',
    'platformCommissionKopecks',
    'averageOrderValueKopecks',
    'conversionRate',
  ])
  sortBy:
    | 'creatorName'
    | 'clicksCount'
    | 'ordersCount'
    | 'paidOrdersCount'
    | 'grossSalesKopecks'
    | 'netSalesKopecks'
    | 'creatorCommissionKopecks'
    | 'platformCommissionKopecks'
    | 'averageOrderValueKopecks'
    | 'conversionRate' = 'netSalesKopecks';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'desc';
}
