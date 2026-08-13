import { SetMetadata } from '@nestjs/common';

import { CUSTOMER_OWNERSHIP_PARAM_KEY } from '../constants/authorization.constants';

export const CustomerOwnership = (parameterName = 'customerId') =>
  SetMetadata(CUSTOMER_OWNERSHIP_PARAM_KEY, parameterName);
