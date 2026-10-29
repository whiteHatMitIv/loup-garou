"use client";

import { useEffect, useState } from "react";

type OverviewPlayer = {
  id: string;
  displayName: string;
  registrationStatus: string;
  lifeStatus: string | null;
  role: {
    key: string;
    display_name: string;
    camp: string;
    description: string | null;
  } | null;
  points: number;
};

type RankingPlayer = {
  id: string;
  displayName: string;
  role: string | null;
  points: number;
  rank: number;
};

type OverviewData = {
  game: {
    id: string;
    name: string;
    status: string;
    round_number: number;
    invite_code: string;
  };
  players: OverviewPlayer[];
  ranking: RankingPlayer[];
};

type Props = {
  gameId: string;
};

function registrationLabel(status: string) {
  switch (status) {
    case "approved":
      return "Validé";
    case "pending":
      return "En attente";
    case "rejected":
      return "Refusé";
    default:
      return status;
  }
}

function lifeLabel(status: string | null) {
  if (status === "alive") return "En vie";
  if (status === "dead") return "Éliminé";
  return "Pas encore défini";
}

function phaseLabel(status: string) {
  const labels: Record<string, string> = {
    lobby: "Inscriptions et préparation",
    cupidon_selection: "Cupidon choisit les amoureux",
    night_wolf_vote: "Vote des Loups-Garous",
    night_witch_action: "Action de la Sorcière",
    night_seer_action: "Vision de la Voyante",
    night_resolution: "Résolution de la nuit",
    finished: "Partie terminée",
    role_distribution: "Distribution des rôles",
    hunter_action: "Le Chasseur choisit sa cible",
    day_discussion: "Débat du village",
    village_vote_1: "Premier scrutin",
    village_vote_2: "Second scrutin",
    day_resolution: "Résolution du vote",
    paused: "Partie en pause",
    game_over: "Partie terminée",
  };

  return labels[status] ?? status.replaceAll("_", " ");
}

export default function GameOverview({ gameId }: Props) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadOverview() {
      try {
        const response = await fetch(
          `/api/master/games/${gameId}/overview`,
          { cache: "no-store" }
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error ?? "Chargement impossible.");
        }

        if (active) {
          setData(result as OverviewData);
          setError("");
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Impossible de charger le tableau de bord."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadOverview();

    const interval = setInterval(() => {
      void loadOverview();
    }, 8000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [gameId]);

  if (loading) {
    return (
      <section className="game-overview">
        <p>Chargement des joueurs et du classement…</p>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="game-overview">
        <h2>Tableau de bord indisponible</h2>
        <p className="game-overview-error">{error}</p>
      </section>
    );
  }

  if (!data) return null;

  const approvedCount = data.players.filter(
    (player) => player.registrationStatus === "approved"
  ).length;

  const pendingCount = data.players.filter(
    (player) => player.registrationStatus === "pending"
  ).length;

  return (
    <div className="game-overview">
      <section className="game-overview-section">
        <div className="game-overview-heading">
          <div>
            <p className="game-overview-eyebrow">ÉTAT DE LA PARTIE</p>
            <h2>{data.game.name}</h2>
          </div>

          <span className="game-overview-phase">
            {phaseLabel(data.game.status)}
          </span>
        </div>

        <div className="game-overview-stats">
          <div className="game-overview-stat">
            <span>Joueurs inscrits</span>
            <strong>{data.players.length}</strong>
          </div>

          <div className="game-overview-stat">
            <span>Joueurs validés</span>
            <strong>{approvedCount}</strong>
          </div>

          <div className="game-overview-stat">
            <span>En attente</span>
            <strong>{pendingCount}</strong>
          </div>

          <div className="game-overview-stat">
            <span>Manche</span>
            <strong>{data.game.round_number}</strong>
          </div>
        </div>
      </section>

      <section className="game-overview-section">
        <div className="game-overview-heading">
          <div>
            <p className="game-overview-eyebrow">PARTICIPANTS</p>
            <h2>Joueurs et statuts</h2>
          </div>
          <span>{data.players.length} joueur(s)</span>
        </div>

        {data.players.length === 0 ? (
          <p className="game-overview-empty">
            Aucun joueur inscrit pour le moment.
          </p>
        ) : (
          <div className="game-overview-table-wrap">
            <table className="game-overview-table">
              <thead>
                <tr>
                  <th>Joueur</th>
                  <th>Inscription</th>
                  <th>Rôle</th>
                  <th>Vie</th>
                  <th>Points</th>
                </tr>
              </thead>

              <tbody>
                {data.players.map((player) => (
                  <tr key={player.id}>
                    <td>
                      <strong>{player.displayName}</strong>
                    </td>

                    <td>
                      <span
                        className={`game-overview-status status-${player.registrationStatus}`}
                      >
                        {registrationLabel(player.registrationStatus)}
                      </span>
                    </td>

                    <td>
                      {player.role ? (
                        <span>
                          {player.role.display_name}
                          <small className="game-overview-camp">
                            {player.role.camp}
                          </small>
                        </span>
                      ) : (
                        "Non attribué"
                      )}
                    </td>

                    <td>{lifeLabel(player.lifeStatus)}</td>
                    <td>{player.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="game-overview-section">
        <div className="game-overview-heading">
          <div>
            <p className="game-overview-eyebrow">SCORES</p>
            <h2>Classement de la partie</h2>
          </div>
        </div>

        {data.ranking.length === 0 ? (
          <p className="game-overview-empty">
            Le classement apparaîtra lorsque des joueurs seront validés.
          </p>
        ) : (
          <div className="game-overview-ranking">
            {data.ranking.map((player) => (
              <div className="game-overview-ranking-row" key={player.id}>
                <span className="game-overview-rank">
                  {player.rank}
                </span>

                <div className="game-overview-ranking-player">
                  <strong>{player.displayName}</strong>
                  <span>{player.role ?? "Rôle non attribué"}</span>
                </div>

                <strong className="game-overview-points">
                  {player.points} pts
                </strong>
              </div>
            ))}
          </div>
        )}

        <p className="game-overview-note">
          Les scores affichés correspondent aux événements enregistrés pour
          cette partie. Le calcul automatique de tous les points de jeu reste
          à finaliser.
        </p>
      </section>

      {error && (
        <p className="game-overview-warning">
          Actualisation momentanément impossible : {error}
        </p>
      )}
    </div>
  );
}