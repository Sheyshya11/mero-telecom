export function assertNonProductionDatabaseCommand(
  environment: string | undefined,
  commandName: string,
): void {
  if (environment !== 'development' && environment !== 'test') {
    throw new Error(`${commandName} is allowed only when NODE_ENV is development or test.`);
  }
}
