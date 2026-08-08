import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { AdminSecurityGuard } from '../common/guards/admin-security.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTokenGuard } from '../common/guards/access-token.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CancelPayoutDto, CreatePayoutDto } from './dto/create-payout.dto';
import {
  CreatorAnalyticsQueryDto,
  ListFinanceQueryDto,
} from './dto/list-finance-query.dto';
import { FinanceService } from './finance.service';
import { Body } from '@nestjs/common';
import {
  IssueBrandStatementDto,
  OpenFinancialDisputeDto,
  RecordBrandPaymentDto,
  ResolveFinancialDisputeDto,
} from './dto/settlement.dto';

type CsvUpload = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

@Controller()
@UseGuards(AccessTokenGuard, RolesGuard)
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    config: ConfigService,
  ) {
    this.maxUploadBytes = Number(config.get<string>('ORDER_IMPORT_MAX_BYTES') ?? 10_485_760);
  }

  private readonly maxUploadBytes: number;

  @Post('brand/order-imports')
  @Roles(UserRole.BRAND)
  @RateLimit({ scope: 'csv-upload', limit: 100, windowSeconds: 3600 })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10_485_760, files: 1 },
    }),
  )
  createOrderImport(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: CsvUpload,
  ) {
    return this.finance.createOrderImport(user.id, file, this.maxUploadBytes);
  }

  @Get('brand/order-imports/:id/preview')
  @Roles(UserRole.BRAND)
  getOrderImportPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.finance.getOrderImportPreview(user.id, id);
  }

  @Post('brand/order-imports/:id/confirm')
  @Roles(UserRole.BRAND)
  confirmOrderImport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.finance.confirmOrderImport(user.id, id);
  }

  @Get('brand/orders')
  @Roles(UserRole.BRAND)
  listBrandOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceQueryDto,
  ) {
    return this.finance.listBrandOrders(user.id, query);
  }

  @Get('brand/orders/:id')
  @Roles(UserRole.BRAND)
  getBrandOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.finance.getBrandOrder(user.id, id);
  }

  @Get('brand/commissions')
  @Roles(UserRole.BRAND)
  listBrandCommissions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceQueryDto,
  ) {
    return this.finance.listBrandCommissions(user.id, query);
  }

  @Get('brand/analytics')
  @Roles(UserRole.BRAND)
  getBrandAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceQueryDto,
  ) {
    return this.finance.getBrandAnalytics(user.id, query);
  }

  @Get('brand/finance/overview')
  @Roles(UserRole.BRAND)
  getBrandFinanceOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceQueryDto,
  ) {
    return this.finance.getBrandFinanceOverview(user.id, query);
  }

  @Get('brand/statements')
  @Roles(UserRole.BRAND)
  listBrandStatements(@CurrentUser() user: AuthenticatedUser) {
    return this.finance.listBrandStatements(user.id);
  }

  @Post('brand/disputes')
  @Roles(UserRole.BRAND)
  openDispute(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OpenFinancialDisputeDto,
  ) {
    return this.finance.openDispute(user.id, dto);
  }

  @Get('brand/analytics/creators')
  @Roles(UserRole.BRAND)
  getCreatorAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CreatorAnalyticsQueryDto,
  ) {
    return this.finance.getCreatorAnalytics(user.id, query);
  }

  @Get('creator/clicks')
  @Roles(UserRole.CREATOR)
  listCreatorClicks(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceQueryDto,
  ) {
    return this.finance.listCreatorClicks(user.id, query);
  }

  @Get('creator/orders')
  @Roles(UserRole.CREATOR)
  listCreatorOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceQueryDto,
  ) {
    return this.finance.listCreatorOrders(user.id, query);
  }

  @Get('creator/commissions')
  @Roles(UserRole.CREATOR)
  listCreatorCommissions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceQueryDto,
  ) {
    return this.finance.listCreatorCommissions(user.id, query);
  }

  @Get('creator/earnings-summary')
  @Roles(UserRole.CREATOR)
  getCreatorEarningsSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.finance.getCreatorEarningsSummary(user.id);
  }

  @Get('creator/payouts')
  @Roles(UserRole.CREATOR)
  listCreatorPayouts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFinanceQueryDto,
  ) {
    return this.finance.listCreatorPayouts(user.id, query);
  }

  @Get('admin/finance/overview')
  @Roles(UserRole.ADMIN)
  getAdminFinanceOverview() {
    return this.finance.getAdminFinanceOverview();
  }

  @Get('admin/statements')
  @Roles(UserRole.ADMIN)
  listAdminStatements() {
    return this.finance.listAdminStatements();
  }

  @Post('admin/statements')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  issueBrandStatement(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: IssueBrandStatementDto,
  ) {
    return this.finance.issueBrandStatement(user.id, dto);
  }

  @Post('admin/brand-payments')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  recordBrandPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordBrandPaymentDto,
  ) {
    return this.finance.recordBrandPayment(user.id, dto);
  }

  @Get('admin/brand-payments')
  @Roles(UserRole.ADMIN)
  listBrandPayments() {
    return this.finance.listAdminBrandPayments();
  }

  @Get('admin/disputes')
  @Roles(UserRole.ADMIN)
  listAdminDisputes() {
    return this.finance.listAdminDisputes();
  }

  @Post('admin/disputes/:id/resolve')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  resolveDispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveFinancialDisputeDto,
  ) {
    return this.finance.resolveDispute(user.id, id, dto);
  }

  @Post('admin/reconciliation/run')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  runReconciliation(@CurrentUser() user: AuthenticatedUser) {
    return this.finance.runReconciliation(user.id);
  }

  @Get('admin/commissions')
  @Roles(UserRole.ADMIN)
  listAdminCommissions(@Query() query: ListFinanceQueryDto) {
    return this.finance.listAdminCommissions(query);
  }

  @Get('admin/ledger-entries')
  @Roles(UserRole.ADMIN)
  listLedgerEntries(@Query() query: ListFinanceQueryDto) {
    return this.finance.listLedgerEntries(query);
  }

  @Get('admin/ledger-transactions')
  @Roles(UserRole.ADMIN)
  listLedgerTransactions(@Query() query: ListFinanceQueryDto) {
    return this.finance.listLedgerTransactions(query);
  }

  @Get('admin/payouts')
  @Roles(UserRole.ADMIN)
  listPayouts(@Query() query: ListFinanceQueryDto) {
    return this.finance.listPayouts(query);
  }

  @Post('admin/payouts')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  createPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePayoutDto,
  ) {
    return this.finance.createPayout(user.id, dto);
  }

  @Post('admin/payouts/:id/approve')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  approvePayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.finance.approvePayout(user.id, id);
  }

  @Post('admin/payouts/:id/mark-paid')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  markPayoutPaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.finance.markPayoutPaid(user.id, id);
  }

  @Post('admin/payouts/:id/cancel')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  cancelPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPayoutDto,
  ) {
    return this.finance.cancelPayout(user.id, id, dto.reason);
  }

  @Post('admin/commissions/release-hold')
  @Roles(UserRole.ADMIN)
  @UseGuards(AdminSecurityGuard)
  releaseHold(@CurrentUser() user: AuthenticatedUser) {
    return this.finance.releaseHold(user.id);
  }
}
