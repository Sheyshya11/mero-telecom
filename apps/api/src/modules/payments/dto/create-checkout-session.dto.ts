import { IsUUID } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsUUID()
  invoiceId!: string;
}
