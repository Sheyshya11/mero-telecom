import { assertNonProductionDatabaseCommand } from './database-command-safety';

describe('database command safety', () => {
  it('blocks demo seed and reset commands in production', () => {
    expect(() => assertNonProductionDatabaseCommand('production', 'Demo seed')).toThrow(
      'Demo seed is allowed only when NODE_ENV is development or test.',
    );
    expect(() => assertNonProductionDatabaseCommand('production', 'Database reset')).toThrow(
      'Database reset is allowed only when NODE_ENV is development or test.',
    );
    expect(() => assertNonProductionDatabaseCommand(undefined, 'Database reset')).toThrow();
  });

  it('allows development and test environments', () => {
    expect(() => assertNonProductionDatabaseCommand('development', 'Demo seed')).not.toThrow();
    expect(() => assertNonProductionDatabaseCommand('test', 'Database reset')).not.toThrow();
  });
});
