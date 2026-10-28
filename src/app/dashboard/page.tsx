import { redirect } from "next/navigation";
import {
  CalendarDays,
  CircleDot,
  Moon,
  ShieldCheck,
  Users,
} from "lucide-react";

import { getMasterUser } from "@/lib/auth/require-master";
import { createAdminClient } from "@/lib/supabase/admin";

import CreateGameForm from "./create-game-form";
import LogoutButton from "./logout-button";
import Link from "next/link";

import { Suspense } from "react";
import { connection } from "next/server";

import RegistrationManager from "./registration-manager";

const statusLabels: Record<string, string> = {
  lobby: "Inscriptions",
  role_distribution: "Distribution des rôles",
  cupidon_selection: "Cupidon",
  night_wolf_vote: "Nuit — Loups",
  night_witch_action: "Nuit — Sorcière",
  night_seer_action: "Nuit — Voyante",
  night_resolution: "Résolution nocturne",
  day_discussion: "Débat du village",
  village_vote_1: "Premier vote",
  village_vote_2: "Second vote",
  day_resolution: "Résolution du vote",
  paused: "En pause",
  game_over: "Terminée",
};

async function DashboardContent() {
  await connection();

  const master = await getMasterUser();

  if (!master) {
    redirect("/login");
  }

  const admin = createAdminClient();

  const { data: games, error } = await admin
    .from("games")
    .select(
      "id, name, invite_code, status, round_number, created_at, started_at, ended_at"
    )
    .eq("master_id", master.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Chargement du dashboard impossible:", error.message);
  }

  const gameList = games ?? [];
  const ongoingGames = gameList.filter(
    (game) => game.status !== "game_over"
  ).length;

  return (
    <main className="site-shell dashboard-shell">
      <header className="site-header">
        <div className="container header-inner">
          <Link href="/" className="brand">
            <span className="brand-mark">
              <Moon />
            </span>
            <span>NOCTURNE</span>
          </Link>

          <div className="dashboard-header-actions">
            <span className="dashboard-master-label">
              <ShieldCheck size={16} />
              Maître du jeu
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <section className="container dashboard-main">
        <div className="dashboard-welcome">
          <div>
            <p className="section-kicker">ESPACE PRIVÉ</p>
            <h1 className="dashboard-title">
              Le village t&apos;attend.
            </h1>
            <p className="hero-description">
              Organise tes parties, prépare les inscriptions et garde le
              contrôle du jeu depuis un seul endroit.
            </p>
          </div>

          <div className="dashboard-date">
            <CalendarDays size={18} />
            <span>{gameList.length} partie(s) créée(s)</span>
          </div>
        </div>

        <div className="dashboard-stats">
          <article className="dashboard-stat-card">
            <div className="dashboard-stat-icon">
              <Users size={20} />
            </div>
            <span>Parties enregistrées</span>
            <strong>{gameList.length}</strong>
          </article>

          <article className="dashboard-stat-card">
            <div className="dashboard-stat-icon">
              <CircleDot size={20} />
            </div>
            <span>Parties non terminées</span>
            <strong>{ongoingGames}</strong>
          </article>

          <article className="dashboard-stat-card">
            <div className="dashboard-stat-icon">
              <ShieldCheck size={20} />
            </div>
            <span>Compte</span>
            <strong className="dashboard-account-status">Autorisé</strong>
          </article>
        </div>

        <div className="dashboard-content-grid">
          <CreateGameForm />

          <section className="dashboard-panel dashboard-guidance">
            <p className="section-kicker">À SAVOIR</p>
            <h2>Une partie bien préparée</h2>

            <p>
              Chaque partie possède son propre code, ses participants, ses
              rôles et son classement final.
            </p>

            <p>
              Les résultats validés ne pourront pas être modifiés.
              Le moteur de jeu appliquera automatiquement les règles
              configurées.
            </p>
          </section>
        </div>

        <RegistrationManager />

        <section className="dashboard-panel dashboard-games">
          <div className="dashboard-panel-heading">
            <div>
              <p className="section-kicker">HISTORIQUE</p>
              <h2>Mes parties</h2>
            </div>

            <span className="dashboard-count">{gameList.length}</span>
          </div>

          {error ? (
            <p className="auth-error">
              Le chargement des parties a échoué. Vérifie la configuration
              Supabase et les journaux du serveur.
            </p>
          ) : gameList.length === 0 ? (
            <div className="dashboard-empty">
              <div className="dashboard-empty-icon">
                <Moon size={25} />
              </div>

              <h3>La première nuit n&apos;a pas encore commencé.</h3>

              <p>
                Crée ta première partie pour générer son code d&apos;accès et
                préparer l&apos;arrivée des joueurs.
              </p>
            </div>
          ) : (
            <div className="game-list">
              {gameList.map((game) => (
                <Link 
                    href={`/dashboard/games/${game.id}`} 
                    className="game-list-item" 
                    key={game.id}
                    aria-label={`Gérer la partie ${game.name}`}
                >
                  <div className="game-list-icon">
                    <Moon size={21} />
                  </div>

                  <div className="game-list-info">
                    <h3>{game.name}</h3>

                    <p>
                      Créée le{" "}
                      {new Date(game.created_at).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>

                    <span className="game-list-code">
                      Code : {game.invite_code}
                    </span>
                  </div>

                  <div className="game-list-status">
                    <span
                      className={
                        game.status === "game_over"
                          ? "game-status completed"
                          : "game-status"
                      }
                    >
                      {statusLabels[game.status] ?? game.status}
                    </span>
                    <span className="dashboard-muted">
                      {game.round_number > 0
                        ? `Manche ${game.round_number}`
                        : "Pas encore commencée"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="site-shell">
          <section className="container dashboard-main">
            <p>Chargement du dashboard...</p>
          </section>
        </main>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}