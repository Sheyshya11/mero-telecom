import { NewInternalRequest } from '../../../../features/internal-requests/new-internal-request';

export default async function NewInternalRequestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const customerId = typeof query.customerId === 'string' ? query.customerId : '';
  const supportCase = typeof query.supportCase === 'string' ? query.supportCase : '';
  const subscriptionId = typeof query.subscriptionId === 'string' ? query.subscriptionId : '';
  const type = typeof query.type === 'string' ? query.type : '';
  const title = typeof query.title === 'string' ? query.title : '';
  return (
    <NewInternalRequest
      initialCustomerId={customerId}
      initialSupportCaseNumber={supportCase}
      initialSubscriptionId={subscriptionId}
      initialTitle={title}
      initialType={type}
    />
  );
}
