import { SupportCaseView } from '../../../../features/support/support-case-view';

export default async function StaffSupportCasePage({
  params,
}: PageProps<'/staff/support/[caseNumber]'>) {
  const { caseNumber } = await params;
  return <SupportCaseView basePath="/staff/support" caseNumber={caseNumber} mode="staff" />;
}
