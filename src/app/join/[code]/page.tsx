import { Suspense } from "react";

import JoinGameForm from "./join-form";

export default function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="auth-page">
          <section className="auth-card">
            Chargement de la partie...
          </section>
        </main>
      }
    >
      <JoinPageContent params={params} />
    </Suspense>
  );
}

async function JoinPageContent({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  return <JoinGameForm initialCode={code.toUpperCase()} />;
}