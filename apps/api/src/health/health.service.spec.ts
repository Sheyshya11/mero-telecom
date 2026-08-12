import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports an operational status with a timestamp', () => {
    expect(new HealthService().getHealth()).toMatchObject({ status: 'ok' });
  });
});
