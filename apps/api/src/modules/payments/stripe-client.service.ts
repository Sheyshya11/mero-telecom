import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

import type { AppConfig } from '../../config/configuration';

@Injectable()
export class StripeClientService {
  readonly client: Stripe;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.client = new Stripe(configService.getOrThrow('stripe').secretKey, {
      apiVersion: '2026-07-29.dahlia',
    });
  }
}
