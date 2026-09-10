import { SupportCaseView } from '../../../../features/support/support-case-view';

export default async function CustomerSupportCasePage({
  params,
}: PageProps<'/customer/support/[caseNumber]'>) {
  const { caseNumber } = await params;
  return <SupportCaseView basePath="/customer/support" caseNumber={caseNumber} mode="customer" />;
}
