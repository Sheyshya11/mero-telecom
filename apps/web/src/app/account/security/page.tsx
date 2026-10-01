import { ChangePasswordForm } from '../../../features/account/change-password-form';

export default function AccountSecurityPage() {
  return (
    <main className="workspace-page mx-auto min-h-screen max-w-3xl px-6 py-10">
      <header className="border-b border-border pb-6">
        <p className="text-sm font-semibold tracking-wide text-primary">ACCOUNT SECURITY</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Security</h1>
        <p className="mt-2 text-muted-foreground">
          Keep your account secure by using a unique password you do not use anywhere else.
        </p>
      </header>
      <section className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 border-b border-border/70 pb-5">
          <h2 className="text-xl font-bold tracking-tight">Change password</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your current device will stay signed in. Other active sessions will be signed out.
          </p>
        </div>
        <ChangePasswordForm />
      </section>
    </main>
  );
}
