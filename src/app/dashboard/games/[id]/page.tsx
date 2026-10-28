import { Suspense } from "react";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Moon, ShieldCheck } from "lucide-react";

import { getMasterUser } from "@/lib/auth/require-master";
import { createAdminClient } from "@/lib/supabase/admin";
import RoleSetupForm from "./role-setup-form";

const statusLabels: Record<string, string> = {
  lobby: "Inscriptions ouvertes",
  role_distribution: "Distribution des rôles",
  cupidon_selection: "Sélection de Cupidon",
  night_wolf_vote: "Nuit — Loups",
  night_witch_action: "Nuit — Sorcière",
  night_seer_action: "Nuit — Voyante",
  night_resolution: "Résolution de la nuit",
  day_discussion: "Débat du village",
  village_vote_1: "Premier scrutin",
  village_vote_2: "Second scrutin",
  day_resolution: "Résolution du vote",
  paused: "En pause",
  game_over: "Terminée",
};

export default function GameSetupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="container dashboard-main">
          <p>Chargement de la partie...</p>
        </main>
      }
    >
      <GameSetupContent params={params} />
    </Suspense>
  );
}

async function GameSetupContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Cette page dépend de la session et des données actuelles.
  await connection();

  const { id } = await params;
  const master = await getMasterUser();

  if (!master) {
    redirect("/login");
  }

  const admin = createAdminClient();

  const { data: game, error: gameError } = await admin
    .from("games")
    .select(
      "id, name, invite_code, status, round_number, created_at, started_at"
    )
    .eq("id", id)
    .eq("master_id", master.id)
    .maybeSingle();

  if (gameError) {
    console.error("Chargement de la partie impossible:", gameError.message);
    throw new Error("Impossible de charger la partie.");
  }

  if (!game) {
    notFound();
  }

  const [
    { count: approvedPlayers, error: approvedError },
    { count: pendingPlayers, error: pendingError },
  ] = await Promise.all([
    admin
      .from("game_players")
      .select("id", { count: "exact", head: true })
      .eq("game_id", game.id)
      .eq("registration_status", "approved"),

    admin
      .from("game_players")
      .select("id", { count: "exact", head: true })
      .eq("game_id", game.id)
      .eq("registration_status", "pending"),
  ]);

  if (approvedError || pendingError) {
    console.error("Chargement des effectifs impossible:", {
      approvedError,
      pendingError,
    });

    throw new Error("Impossible de charger les joueurs de la partie.");
  }

  const inviteUrl = `/join/${game.invite_code}`;
  const isLobby = game.status === "lobby";

  return (
    <main className="site-shell">
      <header className="site-header">
        <div className="container header-inner">
          <Link href="/dashboard" className="brand">
            <span className="brand-mark">
              <Moon />
            </span>
            <span>NOCTURNE</span>
          </Link>

          <Link href="/dashboard" className="header-action">
            <ArrowLeft size={16} />
            Retour au dashboard
          </Link>
        </div>
      </header>

      <section className="container dashboard-main">
        <div className="game-detail-heading">
          <div>
            <p className="section-kicker">GESTION DE LA PARTIE</p>
            <h1 className="dashboard-title">{game.name}</h1>
            <p className="hero-description">
              Configure les rôles et prépare le lancement de la partie.
            </p>
          </div>

          <span className="game-status">
            {statusLabels[game.status] ?? game.status}
          </span>
        </div>

        <div className="dashboard-stats">
          <article className="dashboard-stat-card">
            <div className="dashboard-stat-icon">
              <ShieldCheck size={20} />
            </div>
            <span>Joueurs validés</span>
            <strong>{approvedPlayers ?? 0}</strong>
          </article>

          <article className="dashboard-stat-card">
            <div className="dashboard-stat-icon">
              <Moon size={20} />
            </div>
            <span>En attente de validation</span>
            <strong>{pendingPlayers ?? 0}</strong>
          </article>

          <article className="dashboard-stat-card">
            <div className="dashboard-stat-icon">
              <ShieldCheck size={20} />
            </div>
            <span>Code de la partie</span>
            <strong className="game-detail-code">
              {game.invite_code}
            </strong>
          </article>
        </div>

        <div className="dashboard-content-grid game-detail-grid">
          {isLobby ? (
            <RoleSetupForm
              gameId={game.id}
              gameName={game.name}
              approvedPlayers={approvedPlayers ?? 0}
            />
          ) : (
            <section className="dashboard-panel">
              <p className="section-kicker">PARTIE EN COURS</p>
              <h2>La configuration initiale est terminée.</h2>
              <p className="role-setup-description">
                Statut actuel : {statusLabels[game.status] ?? game.status}.
                La configuration des rôles ne peut plus être modifiée depuis
                cet écran.
              </p>
              <p className="dashboard-muted">
                La prochaine étape de notre développement permettra de gérer
                les phases du jeu et les actions de chaque rôle.
              </p>
            </section>
          )}

          <section className="dashboard-panel">
            <p className="section-kicker">INVITATION</p>
            <h2>Faire rejoindre les joueurs</h2>
            <p className="role-setup-description">
              Partage ce lien dans ton groupe WhatsApp. Les joueurs devront
              soumettre leur prénom, puis attendre ta validation.
            </p>

            <div className="join-code-display">
              <span>CODE D&apos;ACCÈS</span>
              <strong>{game.invite_code}</strong>
            </div>

            <Link href={inviteUrl} className="btn btn-secondary game-preview-link">
              Ouvrir le formulaire d&apos;inscription
            </Link>

            <p className="dashboard-muted">
              Ce lien est relatif à l&apos;application. Après le déploiement,
              tu pourras partager le lien public complet dans WhatsApp.
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}