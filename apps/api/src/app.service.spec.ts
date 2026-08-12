import { AppService } from './app.service';

describe('AppService', () => {
  it('returns the API foundation status', () => {
    expect(new AppService().getStatus()).toEqual({
      service: 'mero-telecom-api',
      status: 'running',
    });
  });
});
