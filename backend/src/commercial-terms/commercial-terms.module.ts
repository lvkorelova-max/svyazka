import { Global, Module } from '@nestjs/common';
import { CommercialTermsService } from './commercial-terms.service';

@Global()
@Module({
  providers: [CommercialTermsService],
  exports: [CommercialTermsService],
})
export class CommercialTermsModule {}
