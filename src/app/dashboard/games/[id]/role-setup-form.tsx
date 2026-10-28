"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LoaderCircle,
  Moon,
  Swords,
  Eye,
  Heart,
  Cross,
  Users,
} from "lucide-react";

type RoleKey =
  | "villageois"
  | "loup_garou"
  | "voyante"
  | "sorciere"
  | "chasseur"
  | "cupidon";

type RoleCounts = Record<RoleKey, number>;

type RoleDefinition = {
  key: RoleKey;
  name: string;
  description: string;
  max: number;
  icon: typeof Moon;
};

const roleDefinitions: RoleDefinition[] = [
  {
    key: "villageois",
    name: "Villageois",
    description: "Débat et vote du village.",
    max: 100,
    icon: Users,
  },
  {
    key: "loup_garou",
    name: "Loup-Garou",
    description: "Vote nocturne collectif.",
    max: 100,
    icon: Swords,
  },
  {
    key: "voyante",
    name: "Voyante",
    description: "Inspecte un joueur pendant la nuit.",
    max: 1,
    icon: Eye,
  },
  {
    key: "sorciere",
    name: "Sorcière",
    description: "Potion de vie et potion de mort.",
    max: 1,
    icon: Moon,
  },
  {
    key: "chasseur",
    name: "Chasseur",
    description: "Peut éliminer une cible à sa mort.",
    max: 1,
    icon: Cross,
  },
  {
    key: "cupidon",
    name: "Cupidon",
    description: "Lie deux joueurs au début de la partie.",
    max: 1,
    icon: Heart,
  },
];

export default function RoleSetupForm({
  gameId,
  gameName,
  approvedPlayers,
}: {
  gameId: string;
  gameName: string;
  approvedPlayers: number;
}) {
  const router = useRouter();

  const [counts, setCounts] = useState<RoleCounts>(() => ({
    villageois: Math.max(0, approvedPlayers - 1),
    loup_garou: approvedPlayers > 0 ? 1 : 0,
    voyante: 0,
    sorciere: 0,
    chasseur: 0,
    cupidon: 0,
  }));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const assignedCount = Object.values(counts).reduce(
    (sum, count) => sum + count,
    0
  );

  const villageCount =
    counts.villageois +
    counts.voyante +
    counts.sorciere +
    counts.chasseur +
    counts.cupidon;

  const canStart =
    approvedPlayers >= 2 &&
    assignedCount === approvedPlayers &&
    counts.loup_garou >= 1 &&
    villageCount >= 1 &&
    !loading;

  function changeCount(key: RoleKey, change: number) {
    setCounts((current) => ({
      ...current,
      [key]: Math.min(
        Math.min(roleDefinitions.find((role) => role.key === key)!.max,
          approvedPlayers),
        Math.max(0, current[key] + change)
      ),
    }));

    setError("");
  }

  async function launchGame() {
    if (!canStart) return;

    const confirmed = window.confirm(
      `Lancer « ${gameName} » avec ${approvedPlayers} joueurs validés ?\n\nLes rôles seront distribués aléatoirement. Cette opération ne pourra pas être annulée depuis l'application.`
    );

    if (!confirmed) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/master/games/${gameId}/start`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ roleCounts: counts }),
        }
      );

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        setError(result.error ?? "Impossible de lancer la partie.");
        return;
      }

      setSuccess(true);
      router.refresh();
    } catch {
      setError("Impossible de contacter le serveur.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="dashboard-panel role-setup">
      <div className="dashboard-panel-heading">
        <div>
          <p className="section-kicker">COMPOSITION DE LA PARTIE</p>
          <h2>Distribuer les rôles</h2>
        </div>

        <div className="dashboard-icon">
          <Moon size={20} />
        </div>
      </div>

      <p className="role-setup-description">
        Choisis le nombre de rôles. La distribution sera aléatoire parmi
        les joueurs dont l&apos;inscription a été validée.
      </p>

      <div className="role-player-summary">
        <div>
          <span>Joueurs validés</span>
          <strong>{approvedPlayers}</strong>
        </div>

        <div>
          <span>Rôles sélectionnés</span>
          <strong className={assignedCount === approvedPlayers ? "valid" : "invalid"}>
            {assignedCount}/{approvedPlayers}
          </strong>
        </div>
      </div>

      <div className="role-list">
        {roleDefinitions.map((role) => {
          const Icon = role.icon;

          return (
            <div className="role-setup-row" key={role.key}>
              <div className="role-setup-icon">
                <Icon size={19} />
              </div>

              <div className="role-setup-info">
                <strong>{role.name}</strong>
                <span>{role.description}</span>
              </div>

              <div className="role-count-control">
                <button
                  type="button"
                  onClick={() => changeCount(role.key, -1)}
                  disabled={counts[role.key] <= 0 || loading || success}
                  aria-label={`Retirer un ${role.name}`}
                >
                  −
                </button>

                <output aria-label={`Nombre de ${role.name}`}>
                  {counts[role.key]}
                </output>

                <button
                  type="button"
                  onClick={() => changeCount(role.key, 1)}
                  disabled={
                    counts[role.key] >= role.max ||
                    assignedCount >= approvedPlayers ||
                    loading ||
                    success
                  }
                  aria-label={`Ajouter un ${role.name}`}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {approvedPlayers < 2 && (
        <p className="auth-error">
          Il faut au moins deux joueurs validés pour lancer la partie.
        </p>
      )}

      {assignedCount !== approvedPlayers && approvedPlayers >= 2 && (
        <p className="role-validation-message">
          Ajuste la composition pour attribuer exactement un rôle à chaque joueur.
        </p>
      )}

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      {success && (
        <p className="registration-success" role="status">
          La partie a été lancée et les rôles ont été distribués.
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary role-launch-button"
        onClick={launchGame}
        disabled={!canStart || success}
      >
        {loading ? (
          <>
            <LoaderCircle className="auth-spinner" size={18} />
            Lancement...
          </>
        ) : success ? (
          "Partie lancée"
        ) : (
          <>
            <Swords size={18} />
            Lancer la partie
          </>
        )}
      </button>

      <p className="dashboard-muted">
        Les rôles sont attribués par le serveur. Chaque joueur recevra
        uniquement les informations qui lui sont destinées.
      </p>
    </section>
  );
}